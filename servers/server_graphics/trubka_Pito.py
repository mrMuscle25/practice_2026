from fastapi import FastAPI, WebSocket as FastWebSocket, WebSocketDisconnect
import json
import websockets
import asyncio
import math
import random
from contextlib import asynccontextmanager

PORT =8003

PARABOLA_META = {
    "path": "/charts_3",
    "name": "График показателей воздушного давления (Па)",
    "icon": "fa-line-chart",
    "ws_url": f"ws://153.80.245.239:{PORT}/ws"
}

async def connection():
    uri = "ws://153.80.245.239:8000/ws/backend"
    while True:
        try:
            async with websockets.connect(uri) as websocket:
                await websocket.send(json.dumps(PARABOLA_META))
                print(f"Подключение успешно:датчик трубки Пито был успешно подключен.")
                while True:
                    await websocket.recv()
        except (websockets.exceptions.ConnectionClosed, ConnectionRefusedError):
            print("Шлюз недоступен")
            await asyncio.sleep(10)

def compute_stats(data):
    n = len(data)
    if n == 0:
        return {"mo": 0.0, "sko": 0.0, "skz": 0.0, "min": 0.0, "max": 0.0}
    
    mean = sum(data) / n
    variance = sum((x - mean) ** 2 for x in data) / n
    std = math.sqrt(variance)
    rms = math.sqrt(sum(x ** 2 for x in data) / n)
    
    return {
        "mo": round(mean, 3),
        "sko": round(std, 3),
        "skz": round(rms, 3),
        "min": round(min(data), 3),
        "max": round(max(data), 3)
    }

async def generate_data(app_data, stop):
     # Параметры моделирования
    MAX_POINTS = 500                # сколько точек хранить в истории
    dt = 1.0                        # шаг времени (секунды)
    time_counter = 0.0

    # Начальные условия
    h = 0.0         
    v = 0.0

    #константы
    p0 = 101325.0         
    T0 = 288.15            
    L = 0.0065            
    g = 9.80665
    M = 0.0289644
    R = 8.314462618

    # Для инерции датчика (фильтр первого порядка)
    tau = 0.2        # постоянная времени (сек)
    alpha = dt / (tau + dt)
    filtered_pressure = 101325.0    # начальное давление (за начальное беру атмосферное на земле)

    #тут разбила на этапы полёта, плавность, красиво, не дёргано, все дела.
    stages = [
        (30,   0,    80),   # взлёт – разгон по ВПП
        (90,   3000, 250),  # набор высоты
        (200,  10000, 230), # крейсерский полёт
        (120,  3000,  80),  # снижение
        (40,   0,     0)    # посадка
    ]

    # Индекс текущего этапа и время внутри него
    stage_idx = 0
    stage_time = 0.0
    start_h = h
    start_v = v

    # Функция для плавного перехода (ну это чтобы график не разносило и не дергало)
    def smoothstep(t):
        return t * t * (3 - 2 * t)

    # массивы для координат
    time_series = []
    pressure_series = []

    # Сохраняем начальное состояние
    app_data.state.pressure_time = time_series
    app_data.state.pressure_values = pressure_series

    while not stop.is_set():
        if stage_idx >= len(stages):#определяем этап полета
            pass
        else:
            duration, target_h, target_v = stages[stage_idx]
            # Прогресс в этапе (0..1)
            progress = stage_time / duration if duration > 0 else 1.0
            if progress >= 1.0:
                stage_idx += 1
                if stage_idx < len(stages):
                    # Обновляем начальные значения для следующего этапа
                    start_h = h
                    start_v = v
                    stage_time = 0.0
                    duration, target_h, target_v = stages[stage_idx]
                    progress = 0.0
                else:
                    # Все этапы пройдены – держим последние значения
                    progress = 1.0
            else:
                # Текущий этап – вычисляем плавные значения
                t = smoothstep(progress)
                h = start_h + (target_h - start_h) * t
                v = start_v + (target_v - start_v) * t

            # Продвигаем время этапа
            stage_time += dt
        # Для высот до 11000 м
        if h < 11000:
            p_static = p0 * (1 - L * h / T0) ** (g * M / (R * L))
        else:
            p_static = p0 * math.exp(-g * M * h / (R * T0))

        #сами расчёты значений, тоже надо для красоты и гибкости графика
        rho = 1.225 * (p_static / p0)

        q = 0.5 * rho * v * v
        p_total = p_static + q

        noise_amplitude = 0.001 * p_total
        raw_noise = random.gauss(0, noise_amplitude)
        noise = random.normalvariate(0, 0.0005 * p_total)
        p_measured_raw = p_total + noise

        filtered_pressure = (1 - alpha) * filtered_pressure + alpha * p_measured_raw

        #и тут вот обновляем данные, собственно
        time_counter += dt
        time_series.append(time_counter)
        pressure_series.append(filtered_pressure)

        if len(time_series) > MAX_POINTS:
            time_series.pop(0)
            pressure_series.pop(0)

        stats = compute_stats(pressure_series)
        app_data.state.chart_stats = stats

        app_data.state.pressure_time = time_series
        app_data.state.pressure_values = pressure_series
        await asyncio.sleep(dt)

    
@asynccontextmanager
async def sif(app:FastAPI):
     asyncio.create_task(connection())

     stop = asyncio.Event()
     asyncio.create_task(generate_data(app, stop))
     yield

     stop.set()
    
app = FastAPI(lifespan=sif)

@app.websocket("/ws")
async def websocket_endpoint(websocket: FastWebSocket):
    await websocket.accept()
    try:
        while True:
            time_vals = getattr(websocket.app.state, "pressure_time", [])
            press_vals = getattr(websocket.app.state, "pressure_values", [])
            stats = getattr(websocket.app.state, "chart_stats", {"mo": 0, "sko": 0, "skz": 0, "min": 0, "max": 0})

            # Если данных нет – отправляем заглушку
            if not time_vals or not press_vals:
                data = {
                    "title": "Давление (Трубка Пито)",
                    "labels": ["Ожидание данных..."],
                    "values": [0],
                    "stats": stats
                }
            else:
                data = {
                    "title": "Давление (Трубка Пито)",
                    "labels": time_vals,
                    "values": press_vals,
                    "stats": stats
                }
            await websocket.send_json(data)
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        pass



if __name__ == "__main__":

    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
    