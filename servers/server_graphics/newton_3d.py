import asyncio
import json
import logging
import math
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("newton-3d-service")

PORT = 8306

SERVICE_META = {
    "path": "/newton_3d_optimization",
    "name": "Оптимизация методом Ньютона в 3D",
    "icon": "fa-cube",
    "ws_url": f"ws://153.80.245.239:{PORT}/ws",
    "type": "newton_3d"
}


def f(x: float, y: float) -> float:
    return 0.5 * (x ** 2) + 0.25 * x * y + 0.3 * (y ** 2)


def gradient(x: float, y: float):
    df_dx = 1.0 * x + 0.25 * y
    df_dy = 0.25 * x + 0.6 * y
    return df_dx, df_dy


def hessian(x: float, y: float):
    ddf_dxx = 1.0
    ddf_dyy = 0.6
    ddf_dxy = 0.25

    return ddf_dxx, ddf_dxy, ddf_dxy, ddf_dyy


async def keep_registry_connection():
    uri = "ws://153.80.245.239:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_META))
                logger.info(f"Сервис '{SERVICE_META['name']}' зарегистрирован на шлюзе.")
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
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("Клиент подключился к 3D сервису оптимизации")

    await websocket.send_json({"event": "init"})

    state = {"running": False, "task": None}
    try:
        while True:
            data = await websocket.receive_text()
            request = json.loads(data)
            action = request.get("action")

            if action == "start" and not state["running"]:
                state["running"] = True
                x0 = request.get("x", 7.0)
                y0 = request.get("y", -5.0)
                state["task"] = asyncio.create_task(run_newton_3d(websocket, x0, y0, state))

            elif action == "stop" and state["running"]:
                state["running"] = False
                if state["task"]:
                    state["task"].cancel()

    except WebSocketDisconnect:
        logger.info("Клиент отключился")
    finally:
        state["running"] = False


async def run_newton_3d(websocket: WebSocket, x_start: float, y_start: float, state: dict):
    x, y = x_start, y_start
    max_iterations = 40
    epsilon = 1e-3

    try:
        await websocket.send_json({"event": "step", "x": x, "y": y, "z": f(x, y)})
        await asyncio.sleep(0.5)

        for _ in range(max_iterations):
            if not state["running"]:
                break

            g_x, g_y = gradient(x, y)
            h_xx, h_xy, h_yx, h_yy = hessian(x, y)

            det = h_xx * h_yy - h_xy * h_yx
            if abs(det) < 1e-6:
                det = 1e-6

            raw_step_x = (h_yy * g_x - h_xy * g_y) / det
            raw_step_y = (-h_yx * g_x + h_xx * g_y) / det

            max_len = 1.2
            step_len = math.sqrt(raw_step_x ** 2 + raw_step_y ** 2)
            if step_len > max_len:
                step_x = (raw_step_x / step_len) * max_len
                step_y = (raw_step_y / step_len) * max_len
            else:
                step_x = raw_step_x
                step_y = raw_step_y

            current_z = f(x, y)
            alpha = 1.0

            for _ in range(5):
                next_x = x - alpha * step_x
                next_y = y - alpha * step_y

                next_x = max(-10.0, min(10.0, next_x))
                next_y = max(-10.0, min(10.0, next_y))

                if f(next_x, next_y) < current_z:
                    break
                alpha *= 0.5

            actual_step_x = x - next_x
            actual_step_y = y - next_y

            x, y = next_x, next_y

            await websocket.send_json({"event": "step", "x": x, "y": y, "z": f(x, y)})

            if math.sqrt(actual_step_x ** 2 + actual_step_y ** 2) < epsilon:
                break

            await asyncio.sleep(0.3)

        await websocket.send_json({"event": "finished", "x": x, "y": y, "z": f(x, y)})

    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"Ошибка алгоритма: {e}")
    finally:
        state["running"] = False


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)