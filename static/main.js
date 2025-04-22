let map, markers = [], polylines = [], chart;

function getMockCoordinates(locations) {
    // Arrange locations in a circle for visualization
    const center = [28.6, 77.2]; // Near Delhi
    const radius = 0.08;
    const angleStep = (2 * Math.PI) / locations.length;
    let coords = {};
    locations.forEach((loc, i) => {
        const angle = i * angleStep;
        coords[loc] = [center[0] + radius * Math.sin(angle), center[1] + radius * Math.cos(angle)];
    });
    return coords;
}

function resetMap() {
    if (!map) {
        map = L.map('map').setView([28.6, 77.2], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
    }
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    polylines.forEach(l => map.removeLayer(l));
    polylines = [];
}

function plotOnMap(assignments, coords) {
    assignments.forEach((assign, idx) => {
        let color = ['#e67e22', '#16a085', '#8e44ad', '#2980b9', '#c0392b'][idx % 5];
        // Markers for route
        assign.route.forEach((loc, i) => {
            const marker = L.marker(coords[loc], {
                icon: L.divIcon({
                    className: 'custom-marker',
                    html: `<div style='background:${color};color:#fff;padding:2px 7px;border-radius:8px;font-weight:bold;'>${loc}</div>`
                })
            }).addTo(map);
            markers.push(marker);
        });
        // Polyline for route
        let latlngs = assign.route.map(loc => coords[loc]);
        let polyline = L.polyline(latlngs, {color: color, weight: 5, opacity: 0.8, dashArray: '12,8'}).addTo(map);
        polylines.push(polyline);
    });
    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.2));
}

function renderStatsDashboard(assignments) {
    // Calculate stats
    let totalDist = assignments.reduce((sum, a) => sum + a.total_distance, 0);
    let avgDist = assignments.length ? (totalDist / assignments.length).toFixed(2) : 0;
    let trucksUsed = assignments.length;
    let estTime = (dist) => (dist * 2.2 + 8); // min/km + stop time
    let estFuel = (dist) => (dist * 0.18).toFixed(2); // liters/km
    let estCost = (dist) => (dist * 12).toFixed(2); // INR/km

    // Chart.js - distance per truck
    let ctx = document.getElementById('stats-chart').getContext('2d');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: assignments.map(a => a.vehicle),
            datasets: [{
                label: 'Distance (km)',
                data: assignments.map(a => a.total_distance),
                backgroundColor: ['#16a085','#2980b9','#e67e22','#8e44ad','#c0392b']
            }]
        },
        options: {plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}
    });
    // Stats summary
    let statsHTML = `<b>🚚 Trucks Used:</b> ${trucksUsed}<br>
        <b>📏 Total Distance:</b> ${totalDist} km<br>
        <b>⏱️ Avg. Delivery Time:</b> ${(estTime(avgDist)).toFixed(1)} min<br>
        <b>⛽ Total Fuel Est.:</b> ${(estFuel(totalDist))} L<br>
        <b>💸 Total Cost Est.:</b> ₹${(estCost(totalDist))}`;
    document.getElementById('stats-summary').innerHTML = statsHTML;
}

function animateTrucks(assignments, coords) {
    // Animate trucks moving along their route
    let truckMarkers = [];
    let step = 0, maxSteps = 60;
    let animId;
    // Remove old truck icons if any
    polylines.forEach(l => l.setStyle({opacity:0.3}));
    assignments.forEach((assign, idx) => {
        let color = ['#e67e22', '#16a085', '#8e44ad', '#2980b9', '#c0392b'][idx % 5];
        let marker = L.circleMarker(coords[assign.route[0]], {
            radius: 13, fillColor: color, color: '#fff', weight: 3, fillOpacity: 0.9
        }).addTo(map);
        marker.bindTooltip(`Truck ${assign.vehicle}`, {permanent:true, direction:'top', className:'truck-label'});
        truckMarkers.push({marker, assign, color});
    });
    function animate() {
        step++;
        truckMarkers.forEach(({marker, assign, color}) => {
            let route = assign.route;
            let pos = Math.min(step / maxSteps, 1) * (route.length-1);
            let idx = Math.floor(pos);
            let frac = pos - idx;
            let start = coords[route[idx]];
            let end = coords[route[Math.min(idx+1,route.length-1)]];
            let lat = start[0] + (end[0]-start[0])*frac;
            let lng = start[1] + (end[1]-start[1])*frac;
            marker.setLatLng([lat,lng]);
        });
        if (step < maxSteps) animId = requestAnimationFrame(animate);
        else {
            setTimeout(()=>{
                truckMarkers.forEach(({marker})=>map.removeLayer(marker));
                polylines.forEach(l => l.setStyle({opacity:0.8}));
            }, 1000);
        }
    }
    animate();
}

document.getElementById("fleet-form").addEventListener("submit", async function(e) {
    e.preventDefault();
    const locations = document.getElementById("locations").value.split(",");
    const vehicles = document.getElementById("vehicles").value.split(",");
    const deliveries = document.getElementById("deliveries").value.split(",");
    const response = await fetch("/optimize_routes", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            locations: locations.map(x => x.trim()),
            vehicles: vehicles.map(x => x.trim()),
            deliveries: deliveries.map(x => x.trim())
        })
    });
    const data = await response.json();
    window._lastFleetData = data;
    renderResult(data);
});

document.getElementById("simulate-btn").addEventListener("click", function() {
    if (window._lastFleetData && window._lastFleetData.assignments && window._lastFleetData.coords) {
        animateTrucks(window._lastFleetData.assignments, window._lastFleetData.coords);
    }
});

function renderResult(data) {
    const resultDiv = document.getElementById("result");
    resultDiv.innerHTML = "";
    if (data.status !== "success") {
        resultDiv.innerHTML = `<div style='color: #c0392b; font-weight: bold;'>Error: ${data.message || 'Unknown error.'}</div>`;
        return;
    }
    if (!data.assignments || data.assignments.length === 0) {
        resultDiv.innerHTML = `<div style='color: #c0392b;'>No assignments found.</div>`;
        return;
    }
    // Map visualization
    let locations = [];
    data.assignments.forEach(a => a.route.forEach(loc=>{if(!locations.includes(loc))locations.push(loc);}));
    let coords = getMockCoordinates(locations);
    data.coords = coords;
    resetMap();
    plotOnMap(data.assignments, coords);
    renderStatsDashboard(data.assignments);
    // Result cards
    data.assignments.forEach(assign => {
        const card = document.createElement('div');
        card.className = 'result-card';
        card.innerHTML = `
            <div class='result-title'>🚚 Vehicle: <span style='color:#1abc9c'>${assign.vehicle}</span></div>
            <div class='result-route'>
                <strong>Route:</strong> 
                ${assign.route.map((stop, idx) =>
                    `<span style='color:#2980b9;font-weight:bold;'>${stop}</span>${idx < assign.route.length-1 ? ' <span style=\"color:#888;\">→</span> ' : ''}`
                ).join('')}
            </div>
            <div class='result-distance'>Total Distance: ${assign.total_distance} km</div>
        `;
        resultDiv.appendChild(card);
    });
    // Animate fade-in again (reset)
    resultDiv.style.opacity = 0;
    setTimeout(() => { resultDiv.style.opacity = 1; }, 10);
}
