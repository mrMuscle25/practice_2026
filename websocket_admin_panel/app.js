const REGISTRY_WS_URL = 'ws://localhost:8000/ws/registry';

let routingMap = [];
let registrySocket = null;
let currentWebSocket = null;
let currentChartInstance = null;
let isRegistryOnline = false;

let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeControls = null;
let threeMesh = null;
let threeAnimationId = null;

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
    if (threeAnimationId) {
        cancelAnimationFrame(threeAnimationId);
        threeAnimationId = null;
    }
    if (threeRenderer) {
        threeRenderer.dispose();
        threeRenderer = null;
    }
    threeScene = null;
    threeCamera = null;
    threeControls = null;
    threeMesh = null;
}

function mountChildService(service) {
    const container = document.getElementById('router-view');
    currentWebSocket = new WebSocket(service.ws_url);

    currentWebSocket.onmessage = (event) => {
        if (!isRegistryOnline) return;
        const data = JSON.parse(event.data);

        // 3D-графики
        if (service.type === "3d_chart" || (data.x && data.y && data.z)) {
            if (!threeScene) {
                container.style.position = "relative";
                container.innerHTML = `
                    <div id="threejs-canvas-container" style="flex-grow: 1; width: 100%; height: 100%; min-height: 500px;"></div>
                `;

                const canvasContainer = document.getElementById('threejs-canvas-container');
                const width = canvasContainer.clientWidth;
                const height = canvasContainer.clientHeight;

                threeScene = new THREE.Scene();
                threeScene.background = new THREE.Color(0x1e293b);

                threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
                threeCamera.position.set(25, 20, 25);

                threeRenderer = new THREE.WebGLRenderer({ antialias: true });
                threeRenderer.setSize(width, height);
                canvasContainer.appendChild(threeRenderer.domElement);

                threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
                threeControls.enableDamping = true;
                threeControls.dampingFactor = 0.05;

                // Освещение
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
                threeScene.add(ambientLight);

                const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
                dirLight.position.set(10, 20, 10);
                threeScene.add(dirLight);

                // Координатные оси и сетка пола
                const axesHelper = new THREE.AxesHelper(12);
                axesHelper.position.y = -5.05;
                threeScene.add(axesHelper);

                const gridHelper = new THREE.GridHelper(30, 15, 0x475569, 0x334155);
                gridHelper.position.y = -5.1;
                threeScene.add(gridHelper);

                const animate = () => {
                    if (!threeScene) return;
                    threeAnimationId = requestAnimationFrame(animate);
                    threeControls.update();
                    threeRenderer.render(threeScene, threeCamera);
                };
                animate();

                window.addEventListener('resize', () => {
                    if (!threeRenderer || !canvasContainer) return;
                    const w = canvasContainer.clientWidth;
                    const h = canvasContainer.clientHeight;
                    threeCamera.aspect = w / h;
                    threeCamera.updateProjectionMatrix();
                    threeRenderer.setSize(w, h);
                });
            }

            const resolution = data.x.length;
            const geometry = new THREE.PlaneGeometry(20, 20, resolution - 1, resolution - 1);

            const positions = geometry.attributes.position.array;
            let index = 0;

            const zMin = data.bounds.z_min;
            const zMax = data.bounds.z_max;
            const zRange = (zMax - zMin) || 1.0;
            const scaleZ = 8.0;

            for (let i = 0; i < resolution; i++) {
                for (let j = 0; j < resolution; j++) {
                    const x_val = ((i / (resolution - 1)) - 0.5) * 20;
                    const y_val = ((j / (resolution - 1)) - 0.5) * 20;

                    const raw_z = data.z[i][j];
                    const normalized_z = ((raw_z - zMin) / zRange) * scaleZ - (scaleZ / 2);

                    positions[index] = x_val;
                    positions[index + 1] = y_val;
                    positions[index + 2] = normalized_z;
                    index += 3;
                }
            }

            geometry.computeVertexNormals();

            const material = new THREE.MeshPhongMaterial({
                color: 0x38bdf8,
                wireframe: true,
                side: THREE.DoubleSide,
                flatShading: true
            });

            if (threeMesh) {
                threeScene.remove(threeMesh);
                threeMesh.geometry.dispose();
            }

            threeMesh = new THREE.Mesh(geometry, material);
            threeMesh.rotation.x = -Math.PI / 2;
            threeScene.add(threeMesh);
        }

        // 2D-Графики
        if (data.labels && data.values) {
            if (!currentChartInstance) {
                container.innerHTML = `<canvas id="chart-canvas"></canvas>`;
                const ctx = document.getElementById('chart-canvas').getContext('2d');
                currentChartInstance = new Chart(ctx, {
                    type: 'bubble',
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