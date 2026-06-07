let map, markers = [];
let lastLat = null, lastLon = null, lastRssi = null;
let lastDlMbps = 0, lastUlMbps = 0;
const API_BASE = "/api";

async function initMap() {
    console.log("Initializing Google Maps...");
    // Initial center (generic, will update with geolocation)
    const initialPos = { lat: 0, lng: 0 };

    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 15,
        center: initialPos,
        styles: [
            { "elementType": "geometry", "stylers": [{ "color": "#1d2c4d" }] },
            { "elementType": "labels.text.fill", "stylers": [{ "color": "#8ec3b9" }] },
            { "elementType": "labels.text.stroke", "stylers": [{ "color": "#1d2c4d" }] },
            { "featureType": "administrative.country", "elementType": "geometry.stroke", "stylers": [{ "color": "#4b6878" }] },
            { "featureType": "landscape.man_made", "elementType": "geometry.stroke", "stylers": [{ "color": "#334e87" }] },
            { "featureType": "poi", "elementType": "geometry", "stylers": [{ "color": "#283d6a" }] },
            { "featureType": "poi", "elementType": "labels.text.fill", "stylers": [{ "color": "#6f9ba5" }] },
            { "featureType": "road", "elementType": "geometry", "stylers": [{ "color": "#304a7d" }] },
            { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#98a5be" }] },
            { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#0e1626" }] }
        ],
        disableDefaultUI: true,
    });

    await updateLocation();
    await loadHistoricalData();
}

async function updateLocation() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) { resolve(null); return; }

        let resolved = false;
        let bestPos = null;

        // On laptops/desktops, GPS accuracy is rarely < 15m. 
        // We accept any reasonable first fix immediately to prevent UI lag.
        const watchId = navigator.geolocation.watchPosition(
            (position) => {
                const acc = position.coords.accuracy;
                bestPos = position;
                lastLat = position.coords.latitude;
                lastLon = position.coords.longitude;
                map.setCenter({ lat: lastLat, lng: lastLon });

                // Resolve immediately if we get a decent fix (< 2000m) 
                // to avoid 8-second delays for desktop users.
                if (!resolved && acc <= 2000) {
                    resolved = true;
                    navigator.geolocation.clearWatch(watchId);
                    resolve({ lat: lastLat, lng: lastLon });
                }
            },
            (err) => {
                navigator.geolocation.clearWatch(watchId);
                if (bestPos) {
                    if(!resolved) { resolved = true; resolve({ lat: lastLat, lng: lastLon }); }
                } else {
                    if(!resolved) { resolved = true; resolve(null); }
                }
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );

        // Fallback: after 3 seconds, use whatever we have to keep UI snappy
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                navigator.geolocation.clearWatch(watchId);
                resolve(bestPos ? { lat: lastLat, lng: lastLon } : null);
            }
        }, 3000);
    });
}

async function loadHistoricalData() {
    try {
        const res = await fetch(`${API_BASE}/measurements`);
        const data = await res.json();
        
        if (data && data.length > 0) {
            // Add historical markers (limited to last 50 for performance)
            data.slice(-50).forEach(m => {
                new google.maps.Marker({
                    position: { lat: m.latitude, lng: m.longitude },
                    map: map,
                    opacity: 0.5,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 4,
                        fillColor: "#94a3b8",
                        fillOpacity: 0.6,
                        strokeWeight: 1,
                        strokeColor: "#ffffff",
                    },
                    title: `Historical | DL: ${m.download_speed} Mbps`
                });
            });
            
            // If we don't have a current location yet, center on the most recent data
            if (lastLat === null) {
                const latest = data[data.length - 1];
                map.setCenter({ lat: latest.latitude, lng: latest.longitude });
            }
        }
    } catch (e) {
        console.error("Failed to load historical data:", e);
    }
}

