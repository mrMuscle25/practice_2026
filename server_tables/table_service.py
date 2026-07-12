from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import asyncio
import random
import json
import websockets

app = FastAPI()
PORT = 8002

SERVICE_META = {
    "path": "/tables",
    "name": "Таблица измерений",
    "icon": "fa-table",
    "ws_url": f"ws://153.80.245.239:{PORT}/ws"
}

async def keep_registry_connection():
    uri = "ws://127.0.0.1:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_META))
                print(f"[WS Клиент] Успешно подключено к шлюзу. Сервис '{SERVICE_META['name']}' в сети.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("[WS Клиент] Шлюз регистрации недоступен. Повтор через 3 секунды...")
            await asyncio.sleep(3)

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
                    [2, "Давление", f"{random.randint(750,800)} мм рт.ст."]
                ]
            }
            await websocket.send_json(data)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        pass

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(keep_registry_connection())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)