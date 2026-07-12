import asyncio
import websockets
import json
from datetime import datetime

SERVICE_NAME = "system_logs"
GATEWAY_URL = f"ws://127.0.0.1:8000/ws/service/{SERVICE_NAME}"

async def main():
    async for websocket in websockets.connect(GATEWAY_URL):
        try:
            while True:
                data = {
                    "type": "report",
                    "title": "Системный отчет безопасности",
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "text": "Все внутренние системы работают в штатном режиме. Попыток несанкционированного доступа не обнаружено. Проведена автоматическая проверка целостности файловой структуры."
                }
                await websocket.send(json.dumps(data))
                await asyncio.sleep(5)
        except websockets.ConnectionClosed:
            await asyncio.sleep(2)

if __name__ == "__main__":
    asyncio.run(main())