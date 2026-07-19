from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import asyncio
import random
import json
from contextlib import asynccontextmanager
import websockets

PORT = 8008

SERVICE_META = {
    "path": "/tables",
    "name": "Таблица измерений",
    "icon": "fa-table",
    "ws_url": f"ws://localhost:{PORT}/ws"
}

async def keep_registry_connection(stop_event: asyncio.Event):
    uri = "ws://127.0.0.1:8000/ws/backend"
    while not stop_event.is_set():
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_META))
                print(f"[WS Клиент] Успешно подключено к шлюзу. Сервис '{SERVICE_META['name']}' в сети.")
                while not stop_event.is_set():
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("[WS Клиент] Шлюз регистрации недоступен. Повтор через 3 секунды...")
            await asyncio.sleep(3)

@asynccontextmanager
async def lifespan(app_fastapi: FastAPI):
    stop_event = asyncio.Event()
    task = asyncio.create_task(keep_registry_connection(stop_event))
    yield
    stop_event.set()
    task.cancel()

app = FastAPI(lifespan=lifespan)

@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    try:
        while True:
            data = {
                "title": "Данные измерений",
                "headers": ["ID", "Величина", "Значение"],
                "rows": [
                    [1, "Температура", f"{random.randint(0, 100)} гр. Цельсия"],
                    [2, "Давление", f"{random.randint(750, 800)} мм рт.ст."]
                ]
            }
            await websocket.send_json(data)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        print("[+] Клиент отключился от таблицы.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)