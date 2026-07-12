const REGISTRY_WS_URL = 'ws://localhost:8000/ws/registry';

let routingMap = [];
let registrySocket = null;
let currentWebSocket = null;
let currentChartInstance = null;
let isRegistryOnline = false;

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

window.onload = init;