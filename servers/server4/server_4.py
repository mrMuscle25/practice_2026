import asyncio
import websockets
import json

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
            "equipment_id": entry["equipment_id"],
            "value": entry["Value"],
            "Time": entry["Time"]
            
        }
        messages.append(message_to_send)
    return messages

async def handle_client(websocket):
    try:
        print(f"Новое соединение: {websocket.remote_address}")

        while True:
            messages_to_send = parse_json()
            await websocket.send(json.dumps(messages_to_send))
            print(f"Отправлены данные клиенту {websocket.remote_address}")

            await asyncio.sleep(2)

    except websockets.exceptions.ConnectionClosedError:
        print(f"Соединение с клиентом разорвано")
    except Exception as e:
        print(f"Ошибка: {e}")
    finally:
        print(f"Соединение закрыто: {websocket.remote_address}")

async def main():
    server = await websockets.serve(handle_client, "localhost", 8768)
    print("WebSocket сервер запущен на ws://localhost:8765")
    await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())