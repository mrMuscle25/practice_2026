import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
import numpy as np
from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("3d-sin")

PORT = 8005

SERVICE_METADATA = {
    "name": "3d-синусоида",
    "path": "/3d-visualizer",
    "icon": "fa-cube",
    "ws_url": f"ws://localhost:{PORT}/ws",
    "type": "3d_chart"
}

async def keep_registry_connection():
    uri = "ws://127.0.0.1:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_METADATA))
                logger.info(f"Успешно подключено к шлюзу. Сервис '{SERVICE_METADATA['name']}' в сети.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            logger.warning("Шлюз регистрации недоступен. Повтор через 3 секунды...")
            await asyncio.sleep(3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(keep_registry_connection())
    yield


app = FastAPI(
    title="Test 3d",
    lifespan=lifespan
)


def generate_sin(t: float, resolution: int = 40):

    x_min, x_max = -10.0, 10.0
    y_min, y_max = -10.0, 10.0

    x = np.linspace(x_min, x_max, resolution)
    y = np.linspace(y_min, y_max, resolution)
    X, Y = np.meshgrid(x, y)

    R = np.sqrt(X**2 + Y**2)
    Z = np.sin(R - t * 2.0) * 2.5

    return {
        "function": "sin",
        "x": X.tolist(),
        "y": Y.tolist(),
        "z": Z.tolist(),
        "bounds": {
            "x_min": float(np.min(X)), "x_max": float(np.max(X)),
            "y_min": float(np.min(Y)), "y_max": float(np.max(Y)),
            "z_min": float(np.min(Z)), "z_max": float(np.max(Z))
        },
        "t": t
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    logger.info("Клиент подключился")

    state = {
        "resolution": 40,
        "active": True
    }

    async def receive_commands():
        try:
            while True:
                data = await websocket.receive_text()
                request = json.loads(data)
                if request.get("action") == "get_data":
                    state["resolution"] = int(request.get("resolution", 40))
        except WebSocketDisconnect:
            state["active"] = False
        except Exception as e:
            logger.error(f"Ошибка чтения команд: {e}")
            state["active"] = False

    asyncio.create_task(receive_commands())

    start_time = time.time()
    try:
        while state["active"]:
            t = time.time() - start_time
            response_data = generate_sin(t, state["resolution"])
            await websocket.send_json(response_data)
            await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        logger.info("Клиент отключился")
    finally:
        state["active"] = False


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)