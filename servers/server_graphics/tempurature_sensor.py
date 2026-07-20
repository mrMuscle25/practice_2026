from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import json
import websockets
import asyncio
import math
import random
from contextlib import asynccontextmanager

PORT = 8002


TEMP_META = {
    "path": "/charts_2",
    "name": "График температуры в двигателе (°C)",
    "icon": "fa-line-chart",
    "ws_url": f"ws://153.80.245.239:{PORT}/ws"
}

async def connection():
    uri = "ws://153.80.245.239:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(TEMP_META))
                print("Подключение успешно: датчик температуры подключён.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("Шлюз недоступен")
            await asyncio.sleep(10)

def compute_stats(data):
    n = len(data)
    if n == 0:
        return {"mo": 0.0, "sko": 0.0, "skz": 0.0, "min": 0.0, "max": 0.0}
    mean = sum(data) / n
    variance = sum((x - mean) ** 2 for x in data) / n
    std = math.sqrt(variance)
    rms = math.sqrt(sum(x ** 2 for x in data) / n)
    return {
        "mo": round(mean, 3),
        "sko": round(std, 3),
        "skz": round(rms, 3),
        "min": round(min(data), 3),
        "max": round(max(data), 3)
    }

async def generate_data(app_data, stop):
    MAX_POINTS = 500
    dt = 1.0
    time_counter = 0.0

    
    temp = 80.0

    tau = 0.5          
    alpha = dt / (tau + dt)
    filtered_temp = temp

    
    stages = [
        (20,   90),    
        (40,  180),    
        (60,  210),    
        (180, 195),    
        (90,  130),    
        (30,   80)     
    ]

    stage_idx = 0
    stage_time = 0.0
    start_temp = temp

    def smoothstep(t):
        return t * t * (3 - 2 * t)

    time_series = []
    temp_series = []

    app_data.state.temp_time = time_series
    app_data.state.temp_values = temp_series
    app_data.state.chart_stats = {"mo": 0.0, "sko": 0.0, "skz": 0.0, "min": 0.0, "max": 0.0}

    while not stop.is_set():
        if stage_idx < len(stages):
            duration, target_temp = stages[stage_idx]
            progress = stage_time / duration if duration > 0 else 1.0
            if progress >= 1.0:
                stage_idx += 1
                if stage_idx < len(stages):
                    start_temp = temp
                    stage_time = 0.0
                    duration, target_temp = stages[stage_idx]
                    progress = 0.0
                else:
                    progress = 1.0
            else:
                t = smoothstep(progress)
                temp = start_temp + (target_temp - start_temp) * t
            stage_time += dt
        else:
            pass

        noise = random.normalvariate(0, 0.5)   # амплитуда в градусах
        raw_temp = temp + noise

        filtered_temp = (1 - alpha) * filtered_temp + alpha * raw_temp

        time_counter += dt
        time_series.append(time_counter)
        temp_series.append(filtered_temp)

        if len(time_series) > MAX_POINTS:
            time_series.pop(0)
            temp_series.pop(0)

        stats = compute_stats(temp_series)
        app_data.state.chart_stats = stats

        app_data.state.temp_time = time_series
        app_data.state.temp_values = temp_series

        await asyncio.sleep(dt)

@asynccontextmanager
async def sif(app: FastAPI):
    asyncio.create_task(connection())
    stop = asyncio.Event()
    asyncio.create_task(generate_data(app, stop))
    yield
    stop.set()

app = FastAPI(lifespan=sif)

@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    try:
        while True:
            # Получаем данные температуры
            time_vals = getattr(websocket.app.state, "temp_time", [])
            temp_vals = getattr(websocket.app.state, "temp_values", [])
            stats = getattr(websocket.app.state, "chart_stats", {"mo": 0, "sko": 0, "skz": 0, "min": 0, "max": 0})

            if not time_vals or not temp_vals:
                data = {
                    "title": "Температура двигателя",
                    "labels": ["Ожидание данных..."],
                    "values": [0],
                    "stats": stats
                }
            else:
                data = {
                    "title": "Температура двигателя",
                    "labels": time_vals,
                    "values": temp_vals,
                    "stats": stats
                }
            await websocket.send_json(data)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)