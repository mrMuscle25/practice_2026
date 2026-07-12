from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import asyncio
import json
import websockets
import httpx

PORT = 8001

SERVICE_META = {
    "path": "/charts",
    "name": "Прогноз температуры в Москве",
    "icon": "fa-cloud-sun",
    "ws_url": f"ws://localhost:{PORT}/ws"
}


async def keep_registry_connection():
    uri = "ws://127.0.0.1:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_META))
                print(f"Успешно подключено к шлюзу. Сервис '{SERVICE_META['name']}' в сети.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("Шлюз регистрации недоступен. Повтор через 3 секунды...")
            await asyncio.sleep(3)


async def get_weather_data(app_instance):
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                "https://api.openweathermap.org/data/2.5/forecast?lat=55.7558&lon=37.6173&units=metric&appid=23b89cb7526c7f910531d96fe68adb27"
            )
            data = response.json()
            x = []
            y = []
            for i in data["list"]:
                x.append(i["dt_txt"])
                y.append(i["main"]["temp"])
            app_instance.state.weather_x = x
            app_instance.state.weather_y = y
            print("[OpenWeather] Данные успешно обновлены.")
        except Exception as e:
            app_instance.state.weather_x = ["00:00"]
            app_instance.state.weather_y = [0]
            print(f"[OpenWeather] Ошибка получения данных: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(keep_registry_connection())
    asyncio.create_task(get_weather_data(app))

    async def auto_update_weather():
        while True:
            await asyncio.sleep(600)
            await get_weather_data(app)

    asyncio.create_task(auto_update_weather())

    yield

app = FastAPI(lifespan=lifespan)

@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    try:
        while True:
            data = {
                "title": "Температура в Москве",
                "labels": getattr(websocket.app.state, "weather_x", ["Нет данных"]),
                "values": getattr(websocket.app.state, "weather_y", [0])
            }
            await websocket.send_json(data)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)