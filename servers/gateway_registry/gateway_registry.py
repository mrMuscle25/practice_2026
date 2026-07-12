from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ACTIVE_BACKENDS = {}
CONNECTED_FRONTENDS = set()

async def broadcast_network_map(): # отправляет актуальное состояние сервисов всем клиентам
    if CONNECTED_FRONTENDS:
        payload = {"client_services": list(ACTIVE_BACKENDS.values())}
        tasks = [client.send_json(payload) for client in CONNECTED_FRONTENDS]
        await asyncio.gather(*tasks, return_exceptions=True)


@app.websocket("/ws/backend") # точка входа для backend-сервисов
async def websocket_backend_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        service_meta = await websocket.receive_json() # Сообщение с данными о сервисе
        ACTIVE_BACKENDS[websocket] = service_meta
        print(f"[+] Сервис прописался через сокет: {service_meta['name']}")

        await broadcast_network_map() # Уведомление клиента о новом сервисе

        while True:
            await websocket.receive_text() # Бесконечный цикл получения данных

    except WebSocketDisconnect: # При отключении микросервиса
        if websocket in ACTIVE_BACKENDS:
            dropped_service = ACTIVE_BACKENDS[websocket]
            print(f"Сервис отключился: {dropped_service['name']}")
            del ACTIVE_BACKENDS[websocket]
            # Мгновенная рассылка обновленной карты сети на фронт
            await broadcast_network_map()

@app.websocket("/ws/registry")
async def websocket_registry_endpoint(websocket: WebSocket):
    await websocket.accept()
    CONNECTED_FRONTENDS.add(websocket)
    print(f"[Реестр] Админка подключилась. Активно экранов: {len(CONNECTED_FRONTENDS)}")

    try:
        # Сразу отдаем текущую карту сети новому клиенту
        await websocket.send_json({"client_services": list(ACTIVE_BACKENDS.values())})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        CONNECTED_FRONTENDS.remove(websocket)
        print("Клиент отключился.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)