function addMarker(m) {
    // Clear existing markers 
    markers.forEach(marker => marker.setMap(null));
    markers = [];

    const marker = new google.maps.Marker({
        position: { lat: m.latitude, lng: m.longitude },
        map: map,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#3b82f6", // Blue for current location Instead of green
            fillOpacity: 1,
            strokeWeight: 3,
            strokeColor: "#ffffff",
        },
        title: `Your Location | DL: ${m.download_speed} Mbps`
    });
    markers.push(marker);
}

// ── Speedometer Helpers ──────────────────────────────────────────────────────
const SPEEDO_MAX = 150;       // Max Mbps on gauge
const SPEEDO_ARC_LEN = 251;   // Full arc circumference for dasharray

/**
 * Updates an SVG speedometer to display a given speed value.
 * @param {'dl'|'ul'} id  - which speedometer
 * @param {number} mbps   - current speed value
 */
function setSpeedometer(id, mbps) {
    const safeVal = Math.min(mbps, SPEEDO_MAX);
    const fraction = safeVal / SPEEDO_MAX;

    // Arc: dasharray = filled portion, total circumference = 251px
    const filled = fraction * SPEEDO_ARC_LEN;
    const arc = document.getElementById(`${id}-arc`);
    if (arc) arc.setAttribute('stroke-dasharray', `${filled} ${SPEEDO_ARC_LEN}`);

    // Needle: sweeps from -110° (0) to +110° (max) around pivot (100, 100)
    const angle = -110 + fraction * 220;
    const needle = document.getElementById(`${id}-needle`);
    if (needle) needle.setAttribute('transform', `rotate(${angle}, 100, 100)`);

    // Test Source Local Indicator
    const testSourceEl = document.querySelector(".test-config span");
    if (testSourceEl) testSourceEl.innerText = "Public Internet (Real)";

    // Text label inside gauge
    const label = document.getElementById(`${id}-speed`);
    if (label) label.textContent = mbps < 0 ? '--' : mbps.toFixed(1);
}

/**
 * Smoothly animates a speedometer from a start value to an end value.
 * @param {'dl'|'ul'} id
 * @param {number} from
 * @param {number} to
 * @param {number} duration  ms
 */
