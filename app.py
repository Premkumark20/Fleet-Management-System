from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import itertools

app = Flask(__name__, static_folder='static')
CORS(app)

def parse_input(data):
    locations = [loc.strip() for loc in data.get('locations', [])]
    vehicles = []
    for v in data.get('vehicles', []):
        if '@' in v:
            name, loc = v.split('@')
            vehicles.append({'name': name.strip(), 'location': loc.strip(), 'assigned': False})
    deliveries = [d.strip() for d in data.get('deliveries', [])]
    return locations, vehicles, deliveries

# For demo: generate a fully connected graph with unit distances
# In real use, you would accept an adjacency matrix or distance table

def build_graph(locations):
    graph = {}
    for a in locations:
        graph[a] = {b: 1 if a != b else 0 for b in locations}
    return graph

def dijkstra(graph, start):
    import heapq
    distances = {node: float('inf') for node in graph}
    distances[start] = 0
    queue = [(0, start)]
    while queue:
        dist, node = heapq.heappop(queue)
        for neighbor, weight in graph[node].items():
            if weight + dist < distances[neighbor]:
                distances[neighbor] = weight + dist
                heapq.heappush(queue, (distances[neighbor], neighbor))
    return distances

def tsp_greedy(graph, start, stops):
    # Simple greedy TSP: always go to nearest unvisited
    route = [start]
    unvisited = set(stops)
    current = start
    total_dist = 0
    while unvisited:
        next_stop = min(unvisited, key=lambda x: graph[current][x])
        total_dist += graph[current][next_stop]
        route.append(next_stop)
        current = next_stop
        unvisited.remove(next_stop)
    return route, total_dist

def assign_vehicles(vehicles, deliveries, graph):
    assignments = []
    unassigned_deliveries = set(deliveries)
    for vehicle in vehicles:
        if not unassigned_deliveries:
            break
        # Assign the closest delivery to this vehicle
        dists = {d: graph[vehicle['location']][d] for d in unassigned_deliveries}
        if dists:
            closest = min(dists, key=dists.get)
            assignments.append({'vehicle': vehicle['name'], 'start': vehicle['location'], 'deliveries': [closest]})
            unassigned_deliveries.remove(closest)
            vehicle['assigned'] = True
    # If deliveries remain, assign them to the first vehicle (demo purpose)
    if unassigned_deliveries and vehicles:
        assignments[0]['deliveries'].extend(list(unassigned_deliveries))
    return assignments

@app.route('/')
def root():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def static_proxy(path):
    # Serve static files (main.js, styles.css, etc.)
    return send_from_directory(app.static_folder, path)

@app.route("/optimize_routes", methods=["POST"])
def optimize_routes():
    data = request.json
    locations, vehicles, deliveries = parse_input(data)
    if not locations or not vehicles or not deliveries:
        return jsonify({'status': 'error', 'message': 'Invalid input'}), 400
    graph = build_graph(locations)
    assignments = assign_vehicles(vehicles, deliveries, graph)
    results = []
    for assign in assignments:
        route, total_dist = tsp_greedy(graph, assign['start'], assign['deliveries'])
        results.append({
            'vehicle': assign['vehicle'],
            'route': route,
            'total_distance': total_dist
        })
    return jsonify({'status': 'success', 'assignments': results})

if __name__ == "__main__":
    app.run(debug=True)
