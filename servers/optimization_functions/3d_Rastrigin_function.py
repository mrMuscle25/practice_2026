import asyncio
import json
import logging
from contextlib import asynccontextmanager
import numpy as np
from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("3d-sin")

PORT = 8506

SERVICE_METADATA = {
    "name": "3d-функция Растригина",
    "path": "/3d-visualizer_2",
    "icon": "fa-cube",
    "ws_url": f"ws://153.80.245.239:{PORT}/ws",
    "type": "3d_chart"
}

async def keep_registry_connection():
    uri = "ws://153.80.245.239:8000/ws/backend"
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

def rastring(x):
    term = x **2- 10* np.cos(2*x*(np.pi))
    return 10 + term


def generate_sin(x_min,x_max, y_min, y_max):
       resolution=100
       x = np.linspace(x_min, x_max, resolution)
       y = np.linspace(y_min, y_max, resolution)
       X, Y = np.meshgrid(x, y)
       Z = rastring(X) + rastring(Y)
       return {
           "x": X.tolist(),
           "y": Y.tolist(),
           "z": Z.tolist(),
           "bounds": {
               "x_min": float(np.min(X)), "x_max": float(np.max(X)),
               "y_min": float(np.min(Y)), "y_max": float(np.max(Y)),
               "z_min": float(np.min(Z)), "z_max": float(np.max(Z))
        }
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
    try:
        while state["active"]:
            for i in range(-6, 6):
                for j in range(-6, 6):
                    response_data = generate_sin(i, i+10.24, j, j+10.24)
                    await websocket.send_json(response_data)
                    await asyncio.sleep(0.05)
                for j in range(6, -6, -1):
                    response_data = generate_sin(i, i+10.24, j, j+10.24)
                    await websocket.send_json(response_data)
                    await asyncio.sleep(0.05)
    except WebSocketDisconnect:
        logger.info("Клиент отключился")
    finally:
        state["active"] = False


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)