const REGISTRY_WS_URL = 'ws://153.80.245.239:8000/ws/registry';

let routingMap = [];
let registrySocket = null;
let currentWebSocket = null;
let currentChartInstance = null;
let isRegistryOnline = false;
let parabolaParams = { a: 1, b: 0, c: 0 };
let zoomState = null;

const CHART_STYLES = {
    borderColor: '#4fc3f7',
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    showLine: true,
    pointRadius: 0,
    tension: 0.1,
    borderWidth: 2,
    legendColor: '#333',
    gridColor: 'rgba(0,0,0,0.05)',
    axisColor: '#888',
    font: {
        size: 14,
        weight: 'bold'
    }
};

function init() {
    window.addEventListener('hashchange', router);
    connectToRegistry();
}

function connectToRegistry() {
    registrySocket = new WebSocket(REGISTRY_WS_URL);
    const statusBadge = document.getElementById('registry-status');
    const sidebar = document.getElementById('sidebar-panel');

    registrySocket.onopen = () => {
        statusBadge.innerText = "Шлюз онлайн";
        statusBadge.className = "badge online";
        sidebar.classList.remove('disabled-state');
    };

registrySocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const newServices = data.client_services;

    // Если шлюз только что восстановился из оффлайна
    if (!isRegistryOnline) {
        isRegistryOnline = true;
        routingMap = newServices;
        buildMenu(routingMap);
        document.getElementById('router-view').innerHTML = "";
        router();
        return;
    }

    // Перерисовываем меню, только если состав сети физически изменился
    if (JSON.stringify(routingMap) !== JSON.stringify(newServices)) {
        const wasNetworkEmpty = routingMap.length === 0;

        routingMap = newServices;
        buildMenu(routingMap);

        const currentPath = window.location.hash.replace('#', '');
        const stillExists = routingMap.some(srv => srv.path === currentPath);

        // Умная переадресация при выходе сервиса из сети
        if (!stillExists && currentPath) {
            if (routingMap.length > 0) {
                window.location.hash = routingMap[0].path;
            } else {
                window.location.hash = '';
                router();
            }
        }
        else if (wasNetworkEmpty && routingMap.length > 0) {
            window.location.hash = routingMap[0].path;
        }
        else {
            router();
        }
    }
};

    registrySocket.onclose = () => {
        statusBadge.innerText = "Нет подключения";
        statusBadge.className = "badge offline";
        sidebar.classList.add('disabled-state');
        isRegistryOnline = false;
        routingMap = [];
        document.getElementById('menu').innerHTML = '';
        handleRegistryCrash();
        setTimeout(connectToRegistry, 3000); // Попытка переподключения к шлюзу каждые 3 секунды
    };
}

function buildMenu(services) {
    const menu = document.getElementById('menu');
    menu.innerHTML = '';
    services.forEach(srv => {
        const li = document.createElement('li');
        li.innerHTML = `<a href="#${srv.path}" id="link-${srv.path}"><i class="fa-solid ${srv.icon}"></i> ${srv.name}</a>`;
        menu.appendChild(li);
    });
}

// Обработчик отключения сервиса-регистратора
function handleRegistryCrash() {
    cleanupCurrentView();
    document.getElementById('page-title').innerText = "Системная ошибка";
    document.getElementById('router-view').innerHTML = `
        <div class="loading" style="color: var(--danger);">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 3rem;"></i>
            <span>Ожидание соединения...</span>
        </div>`;
}