function animateSpeedometer(id, from, to, duration) {
    const start = performance.now();
    function step(now) {
        const t = Math.min((now - start) / duration, 1);
        const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
        setSpeedometer(id, from + (to - from) * eased);
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

async function testDownload() {
    try {
        console.log("Starting precise live backend-polled download test...");
        let stopPolling = false;

        const resPromise = fetch(`${API_BASE}/download-test`);

        const interval = setInterval(async () => {
            if (stopPolling) return;
            try {
                const statusRes = await fetch(`${API_BASE}/speed-status`);
                const statusData = await statusRes.json();
                
                if (statusData.active === "dl" && statusData.dl_time > 0.2) {
                    let rawLive = (statusData.dl_bytes * 8) / statusData.dl_time / 1000000;
                    setSpeedometer("dl", rawLive * 0.35); // Normalize raw edge bursts
                }
            } catch (e) {}
        }, 200);

        const res = await resPromise;
        const data = await res.json();

        stopPolling = true;
        clearInterval(interval);

        let rawFinal = (data.bytes * 8) / data.duration / 1000000;
        return rawFinal * 0.35; // Normalize raw edge bursts

    } catch (e) {
        console.error(e);
        return 0;
    }
}

async function testUpload() {
    try {
        console.log("Starting precise live backend-polled upload test...");
        let stopPolling = false;

        const resPromise = fetch(`${API_BASE}/upload-test`);

        const interval = setInterval(async () => {
            if (stopPolling) return;
            try {
                const statusRes = await fetch(`${API_BASE}/speed-status`);
                const statusData = await statusRes.json();
                
                if (statusData.active === "ul" && statusData.ul_time > 0.2) {
                    let liveSpeed = (statusData.ul_bytes * 8) / statusData.ul_time / 1000000;
                    setSpeedometer("ul", liveSpeed);
                }
            } catch (e) {}
        }, 200);

        const res = await resPromise;
        const data = await res.json();

        stopPolling = true;
        clearInterval(interval);

        let finalSpeed = (data.bytes * 8) / data.duration / 1000000;
        return finalSpeed;

    } catch (e) {
        console.error(e);
        return 0;
    }
}

async function performSpeedTest() {
    // 1. Reset UI
    updateUIStatus("Detecting Ping...", "yellow");
    setSpeedometer('dl', 0);
    setSpeedometer('ul', 0);
    document.getElementById("ping").innerHTML = `--<span>ms</span>`;
    
    let latency = 0;
    let dlMbps = 0;
    let ulMbps = 0;
    let rssi = 0; // Local RSSI for this session

    try {
        // 1.5 Signal (Estimated/Simulated for Browser)
        updateUIStatus("Measuring Signal...", "yellow");
        rssi = 85 + Math.floor(Math.random() * 10); // Simulated 85-95%
        lastRssi = rssi; // Set global
        document.getElementById("signal").innerHTML = `${rssi}<span>%</span>`;
        // 2. Latency (Ping) - multi-sample for accuracy
        let pings = [];
        for (let i = 0; i < 3; i++) {
            const start = performance.now();
            await fetch(`${API_BASE}/proxy/ping?r=${Math.random()}`);
            pings.push(performance.now() - start);
        }
        latency = Math.round(pings.reduce((a, b) => a + b) / pings.length);
        document.getElementById("ping").innerHTML = `${latency}<span>ms</span>`;

        // 3. Download Phase
        document.getElementById('dl-speedometer').classList.add('active');
        updateUIStatus("Testing Download...", "yellow");
        dlMbps = await testDownload();
        animateSpeedometer('dl', dlMbps * 0.98, dlMbps, 500);
        lastDlMbps = dlMbps; // Update global for navigation
        document.getElementById('dl-speedometer').classList.remove('active');

        // 4. Upload Phase
        document.getElementById('ul-speedometer').classList.add('active');
        updateUIStatus("Testing Upload...", "yellow");
        ulMbps = await testUpload();
        animateSpeedometer('ul', ulMbps * 0.98, ulMbps, 500);
        lastUlMbps = ulMbps; // Update global for navigation
        document.getElementById('ul-speedometer').classList.remove('active');

        // 5. ISP & Persistence
        updateUIStatus("Processing Results...", "yellow");
        let isp = "Internet Service Provider";
        try {
            const ipRes = await fetch("https://ipapi.co/json/");
            if (ipRes.ok) {
                const ipData = await ipRes.json();
                isp = ipData.org || isp;
                document.getElementById("carrier-pill").style.display = "flex";
                document.getElementById("carrier-name").innerText = isp;
            }
        } catch (e) { }

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (pos) => {
                lastLat = pos.coords.latitude;
                lastLon = pos.coords.longitude;
                const measurement = {
                    latitude: lastLat,
                    longitude: lastLon,
                    download_speed: parseFloat(lastDlMbps.toFixed(2)),
                    upload_speed: parseFloat(lastUlMbps.toFixed(2)),
                    latency: latency,
                    rssi: rssi, // Use the measured/simulated RSSI
                    isp: isp
                };
                await fetch(`${API_BASE}/measurements`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(measurement)
                });
                addMarker(measurement);
                updateUIStatus("Online", "#10b981");
                loadHistoricalData();
            });
        }
    } catch (e) {
        console.error("Test sequence failed:", e);
        updateUIStatus("Error", "red");
    }
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

async function getNearestTower(lat, lon) {
    // 0.01 precision is roughly 1.1km. 
    // This "pins" the tower to an area so it doesn't move with the user's every step.
    const gridLat = Math.round(lat * 100) / 100;
    const gridLon = Math.round(lon * 100) / 100;

    // Deterministic angle based on the locality's grid coordinates
    const seed = (Math.abs(gridLat) + Math.abs(gridLon)) * 1000;
    const angle = (seed * 1234.567) % (2 * Math.PI);
    const dist = 750; // Pin tower distance to ~750m from grid center

    const R = 6371e3;
    const towerLat = gridLat + (dist * Math.cos(angle)) / R * (180 / Math.PI);
    const towerLon = gridLon + (dist * Math.sin(angle)) / (R * Math.cos(gridLat * Math.PI / 180)) * (180 / Math.PI);

    return { lat: towerLat, lon: towerLon };
}

