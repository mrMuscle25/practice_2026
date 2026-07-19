import asyncio
from contextlib import asynccontextmanager
import json
from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import websockets

PORT = 8103

PARABOLA_META = {
    "path": "/dynamic_parabola_2",
    "name": "Управляемая парабола",
    "icon": "fa-line-chart",
    "ws_url": f"ws://localhost:{PORT}/ws",
}

current_params = {"a": 1.0, "b": 0.0, "c": 0.0}


async def connection():
    uri = "ws://127.0.0.1:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(PARABOLA_META))
                print("Подключение успешно: сервис по построению графика параболы был успешно подключен.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("Шлюз недоступен, повтор через 10 секунд...")
            await asyncio.sleep(10)


@asynccontextmanager
async def sif(app: FastAPI):
    asyncio.create_task(connection())

    x_grid = list(range(-10, 11))
    y_values = [x ** 2 for x in x_grid]

    app.state.parabola_x = x_grid
    app.state.parabola_y = y_values
    app.state.parabola_equation = "y = 1.0x² + 0.0x + 0.0"

    yield


app = FastAPI(lifespan=sif)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    print("Клиент подключился")

    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                data = json.loads(message)

                if "a" in data: current_params["a"] = float(data["a"])
                if "b" in data: current_params["b"] = float(data["b"])
                if "c" in data: current_params["c"] = float(data["c"])

                a, b, c = current_params["a"], current_params["b"], current_params["c"]
                x_grid = getattr(websocket.app.state, "parabola_x", list(range(-10, 11)))
                y_values = [a * x ** 2 + b * x + c for x in x_grid]

                websocket.app.state.parabola_y = y_values
                websocket.app.state.parabola_equation = f"y = {a:.1f}x² + {b:.1f}x + {c:.1f}"

                print(f"Обновлено: a={a:.1f}, b={b:.1f}, c={c:.1f}")

            except asyncio.TimeoutError:
                pass

            data_to_send = {
                "type": "parabola",
                "equation": getattr(websocket.app.state, "parabola_equation", "y = x²"),
                "x": getattr(websocket.app.state, "parabola_x", []),
                "y": getattr(websocket.app.state, "parabola_y", []),
                "params": current_params
            }

            await websocket.send_json(data_to_send)
            await asyncio.sleep(0.4)

    except WebSocketDisconnect:
        print("Клиент отключился")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)