function router() {
    if (!isRegistryOnline) return;

    const currentPath = window.location.hash.replace('#', '') || '/';
    const service = routingMap.find(srv => srv.path === currentPath);

    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    const activeLink = document.getElementById(`link-${currentPath}`);
    if (activeLink) activeLink.classList.add('active');

    if (!service) {
        if (routingMap.length > 0 && !window.location.hash) {
            window.location.hash = routingMap[0].path;
        } else if (routingMap.length === 0) {
            document.getElementById('page-title').innerText = "Ожидание сервисов...";
            document.getElementById('router-view').innerHTML = `
                <div class="loading">
                    <i class="fa-solid fa-hourglass-start fa-spin" style="font-size: 2.5rem; color: var(--accent);"></i>
                    <span>Шлюз активен, но живые микросервисы данных не обнаружены.</span>
                </div>`;
        } else {
            document.getElementById('router-view').innerHTML = '<h2>404. Страница не найдена</h2>';
        }
        return;
    }

    if (currentWebSocket && currentWebSocket.url === service.ws_url) return;

    cleanupCurrentView();
    document.getElementById('page-title').innerText = service.name;
    document.getElementById('router-view').innerHTML = `<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Подключение к ${service.name}...</div>`;

    mountChildService(service);
}

function cleanupCurrentView() {
    if (currentWebSocket) {
        currentWebSocket.close();
        currentWebSocket = null;
    }
    if (currentChartInstance) {
        currentChartInstance.destroy();
        currentChartInstance = null;
    }
}

function mountChildService(service) {
    const container = document.getElementById('router-view');
    currentWebSocket = new WebSocket(service.ws_url);

    currentWebSocket.onmessage = (event) => {
        if (!isRegistryOnline) return;
        const data = JSON.parse(event.data);
        if (data.type === 'parabola' || (data.x && data.y && data.equation)) {
            renderParabola(data, container);
            return;
        }

        // Графики
        if (data.labels && data.values) {
            if (!currentChartInstance) {
                container.innerHTML = `<canvas id="chart-canvas"></canvas>`;
                const ctx = document.getElementById('chart-canvas').getContext('2d');
                currentChartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: data.labels,
                        datasets: [{ label: data.title, data: data.values, backgroundColor: '#38bdf8' }]
                    },
                    options: { responsive: true, maintainAspectRatio: false }
                });
            } else {
                currentChartInstance.data.labels = data.labels;
                currentChartInstance.data.datasets[0].data = data.values;
                currentChartInstance.update();
            }
        }
        // Таблицы
        else if (data.headers && data.rows) {
            let tableHTML = `<h3 style="text-align: center;">${data.title}</h3><table><thead><tr>`;
            data.headers.forEach(h => tableHTML += `<th style="text-align: center;">${h}</th>`);
            tableHTML += `</tr ></thead><tbody>`;
            data.rows.forEach(row => {
                tableHTML += `<tr>`;
                row.forEach(cell => tableHTML += `<td style="text-align: center;">${cell}</td>`);
                tableHTML += `</tr>`;
            });
            tableHTML += `</tbody></table>`;
            container.innerHTML = tableHTML;
        }
        //Таблицы для серверов Consul
        else if (Array.isArray(data)) {
            let tableHTML = `
                <h3 style="text-align: center;">Данные Consul</h3>
                <table>
                    <thead>
                        <tr>
                            <th style="text-align: center;">Key</th>
                            <th style="text-align: center;">Value</th>
                            <th style="text-align: center;">CreateIndex</th>
                        </tr>
                    </thead>
                    <tbody>`;

            data.forEach(entry => {
                tableHTML += `
                    <tr>
                        <td style="font-family: monospace; color: var(--accent); font-weight: bold; text-align: center;">${entry.key || '—'}</td>
                        <td style="text-align: center;">${entry.value !== null ? entry.value : '<span style="color: #64748b;">null</span>'}</td>
                        <td style="color: #64748b; text-align: center;">${entry.createIndex || '—'}</td>
                    </tr>`;
            });

            tableHTML += `</tbody></table>`;
            container.innerHTML = tableHTML;
        }
    };

    currentWebSocket.onerror = () => {
        if (isRegistryOnline) {
            container.innerHTML = `<div class="loading" style="color:var(--danger);"><i class="fa-solid fa-circle-exclamation"></i> Сервис данных (${service.name}) недоступен.</div>`;
        }
    };
}

