import asyncio
import websockets
import json

PORT = 8765
SERVICE_META = {
    "path": "/consul-1",
    "name": "Consul 1",
    "icon": "fa-server",
    "ws_url": f"ws://153.80.245.239:{PORT}"
}


def open_file():
    with open("consulData.js", "r") as file:
        data = file.read()
    return data


def extract_list():
    data = open_file()
    list = []
    start_index = data.find('[')
    end_index = data.rfind(']')
    if start_index != -1 and end_index != -1:
        list_str = data[start_index:end_index + 1]
        list = json.loads(list_str)
    return list


def parse_json():
    data = extract_list()
    messages = []
    for entry in data:
        message_to_send = {
            "key": entry["Key"],
            "value": entry["Value"],
            "createIndex": entry["CreateIndex"]
        }
        messages.append(message_to_send)
    return messages

async def keep_registry_connection():
    uri = "ws://153.80.245.239:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(SERVICE_META))
                print(f"[Реестр] Успешно зарегистрирован: {SERVICE_META['name']}")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("[Реестр] Шлюз недоступен. Повторная попытка через 3 сек...")
            await asyncio.sleep(3)


async def handle_client(websocket):
    try:
        print(f"Новое соединение: {websocket.remote_address}")

        messages_to_send = parse_json()
        await websocket.send(json.dumps(messages_to_send))

        while True:
            await asyncio.sleep(3600)

    except websockets.exceptions.ConnectionClosed:
        print(f"Соединение с клиентом разорвано")
    except Exception as e:
        print(f"Ошибка: {e}")


async def main():
    asyncio.create_task(keep_registry_connection())

    async with websockets.serve(handle_client, "0.0.0.0", PORT):
        print(f"WebSocket сервер запущен на ws://localhost:{PORT}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())