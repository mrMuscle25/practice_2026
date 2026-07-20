import asyncio
import json
import random
import math
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import websockets

PORT = 8102

SENSOR_META = {
    "path": "/boiler-sensor",
    "name": "Датчик температуры бойлера (°C)",
    "icon": "fa-thermometer-half",
    "ws_url": f"ws://153.80.245.239:{PORT}/ws"
}


async def keep_registry_connection():
    uri = "ws://153.80.245.239:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SENSOR_META))
                print(f"[+] Сервис '{SENSOR_META['name']}' успешно зарегистрирован на шлюзе.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("[-] Центральный шлюз недоступен. Повторная попытка через 5 секунд...")
            await asyncio.sleep(5)

def calculate_statistics(data_points):
    if not data_points:
        return {"mo": 0, "sko": 0, "skz": 0, "min": 0, "max": 0}
    n = len(data_points)
    mo = sum(data_points) / n
    skz = math.sqrt(sum(x ** 2 for x in data_points) / n)
    if n > 1:
        variance = sum((x - mo) ** 2 for x in data_points) / (n - 1)
        sko = math.sqrt(variance)
    else:
        sko = 0.0

    return {
        "mo": round(mo, 3),
        "sko": round(sko, 3),
        "skz": round(skz, 3),
        "min": round(min(data_points), 3),
        "max": round(max(data_points), 3)
    }


async def generate_sensor_data(app_instance, stop_event):
    max_history = 15
    timestamps = []
    temperatures = []

    current_temp = 75.0

    while not stop_event.is_set():
        current_temp += random.uniform(-1.5, 1.5)
        current_temp = max(40.0, min(95.0, current_temp))

        now_str = datetime.now().strftime("%H:%M:%S")

        timestamps.append(now_str)
        temperatures.append(round(current_temp, 2))

        if len(timestamps) > max_history:
            timestamps.pop(0)
            temperatures.pop(0)

        stats = calculate_statistics(temperatures)

        app_instance.state.chart_labels = list(timestamps)
        app_instance.state.chart_values = list(temperatures)
        app_instance.state.chart_stats = stats

        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app_fastapi: FastAPI):
    asyncio.create_task(keep_registry_connection())
    stop_event = asyncio.Event()
    asyncio.create_task(generate_sensor_data(app_fastapi, stop_event))
    yield
    stop_event.set()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    try:
        while True:
            labels = getattr(websocket.app.state, "chart_labels", [])
            values = getattr(websocket.app.state, "chart_values", [])
            stats = getattr(websocket.app.state, "chart_stats", {"mo": 0, "sko": 0, "skz": 0, "min": 0, "max": 0})

            payload = {
                "title": "Показания температуры (°C)",
                "labels": labels,
                "values": values,
                "stats": stats
            }

            await websocket.send_json(payload)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        print("[-] Клиент отключился.")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)