from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import json
import websockets
import asyncio
from contextlib import asynccontextmanager

PORT =8101

PARABOLA_META = {
    "path": "/charts",
    "name": "График параболической функции",
    "icon": "fa-line-chart",
    "ws_url": f"ws://localhost:{PORT}/ws"
}

async def connection():
    uri = "ws://127.0.0.1:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(PARABOLA_META))
                print(f"Подключение успешно: сервис по построению графика параболы был успешно подключен.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("Шлюз недоступен")
            await asyncio.sleep(10)

async def generate_data(app_data, stop):
    a=1
    b=0
    c=0
    current=1
    x=[0]
    y=[0]
    app_data.state.parabola_x = x
    app_data.state.parabola_y = y
    step = 1
    while not stop.is_set():
        parabola = a * (current ** 2) + b * current + c
        x.append(current)
        y.append(parabola)
        #x.append(current*(-1))
        #y.append(parabola)
        current += step
        app_data.state.parabola_x = x
        app_data.state.parabola_y = y
        await asyncio.sleep(1)

    
@asynccontextmanager
async def sif(app:FastAPI):
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
            data = {
                "title": "График параболической фун-ии",
                "labels": getattr(websocket.app.state, "parabola_x", ["Построние графика было окончено или прервано."]),
                "values": getattr(websocket.app.state, "parabola_y", ["Построние графика было окончено или прервано."])
            }
            await websocket.send_json(data)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass



if __name__ == "__main__":

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
    