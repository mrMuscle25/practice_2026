const REGISTRY_WS_URL = 'ws://localhost:8000/ws/registry';

let routingMap = [];
let registrySocket = null;
let currentWebSocket = null;
let currentChartInstance = null;
let isRegistryOnline = false;
let parabolaParams = { a: 1, b: 0, c: 0 };

const CHART_STYLES = {
    borderColor: '#4fc3f7',
    backgroundColor: 'rgba(79, 195, 247, 0.1)',
    showLine: true,
    pointRadius: 0,
    tension: 0.1,
    borderWidth: 2,
    legendColor: '#38bdf8',
    gridColor: 'rgba(0,0,0,0.05)',
    axisColor: '#888',
    font: {
        size: 14,
        weight: 'bold'
    }
};

let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeControls = null;
let threeMesh = null;
let threeAnimationId = null;

let threePathPoints = [];
let threeLine = null;
let threeDot = null;

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

        if (!isRegistryOnline) {
            isRegistryOnline = true;
            routingMap = newServices;
            buildMenu(routingMap);
            document.getElementById('router-view').innerHTML = "";
            router();
            return;
        }

        if (JSON.stringify(routingMap) !== JSON.stringify(newServices)) {
            const wasNetworkEmpty = routingMap.length === 0;
            routingMap = newServices;
            buildMenu(routingMap);

            const currentPath = window.location.hash.replace('#', '');
            const stillExists = routingMap.some(srv => srv.path === currentPath);

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
        setTimeout(connectToRegistry, 3000);
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

    if (threeLine && threeScene) threeScene.remove(threeLine);
    if (threeDot && threeScene) threeScene.remove(threeDot);
    threePathPoints = [];
    threeLine = null;
    threeDot = null;

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

        if (data.type === 'parabola' || (data.x && data.y && data.equation)) {
            renderParabola(data, container);
            return;
        }

if (service.type === "newton_3d" || data.event === "step" || data.event === "finished") {
            if (!threeScene) {
                threePathPoints = [];
                container.style.position = "relative";
                container.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 15px; height: 100%;">
                        <div style="display: flex; justify-content: flex-start; align-items: center; gap: 20px; padding: 10px 0;">
                            <button id="start-newton-3d-btn" style="padding: 10px 20px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;">
                                <i class="fa-solid fa-play"></i> Запустить 3D спуск
                            </button>
                            <button id="stop-newton-3d-btn" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; display:none;">
                                <i class="fa-solid fa-stop"></i> Стоп
                            </button>
                            <div id="newton-3d-status" style="color: #94a3b8; font-size: 0.95rem;">Готов к запуску</div>
                        </div>
                        <div id="threejs-canvas-container" style="flex-grow: 1; width: 100%; height: 100%; min-height: 450px;"></div>
                    </div>
                `;

                document.getElementById('start-newton-3d-btn').addEventListener('click', () => {
                    if (currentWebSocket && currentWebSocket.readyState === WebSocket.OPEN) {
                        if (threeLine) threeScene.remove(threeLine);
                        if (threeDot) threeScene.remove(threeDot);
                        threePathPoints = [];
                        threeLine = null;
                        threeDot = null;

                        const randomX = (Math.random() * 10) - 5;
                        const randomY = (Math.random() * 10) - 5;

                        currentWebSocket.send(JSON.stringify({ action: "start", x: randomX, y: randomY }));

                        document.getElementById('start-newton-3d-btn').style.display = 'none';
                        document.getElementById('stop-newton-3d-btn').style.display = 'inline-block';
                    }
                });

                document.getElementById('stop-newton-3d-btn').addEventListener('click', () => {
                    if (currentWebSocket && currentWebSocket.readyState === WebSocket.OPEN) {
                        currentWebSocket.send(JSON.stringify({ action: "stop" }));
                        document.getElementById('start-newton-3d-btn').style.display = 'inline-block';
                        document.getElementById('stop-newton-3d-btn').style.display = 'none';
                        document.getElementById('newton-3d-status').innerText = "Спуск остановлен пользователем";
                    }
                });

                const canvasContainer = document.getElementById('threejs-canvas-container');
                const width = canvasContainer.clientWidth;
                const height = canvasContainer.clientHeight;

                threeScene = new THREE.Scene();
                threeScene.background = new THREE.Color(0x1e293b);

                threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
                threeCamera.position.set(15, 15, 20);

                threeRenderer = new THREE.WebGLRenderer({ antialias: true });
                threeRenderer.setSize(width, height);
                canvasContainer.appendChild(threeRenderer.domElement);

                threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
                threeControls.enableDamping = true;

                threeScene.add(new THREE.AmbientLight(0xffffff, 0.6));
                const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
                dirLight.position.set(20, 40, 20);
                threeScene.add(dirLight);

                const gridHelper = new THREE.GridHelper(20, 20, 0x475569, 0x334155);
                gridHelper.position.y = -0.01;
                threeScene.add(gridHelper);

                const segments = 60;
                const surfaceGeo = new THREE.PlaneGeometry(20, 20, segments, segments);
                surfaceGeo.rotateX(-Math.PI / 2);

                const pos = surfaceGeo.attributes.position;
                for (let i = 0; i < pos.count; i++) {
                    const x_val = pos.getX(i);
                    const z_val = pos.getZ(i);

                    const y_height = 0.1 * (x_val ** 2) + 0.05 * x_val * z_val + 0.06 * (z_val ** 2);

                    pos.setY(i, y_height);
                }
                surfaceGeo.computeVertexNormals();

                const surfaceMat = new THREE.MeshStandardMaterial({
                    color: 0x0284c7,
                    wireframe: false,
                    side: THREE.DoubleSide,
                    roughness: 0.4
                });
                threeMesh = new THREE.Mesh(surfaceGeo, surfaceMat);
                threeScene.add(threeMesh);

                const wireframe = new THREE.LineSegments(
                    new THREE.WireframeGeometry(surfaceGeo),
                    new THREE.LineBasicMaterial({ color: 0x000000, opacity: 0.15, transparent: true })
                );
                threeScene.add(wireframe);

                const animate = () => {
                    if (!threeScene) return;
                    threeAnimationId = requestAnimationFrame(animate);
                    threeControls.update();
                    threeRenderer.render(threeScene, threeCamera);
                };
                animate();
            }

            if (data.event === "step") {
                const statusDiv = document.getElementById('newton-3d-status');
                if (statusDiv) {
                    statusDiv.innerHTML = `Шаг спуска: X = <span style="color:#ef4444; font-weight:bold;">${data.x.toFixed(3)}</span>, Y = <span style="color:#ef4444; font-weight:bold;">${data.y.toFixed(3)}</span>, Z = <span style="color:#a855f7; font-weight:bold;">${data.z.toFixed(3)}</span>`;
                }

                const visualHeight = 0.1 * (data.x ** 2) + 0.05 * data.x * data.y + 0.06 * (data.y ** 2);
                const newPoint = new THREE.Vector3(data.x, visualHeight, data.y);
                threePathPoints.push(newPoint);

                if (!threeDot) {
                    threeDot = new THREE.Mesh(
                        new THREE.SphereGeometry(0.25, 32, 32),
                        new THREE.MeshBasicMaterial({ color: 0xff0055 })
                    );
                    threeScene.add(threeDot);
                }
                threeDot.position.copy(newPoint);

                if (threeLine) threeScene.remove(threeLine);
                const lineGeo = new THREE.BufferGeometry().setFromPoints(threePathPoints);
                const lineMat = new THREE.LineBasicMaterial({ color: 0xff3300, linewidth: 3 });
                threeLine = new THREE.Line(lineGeo, lineMat);
                threeScene.add(threeLine);
            }

            if (data.event === "finished") {
                const statusDiv = document.getElementById('newton-3d-status');
                if (statusDiv) {
                    statusDiv.innerHTML = `Минимум найден: X = <span style="color:#22c55e; font-weight:bold;">${data.x.toFixed(3)}</span>, Y = <span style="color:#22c55e; font-weight:bold;">${data.y.toFixed(3)}</span>, Z = <span style="color:#22c55e; font-weight:bold;">${data.z.toFixed(3)}</span>`;
                }

                document.getElementById('start-newton-3d-btn').style.display = 'inline-block';
                document.getElementById('stop-newton-3d-btn').style.display = 'none';
            }

            return;
        }

        // 3D-графики
        if (service.type === "3d_chart" || (data.x && data.y && data.z)) {
            if (!threeScene) {
                container.style.position = "relative";
                container.innerHTML = `<div id="threejs-canvas-container" style="flex-grow: 1; width: 100%; height: 100%; min-height: 500px;"></div>`;

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

                const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
                threeScene.add(ambientLight);

                const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
                dirLight.position.set(10, 20, 10);
                threeScene.add(dirLight);

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
                    positions[index] = x_val;
                    positions[index + 1] = y_val;
                    positions[index + 2] = ((raw_z - zMin) / zRange) * scaleZ - (scaleZ / 2);
                    index += 3;
                }
            }

            geometry.computeVertexNormals();
            const material = new THREE.MeshPhongMaterial({ color: 0x38bdf8, wireframe: true, side: THREE.DoubleSide, flatShading: true });

            if (threeMesh) {
                threeScene.remove(threeMesh);
                threeMesh.geometry.dispose();
            }
            threeMesh = new THREE.Mesh(geometry, material);
            threeMesh.rotation.x = -Math.PI / 2;
            threeScene.add(threeMesh);
        }

        // 2D Ньютон-оптимизация
        if (service.type === "newton_chart" || data.type === "newton") {
            if (!currentChartInstance) {
                container.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 15px; height: 100%;">
                        <div style="display: flex; justify-content: flex-start; align-items: center; gap: 20px;">
                            <button id="start-newton-btn" style="padding: 10px 20px; background: #0284c7; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s;">
                                <i class="fa-solid fa-play"></i> Поиск минимума
                            </button>
                            <div id="newton-status" style="color: #94a3b8; font-size: 0.95rem;">Готов к запуску</div>
                        </div>
                        <div style="flex-grow: 1; position: relative; height: 350px;">
                            <canvas id="chart-canvas"></canvas>
                        </div>
                    </div>
                `;

                document.getElementById('start-newton-btn').addEventListener('click', () => {
                    if (currentWebSocket && currentWebSocket.readyState === WebSocket.OPEN) {
                        currentWebSocket.send(JSON.stringify({ action: "start_optimization" }));
                    }
                });

                const ctx = document.getElementById('chart-canvas').getContext('2d');
                currentChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.x_base,
                        datasets: [
                            {
                                label: 'График функции f(x)',
                                data: data.y_base,
                                borderColor: '#38bdf8',
                                borderWidth: 2,
                                pointRadius: 0,
                                fill: false,
                                tension: 0.1
                            },
                            {
                                label: 'Шаги метода Ньютона',
                                data: data.opt_y,
                                borderColor: '#ef4444',
                                backgroundColor: '#ef4444',
                                borderWidth: 2,
                                pointRadius: 5,
                                pointHoverRadius: 7,
                                showLine: true,
                                fill: false,
                                type: 'line'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                type: 'linear',
                                position: 'bottom',
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: '#888' }
                            },
                            y: {
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: '#888' }
                            }
                        }
                    }
                });
            } else {
                const basePoints = data.x_base.map((x, i) => ({ x: x, y: data.y_base[i] }));
                const optPoints = data.opt_x.map((x, i) => ({ x: x, y: data.opt_y[i] }));

                currentChartInstance.data.datasets[0].data = basePoints;
                currentChartInstance.data.datasets[1].data = optPoints;
                currentChartInstance.update('none');

                const btn = document.getElementById('start-newton-btn');
                const statusDiv = document.getElementById('newton-status');

                if (btn && statusDiv) {
                    if (data.is_running) {
                        btn.disabled = true;
                        btn.style.background = '#334155';
                        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Вычисление...`;
                        if (data.current_x !== null) {
                            statusDiv.innerHTML = `Текущая точка: X = <span style="color:#ef4444; font-weight:bold;">${data.current_x.toFixed(4)}</span>`;
                        }
                    } else {
                        btn.disabled = false;
                        btn.style.background = '#0284c7';
                        btn.innerHTML = `<i class="fa-solid fa-play"></i> Поиск минимума`;
                        if (data.opt_x.length > 0) {
                            const finalX = data.opt_x[data.opt_x.length - 1];
                            statusDiv.innerHTML = `Минимум найден в: X = <span style="color:#22c55e; font-weight:bold;">${finalX.toFixed(4)}</span>`;
                        } else {
                            statusDiv.innerText = "Готов к запуску";
                        }
                    }
                }
            }
            return;
        }

        // Стандартные 2D-Графики
        else if (data.labels && data.values) {
            if (!currentChartInstance) {
                container.innerHTML = `
                    <div id="stats-legend" style="display: none; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; padding: 15px; background: #24334d; border-radius: 8px; border-left: 4px solid var(--accent); justify-content: space-around;"></div>
                    <div style="flex-grow: 1; position: relative; height: 300px;"><canvas id="chart-canvas"></canvas></div>
                `;

                const ctx = document.getElementById('chart-canvas').getContext('2d');
                currentChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [{ label: data.title, data: data.values, borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.1)', tension: 0.2, fill: true }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
                });
            } else {
                currentChartInstance.data.labels = data.labels;
                currentChartInstance.data.datasets[0].data = data.values;
                currentChartInstance.update();
            }

            const legendContainer = document.getElementById('stats-legend');
            if (legendContainer && data.stats) {
                legendContainer.style.display = 'flex';
                legendContainer.innerHTML = `
                    <div style="text-align: center;"><span style="color: #94a3b8; font-size: 0.8rem;">Мат. ожидание</span><div style="font-size: 1.3rem; font-weight: bold; color: #fff;">${data.stats.mo}</div></div>
                    <div style="text-align: center;"><span style="color: #94a3b8; font-size: 0.8rem;">СКО</span><div style="font-size: 1.3rem; font-weight: bold; color: var(--accent);">${data.stats.sko}</div></div>
                    <div style="text-align: center;"><span style="color: #94a3b8; font-size: 0.8rem;">СКЗ</span><div style="font-size: 1.3rem; font-weight: bold; color: #a855f7;">${data.stats.skz}</div></div>
                    <div style="text-align: center;"><span style="color: #ef4444; font-size: 0.8rem;">Минимум</span><div style="font-size: 1.3rem; font-weight: bold; color: #fca5a5;">${data.stats.min}</div></div>
                    <div style="text-align: center;"><span style="color: #22c55e; font-size: 0.8rem;">Максимум</span><div style="font-size: 1.3rem; font-weight: bold; color: #86efac;">${data.stats.max}</div></div>
                `;
            }
        }

        // Таблицы данных
        else if (data.headers && data.rows) {
            let tableHTML = `<h3 style="text-align: center;">${data.title}</h3><table><thead><tr>`;
            data.headers.forEach(h => tableHTML += `<th style="text-align: center;">${h}</th>`);
            tableHTML += `</tr></thead><tbody>`;
            data.rows.forEach(row => {
                tableHTML += `<tr>`;
                row.forEach(cell => tableHTML += `<td style="text-align: center;">${cell}</td>`);
                tableHTML += `</tr>`;
            });
            tableHTML += `</tbody></table>`;
            container.innerHTML = tableHTML;
        }

        // Серверы Consul
        else if (Array.isArray(data)) {
            let tableHTML = `<h3 style="text-align: center;">Данные Consul</h3><table><thead><tr><th style="text-align: center;">Key</th><th style="text-align: center;">Value</th><th style="text-align: center;">CreateIndex</th></tr></thead><tbody>`;
            data.forEach(entry => {
                tableHTML += `<tr><td style="font-family: monospace; color: var(--accent); font-weight: bold; text-align: center;">${entry.key || '—'}</td><td style="text-align: center;">${entry.value !== null ? entry.value : 'null'}</td><td style="color: #64748b; text-align: center;">${entry.createIndex || '—'}</td></tr>`;
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

function renderParabola(data, container) {
    console.log('renderParabola получила данные:', data);

    if (data.params) {
        parabolaParams = data.params;
    }

    const getPercent = (val, min = -5, max = 5) => ((val - min) / (max - min)) * 100;

    if (!currentChartInstance) {
        container.innerHTML = `
            <div class="parabola-wrapper" style="display: flex; flex-direction: column; height: 100%; font-family: sans-serif;">
                <div class="parabola-container" style="flex-grow: 1; position: relative; height: 350px;">
                    <canvas id="chart-canvas"></canvas>
                </div>
                <div class="parabola-controls-compact" style="padding: 20px 10px; display: flex; flex-direction: column; gap: 20px;">
                    <div class="parabola-equation-styled" style="font-size: 1.8rem; font-weight: bold; color: #ffffff; text-align: left;">
                        y = <span class="term-a" style="color: #38bdf8;">${(parabolaParams.a || 1).toFixed(1)}x²</span> +
                        <span class="term-b" style="color: #38bdf8;">${(parabolaParams.b || 0).toFixed(1)}x</span> +
                        <span class="term-c" style="color: #38bdf8;">${(parabolaParams.c || 0).toFixed(1)}</span>
                    </div>
                    <div class="sliders-row" style="display: flex; justify-content: space-between; align-items: center; gap: 30px; width: 100%;">
                        <div class="slider-group" style="display: flex; align-items: center; flex: 1; gap: 12px;">
                            <span class="slider-label" style="color: #94a3b8; font-size: 1.1rem; font-weight: 500; min-width: 15px;">a:</span>
                            <input type="range" id="paramA" min="-5" max="5" step="0.1" value="${parabolaParams.a || 1}" class="custom-slider">
                            <span class="slider-value value-a" id="paramAValue" style="color: #38bdf8; font-size: 1.1rem; min-width: 35px; text-align: left;">${(parabolaParams.a || 1).toFixed(1)}</span>
                        </div>
                        <div class="slider-group" style="display: flex; align-items: center; flex: 1; gap: 12px;">
                            <span class="slider-label" style="color: #94a3b8; font-size: 1.1rem; font-weight: 500; min-width: 15px;">b:</span>
                            <input type="range" id="paramB" min="-5" max="5" step="0.1" value="${parabolaParams.b || 0}" class="custom-slider">
                            <span class="slider-value value-b" id="paramBValue" style="color: #38bdf8; font-size: 1.1rem; min-width: 35px; text-align: left;">${(parabolaParams.b || 0).toFixed(1)}</span>
                        </div>
                        <div class="slider-group" style="display: flex; align-items: center; flex: 1; gap: 12px;">
                            <span class="slider-label" style="color: #94a3b8; font-size: 1.1rem; font-weight: 500; min-width: 15px;">c:</span>
                            <input type="range" id="paramC" min="-5" max="5" step="0.1" value="${parabolaParams.c || 0}" class="custom-slider">
                            <span class="slider-value value-c" id="paramCValue" style="color: #38bdf8; font-size: 1.1rem; min-width: 35px; text-align: left;">${(parabolaParams.c || 0).toFixed(1)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;

        if (!document.getElementById('custom-slider-styles')) {
            const style = document.createElement('style');
            style.id = 'custom-slider-styles';
            style.innerHTML = `
                .custom-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 100%;
                    height: 8px;
                    border-radius: 4px;
                    outline: none;
                    cursor: pointer;
                    background: #ffffff;
                }
                .custom-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #38bdf8;
                    box-shadow: 0 0 0 4px #0284c7;
                    transition: transform 0.1s ease;
                }
                .custom-slider::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #38bdf8;
                    border: 4px solid #0284c7;
                    transition: transform 0.1s ease;
                }
                .custom-slider:active::-webkit-slider-thumb {
                    transform: scale(1.2);
                }
            `;
            document.head.appendChild(style);
        }

        const updateFill = (input) => {
            const percent = getPercent(parseFloat(input.value), parseFloat(input.min), parseFloat(input.max));
            input.style.background = `linear-gradient(to right, #0284c7 0%, #0284c7 ${percent}%, #ffffff ${percent}%, #ffffff 100%)`;
        };

        const inputs = [document.getElementById('paramA'), document.getElementById('paramB'), document.getElementById('paramC')];
        inputs.forEach(updateFill);

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
                        pan: { enabled: true, mode: 'xy', modifierKey: 'shift' },
                        zoom: {
                            wheel: { enabled: true, speed: 0.05 },
                            pinch: { enabled: true },
                            mode: 'xy'
                        },
                        limits: { x: { minRange: 0.5 }, y: { minRange: 0.5 } }
                    }
                },
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        grid: { color: CHART_STYLES.gridColor },
                        title: { display: true, text: 'X', color: CHART_STYLES.axisColor }
                    },
                    y: {
                        grid: { color: CHART_STYLES.gridColor },
                        title: { display: true, text: 'Y', color: CHART_STYLES.axisColor }
                    }
                }
            }
        });

        document.getElementById('paramA').addEventListener('input', function() {
            const val = parseFloat(this.value);
            updateFill(this);
            document.getElementById('paramAValue').textContent = val.toFixed(1);
            parabolaParams.a = val;
            sendParabolaParams({ a: val });
        });
        document.getElementById('paramB').addEventListener('input', function() {
            const val = parseFloat(this.value);
            updateFill(this);
            document.getElementById('paramBValue').textContent = val.toFixed(1);
            parabolaParams.b = val;
            sendParabolaParams({ b: val });
        });
        document.getElementById('paramC').addEventListener('input', function() {
            const val = parseFloat(this.value);
            updateFill(this);
            document.getElementById('paramCValue').textContent = val.toFixed(1);
            parabolaParams.c = val;
            sendParabolaParams({ c: val });
        });
    } else {
        const points = data.x.map((x, i) => ({ x: x, y: data.y[i] }));
        currentChartInstance.data.datasets[0].data = points;
        currentChartInstance.data.datasets[0].label = data.equation || 'Парабола';
        currentChartInstance.update();

        ['A', 'B', 'C'].forEach(p => {
            const key = p.toLowerCase();
            const input = document.getElementById(`param${p}`);
            const valueSpan = document.getElementById(`param${p}Value`);
            if (input && data.params && data.params[key] !== undefined) {
                input.value = data.params[key];
                const percent = getPercent(data.params[key], parseFloat(input.min), parseFloat(input.max));
                input.style.background = `linear-gradient(to right, #0284c7 0%, #0284c7 ${percent}%, #ffffff ${percent}%, #ffffff 100%)`;
                if (valueSpan) valueSpan.textContent = data.params[key].toFixed(1);
            }
        });

        const eqElement = container.querySelector('.parabola-equation-styled');
        if (eqElement && data.params) {
            eqElement.innerHTML = `
                y = <span class="term-a" style="color: #38bdf8;">${data.params.a.toFixed(1)}x²</span> +
                <span class="term-b" style="color: #38bdf8;">${data.params.b.toFixed(1)}x</span> +
                <span class="term-c" style="color: #38bdf8;">${data.params.c.toFixed(1)}</span>
            `;
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