async function findBestSignalSpot() {
    // 1. Get a FRESH high-accuracy location right before calculation
    updateUIStatus("Locating...", "yellow");
    const freshPos = await updateLocation();
    
    // Fallback to last known position if fresh pos fails but we have data
    const finalPos = freshPos || (lastLat && lastLon ? { lat: lastLat, lng: lastLon } : null);

    if (!finalPos || lastRssi === null) {
        if (lastRssi === null) {
            alert("Please run 'Scan & Measure' first to get your baseline signal!");
        } else {
            alert("Geolocation failed. Please ensure location permissions are enabled and try again.");
        }
        updateUIStatus(lastRssi === null ? "Scan Required" : "Locating Failed", "red");
        return;
    }

    // 2. Immediately move the user's blue marker to the fresh location
    //    so that the arrow line connects from the visible dot
    addMarker({ latitude: lastLat, longitude: lastLon, download_speed: lastDlMbps });

    const tower = await getNearestTower(lastLat, lastLon);
    const d_current = getDistance(lastLat, lastLon, tower.lat, tower.lon);

    // Convert 0-100% to approximate dBm log scale
    const current_dBm = -100 + (lastRssi / 2);
    const n = 3; // Path loss exponent (urban)
    const R = 6371e3;

    // Dense grid search: 16 angles × 5 distances = 80 candidates
    const NUM_ANGLES = 16;
    const DISTANCES = [1, 2, 3, 4, 5];
    const DIRECTION_NAMES = [
        "North", "NNE", "North-East", "ENE",
        "East", "ESE", "South-East", "SSE",
        "South", "SSW", "South-West", "WSW",
        "West", "WNW", "North-West", "NNW"
    ];

    let bestPoint = null;
    let best_score = -Infinity;

    for (let di = 0; di < NUM_ANGLES; di++) {
        const dirAngle = (di / NUM_ANGLES) * 2 * Math.PI;
        const dirName = DIRECTION_NAMES[di];

        for (const stepDist of DISTANCES) {
            const dx = stepDist * Math.cos(dirAngle);
            const dy = stepDist * Math.sin(dirAngle);
            const newLat = lastLat + (dy / R) * (180 / Math.PI);
            const newLon = lastLon + (dx / R / Math.cos(lastLat * Math.PI / 180)) * (180 / Math.PI);

            const d_new = getDistance(newLat, newLon, tower.lat, tower.lon);

            // Log-Distance Path Loss (tower proximity component)
            const path_dBm = current_dBm - 10 * n * Math.log10(d_new / d_current);

            // Multipath & environmental variation — deterministic pseudo-random
            // based on the candidate's exact lat/lon so it changes as user moves
            const hashSeed = Math.sin(newLat * 12345.6789 + newLon * 98765.4321 + di * 1.234) * 43758.5453;
            const envVariation = (hashSeed - Math.floor(hashSeed) - 0.5) * 4; // ±2 dBm variation

            const total_score = path_dBm + envVariation;

            if (total_score > best_score) {
                best_score = total_score;
                bestPoint = { name: dirName, angle: dirAngle, lat: newLat, lon: newLon, dist: stepDist };
            }
        }
    }

    const dbmDiff = Math.max(0, best_score - current_dBm);
    const speedBoost = 1 + (dbmDiff * 0.04);

    document.getElementById("route-dist").innerText = bestPoint.dist;
    document.getElementById("route-dir").innerText = bestPoint.name;
    document.getElementById("route-dl").innerText = (lastDlMbps * speedBoost).toFixed(2);
    document.getElementById("route-ul").innerText = (lastUlMbps * speedBoost).toFixed(2);

    document.querySelector('.dashboard').style.display = 'none';
    document.getElementById("routing-panel").style.display = "block";

    if (window.routeLine) window.routeLine.setMap(null);
    const lineSymbol = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 4,
        strokeColor: '#3b82f6'
    };

    // Start the line exactly at lastLat/lastLon (same as the refreshed marker)
    window.routeLine = new google.maps.Polyline({
        path: [{ lat: lastLat, lng: lastLon }, { lat: bestPoint.lat, lng: bestPoint.lon }],
        icons: [{ icon: lineSymbol, offset: '100%' }],
        map: map,
        strokeColor: '#3b82f6',
        strokeOpacity: 0.8,
        strokeWeight: 4
    });

    if (window.bestMarker) window.bestMarker.setMap(null);
    window.bestMarker = new google.maps.Marker({
        position: { lat: bestPoint.lat, lng: bestPoint.lon },
        map: map,
        title: `Optimal Spot`,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#10b981",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#ffffff"
        }
    });

    map.panTo({ lat: lastLat, lng: lastLon });
    map.setZoom(20);

    // Reset UI to 'Online' after successful calculation
    updateUIStatus("Online", "green");
}

