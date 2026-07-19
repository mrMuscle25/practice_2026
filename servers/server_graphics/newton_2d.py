import asyncio
import json
import logging
import random
import math
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("newton-service")

PORT = 8305

SERVICE_META = {
    "path": "/newton_optimization",
    "name": "Оптимизация методом Ньютона на примере 2d-графика",
    "icon": "fa-bar-chart",
    "ws_url": f"ws://localhost:{PORT}/ws",
    "type": "newton_chart"
}

def f(x: float) -> float:
    return 0.1 * (x ** 2) - 2 * math.cos(x)

def df(x: float) -> float:
    return 0.2 * x + 2 * math.sin(x)

def ddf(x: float) -> float:
    return 0.2 + 2 * math.cos(x)

async def keep_registry_connection():
    uri = "ws://127.0.0.1:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_META))
                logger.info(f"Сервис '{SERVICE_META['name']}' успешно зарегистрирован на шлюзе.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            logger.warning("Шлюз регистрации недоступен. Повтор через 3 секунды...")
            await asyncio.sleep(3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(keep_registry_connection())
    yield


app = FastAPI(lifespan=lifespan)

X_START, X_END = -10.0, 10.0
x_grid = [X_START + i * (X_END - X_START) / 200 for i in range(201)]
y_grid = [f(x) for x in x_grid]


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Клиент подключился к сервису оптимизации")

    state = {
        "running": False,
        "current_x": None,
        "history_x": [],
        "history_y": []
    }

    async def receive_commands():
        try:
            while True:
                data = await websocket.receive_text()
                request = json.loads(data)

                if request.get("action") == "start_optimization" and not state["running"]:
                    state["running"] = True
                    x0 = random.uniform(X_START + 1, X_END - 1)
                    state["current_x"] = x0
                    state["history_x"] = [x0]
                    state["history_y"] = [f(x0)]

                    asyncio.create_task(run_newton_algorithm(websocket, state))
        except WebSocketDisconnect:
            state["running"] = False
        except Exception as e:
            logger.error(f"Ошибка обработки команд: {e}")
            state["running"] = False

    asyncio.create_task(receive_commands())

    try:
        while True:
            payload = {
                "type": "newton",
                "x_base": x_grid,
                "y_base": y_grid,
                "opt_x": state["history_x"],
                "opt_y": state["history_y"],
                "current_x": state["current_x"],
                "is_running": state["running"]
            }
            await websocket.send_json(payload)
            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        logger.info("Клиент отключился")
    finally:
        state["running"] = False


async def run_newton_algorithm(websocket: WebSocket, state: dict):
    max_iterations = 30
    epsilon = 1e-4

    for _ in range(max_iterations):
        if not state["running"]:
            break

        x_curr = state["current_x"]
        numerator = df(x_curr)

        denominator = abs(ddf(x_curr))

        if denominator < 1e-6:
            denominator = 1e-6

        x_next = x_curr - numerator / denominator

        x_next = max(X_START, min(X_END, x_next))

        state["current_x"] = x_next
        state["history_x"].append(x_next)
        state["history_y"].append(f(x_next))

        if abs(x_next - x_curr) < epsilon:
            break

        await asyncio.sleep(0.6)

    state["running"] = False


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)