from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import json
import websockets
import asyncio
import math
import random
from contextlib import asynccontextmanager

PORT = 8001

# Метаданные (можно переименовать)
TACHOMETER_META = {
    "path": "/charts_1",
    "name": "График показателей тахометра (обороты двигателя в минуту)",
    "icon": "fa-line-chart",
    "ws_url": f"ws://localhost:{PORT}/ws"
}

async def connection():
    uri = "ws://localhost:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(TACHOMETER_META))
                print("Подключение успешно: датчик тахометра подключён.")
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

    rpm = 800.0
    tau = 0.3          
    alpha = dt / (tau + dt)
    filtered_rpm = rpm

    stages = [
        (20,  1000),   
        (40,  2700),   
        (60,  2500),   
        (180, 2200),   
        (90,  1500),   
        (30,  1000)    
    ]

    stage_idx = 0
    stage_time = 0.0
    start_rpm = rpm

    def smoothstep(t):
        return t * t * (3 - 2 * t)

    time_series = []
    rpm_series = []

    app_data.state.time = time_series  
    app_data.state.values = rpm_series
    app_data.state.chart_stats = {"mo": 0.0, "sko": 0.0, "skz": 0.0, "min": 0.0, "max": 0.0}

    while not stop.is_set():
        if stage_idx < len(stages):
            duration, target_rpm = stages[stage_idx]
            progress = stage_time / duration if duration > 0 else 1.0
            if progress >= 1.0:
                stage_idx += 1
                if stage_idx < len(stages):
                    start_rpm = rpm
                    stage_time = 0.0
                    duration, target_rpm = stages[stage_idx]
                    progress = 0.0
                else:
                    progress = 1.0
            else:
                t = smoothstep(progress)
                rpm = start_rpm + (target_rpm - start_rpm) * t
            stage_time += dt
        else:
            pass

        noise_amplitude = 0.005 * rpm
        noise = random.normalvariate(0, noise_amplitude)
        raw_rpm = rpm + noise
        filtered_rpm = (1 - alpha) * filtered_rpm + alpha * raw_rpm

        time_counter += dt
        time_series.append(time_counter)
        rpm_series.append(filtered_rpm)

        if len(time_series) > MAX_POINTS:
            time_series.pop(0)
            rpm_series.pop(0)

        stats = compute_stats(rpm_series)
        app_data.state.chart_stats = stats

        app_data.state.time = time_series
        app_data.state.values = rpm_series
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
            time_vals = getattr(websocket.app.state, "time", [])
            rpm_vals = getattr(websocket.app.state, "values", [])
            stats = getattr(websocket.app.state, "chart_stats", {"mo": 0, "sko": 0, "skz": 0, "min": 0, "max": 0})

            if not time_vals or not rpm_vals:
                data = {
                    "title": "Обороты двигателя (тахометр)",
                    "labels": ["Ожидание данных..."],
                    "values": [0],
                    "stats": stats
                }
            else:
                data = {
                    "title": "Обороты двигателя (тахометр)",
                    "labels": time_vals,
                    "values": rpm_vals,
                    "stats": stats
                }
            await websocket.send_json(data)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)