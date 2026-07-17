from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import json
import websockets
import asyncio
import random
from contextlib import asynccontextmanager

PORT = 8003

PARABOLA_META = {
    "path": "/dynamic_parabola",
    "name": "Изгибающаяся парабола",
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
            print("Шлюз недоступен, повтор через 10 секунд...")
            await asyncio.sleep(10)

async def generate_data(app_data, stop):
    x_grid = list(range(-10, 11))

    app_data.state.parabola_x = x_grid
    app_data.state.parabola_y = [0] * len(x_grid)
    app_data.state.current_coeffs = {"a": 1.0, "b": 0.0, "c": 0.0}

    a, b, c = 1.0, 0.0, 0.0

    while not stop.is_set():
        a = round(random.uniform(-3.0, 3.0), 2)
        if abs(a) < 0.2:
            a = 0.5 if a >= 0 else -0.5

        b = round(random.uniform(-5.0, 5.0), 2)
        c = round(random.uniform(-10.0, 10.0), 2)

        y_values = []
        for x in x_grid:
            y = a * (x ** 2) + b * x + c
            y_values.append(round(y, 2))

        app_data.state.parabola_y = y_values
        app_data.state.current_coeffs = {"a": a, "b": b, "c": c}

        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app_fastapi: FastAPI):
    asyncio.create_task(connection())
    stop_event = asyncio.Event()
    asyncio.create_task(generate_data(app_fastapi, stop_event))
    yield
    stop_event.set()


app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    print("[+] Клиент подключился к сокету параболы (активное вещание).")

    try:
        while True:
            coeffs = getattr(websocket.app.state, "current_coeffs", {"a": 1, "b": 0, "c": 0})

            sign_b = "+" if coeffs['b'] >= 0 else ""
            sign_c = "+" if coeffs['c'] >= 0 else ""
            formula_title = f"Парабола: y = {coeffs['a']}x² {sign_b}{coeffs['b']}x {sign_c}{coeffs['c']}"

            data = {
                "title": formula_title,
                "labels": getattr(websocket.app.state, "parabola_x", []),
                "values": getattr(websocket.app.state, "parabola_y", [])
            }
            await websocket.send_json(data)

            await asyncio.sleep(1)

    except WebSocketDisconnect:
        print("[-] Клиент отключился от сокета параболы.")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)