// рендеринг параболы
function renderParabola(data, container) {
    console.log('renderParabola получила данные:', data);

    if (data.params) {
        parabolaParams = data.params;
    }
    
    if (!currentChartInstance) {
        container.innerHTML = `
            <div class="parabola-wrapper">
                <div class="parabola-container">
                    <canvas id="chart-canvas"></canvas>
                </div>
                <div class="parabola-controls">
                    <div class="parabola-equation">
                        ${data.title || data.equation || 'y = x²'}
                    </div>
                    <div class="parabola-sliders">
                        <label>
                            a: <input type="range" id="paramA" min="-5" max="5" step="0.1" value="${parabolaParams.a || 1}">
                            <span class="value" id="paramAValue">${(parabolaParams.a || 1).toFixed(1)}</span>
                        </label>
                        <label>
                            b: <input type="range" id="paramB" min="-5" max="5" step="0.1" value="${parabolaParams.b || 0}">
                            <span class="value" id="paramBValue">${(parabolaParams.b || 0).toFixed(1)}</span>
                        </label>
                        <label>
                            c: <input type="range" id="paramC" min="-5" max="5" step="0.1" value="${parabolaParams.c || 0}">
                            <span class="value" id="paramCValue">${(parabolaParams.c || 0).toFixed(1)}</span>
                        </label>
                    </div>
                </div>
            </div>
        `;
        
        const ctx = document.getElementById('chart-canvas').getContext('2d');
        const points = data.x.map((x, i) => ({ x: x, y: data.y[i] }));
        
        currentChartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: data.equation || 'Парабола',
                    data: points,
                    borderColor: CHART_STYLES.borderColor,
                    backgroundColor: CHART_STYLES.backgroundColor,
                    showLine: CHART_STYLES.showLine,
                    pointRadius: CHART_STYLES.pointRadius,
                    tension: CHART_STYLES.tension,
                    borderWidth: CHART_STYLES.borderWidth
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: true,
                        labels: {
                            font: CHART_STYLES.font,
                            color: CHART_STYLES.legendColor,
                            usePointStyle: true,
                            padding: 20
                        }
                    },
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'xy',
                            modifierKey: 'shift'
                        },
                        zoom: {
                            wheel: {
                                enabled: true,
                                speed: 0.05
                            },
                            pinch: {
                                enabled: true
                            },
                            mode: 'xy'
                        },
                        limits: {
                            x: { minRange: 0.5 },
                            y: { minRange: 0.5 }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        grid: { color: CHART_STYLES.gridColor },
                        title: {
                            display: true,
                            text: 'X',
                            color: CHART_STYLES.axisColor
                        }
                    },
                    y: {
                        grid: { color: CHART_STYLES.gridColor },
                        title: {
                            display: true,
                            text: 'Y',
                            color: CHART_STYLES.axisColor
                        }
                    }
                }
            }
        });
        
        document.getElementById('paramA').addEventListener('input', function() {
            const val = parseFloat(this.value);
            document.getElementById('paramAValue').textContent = val.toFixed(1);
            parabolaParams.a = val;
            sendParabolaParams({ a: val });
        });
        document.getElementById('paramB').addEventListener('input', function() {
            const val = parseFloat(this.value);
            document.getElementById('paramBValue').textContent = val.toFixed(1);
            parabolaParams.b = val;
            sendParabolaParams({ b: val });
        });
        document.getElementById('paramC').addEventListener('input', function() {
            const val = parseFloat(this.value);
            document.getElementById('paramCValue').textContent = val.toFixed(1);
            parabolaParams.c = val;
            sendParabolaParams({ c: val });
        });
    } else {
        const points = data.x.map((x, i) => ({ x: x, y: data.y[i] }));
        currentChartInstance.data.datasets[0].data = points;
        currentChartInstance.data.datasets[0].label = data.equation || 'Парабола';
        currentChartInstance.update();
        
        const equationElement = container.querySelector('.parabola-equation');
        if (equationElement) {
            equationElement.textContent = data.title || data.equation || 'y = x²';
        }
    }
}
function sendParabolaParams(params) {
    if (currentWebSocket && currentWebSocket.readyState === WebSocket.OPEN) {
        currentWebSocket.send(JSON.stringify(params));
        console.log('Отправлены параметры:', params);
    }
}
window.onload = init;