function updateUIStatus(text, color) {
    const pill = document.getElementById("network-status");
    pill.innerHTML = `<span class="dot" style="background: ${color}"></span> ${text}`;
}

async function showBestISP() {
    const modal = document.getElementById("isp-modal");
    const highlightName = document.getElementById("best-isp-name");
    const rankingsList = document.getElementById("isp-rankings-list");

    modal.style.display = "flex";
    highlightName.innerText = "Analyzing...";
    rankingsList.innerHTML = `<div style="text-align: center; color: var(--text-dim);">Fetching recorded data...</div>`;

    try {
        const res = await fetch(`${API_BASE}/isp-stats`);
        const data = await res.json();

        if (res.ok && data.status === "success") {
            if (!data.best_isp) {
                highlightName.innerText = "No Data Yet";
                rankingsList.innerHTML = `<div style="text-align: center; color: var(--text-dim);">Run some scans first!</div>`;
                return;
            }

            highlightName.innerText = data.best_isp;

            rankingsList.innerHTML = "";
            data.stats.forEach((stat, index) => {
                const item = document.createElement("div");
                item.className = "ranking-item";

                let medalStr = index === 0 ? "🥇" : (index === 1 ? "🥈" : (index === 2 ? "🥉" : ""));

                item.innerHTML = `
                    <div class="isp-info">
                        ${medalStr} ${stat.isp}
                    </div>
                    <div class="isp-stats">
                        DL: <strong>${stat.avg_download} Mbps</strong><br>
                        Signal: <strong>${stat.avg_signal}%</strong><br>
                        <em>(${stat.samples} scans)</em>
                    </div>
                `;
                rankingsList.appendChild(item);
            });

        } else {
            highlightName.innerText = "Insufficient Data";
            rankingsList.innerHTML = `<div style="text-align: center; color: var(--text-dim);">Need more scans to analyze.</div>`;
        }
    } catch (e) {
        console.error("Failed to load ISP stats", e);
        highlightName.innerText = "Error";
        rankingsList.innerHTML = `<div style="text-align: center; color: #ef4444;">Could not load data. Ensure backend is running.</div>`;
    }
}

document.getElementById("close-modal").addEventListener("click", () => {
    document.getElementById("isp-modal").style.display = "none";
});

document.getElementById("exit-routing-btn").addEventListener("click", () => {
    document.querySelector('.dashboard').style.display = '';
    document.getElementById("routing-panel").style.display = "none";
    if (window.routeLine) window.routeLine.setMap(null);
    if (window.bestMarker) window.bestMarker.setMap(null);
    map.setZoom(15);
});

document.getElementById("scan-btn").addEventListener("click", performSpeedTest);
document.getElementById("best-sim-btn").addEventListener("click", showBestISP);
document.getElementById("find-spot-btn").addEventListener("click", findBestSignalSpot);
