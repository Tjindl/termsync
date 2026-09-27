#!/usr/bin/env python3
"""Build app/route_map.json: map geometry for the planner, from the TransLink GTFS feed.

For every departure in app/data.json (all routes leaving UBC Exchange on the sample date) it
records the trip's shape, its scheduled run time and where it ends, plus what the same bus does
next in its GTFS vehicle block (when and where its next trip starts, and its next departure from
UBC). The page uses this to show how far a nearby bus would be rerouted if it covered another
route's gap, and whether it could still get back to its own schedule. It also lists the buses that
finish their day at UBC Exchange (spare for one more trip before heading to the depot). For context it
adds one shape per other bus route (drawn faintly), the SkyTrain lines and stations. Standard library only.

  python3 scripts/build_route_map.py --gtfs google_transit.zip --data app/data.json --out app/route_map.json
"""

import argparse
import json
import math
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from build_app_data import SERVICE_DATE, active_services, read_zip_csv

K = math.cos(math.radians(49.25))  # longitude scale at Vancouver's latitude


def simplify(points, tolerance):
    """Douglas–Peucker on lon/lat, longitude scaled so the tolerance is the same in both axes."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay, bx, by = points[a][0] * K, points[a][1], points[b][0] * K, points[b][1]
        norm = math.hypot(bx - ax, by - ay) or 1e-12
        best, index = 0.0, None
        for i in range(a + 1, b):
            px, py = points[i][0] * K, points[i][1]
            distance = abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / norm
            if distance > best:
                best, index = distance, i
        if index is not None and best > tolerance:
            keep[index] = True
            stack += [(a, index), (index, b)]
    return [p for p, kept in zip(points, keep) if kept]


def clip(points, box):
    """Split a polyline into the runs of points inside box = (min_lon, min_lat, max_lon, max_lat)."""
    runs, current = [], []
    for p in points:
        if box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3]:
            current.append(p)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return [run for run in runs if len(run) > 1]


def length_km(points):
    total = 0.0
    for (lon1, lat1), (lon2, lat2) in zip(points, points[1:]):
        p1, p2 = math.radians(lat1), math.radians(lat2)
        x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
        total += 2 * 6371 * math.asin(math.sqrt(x))
    return total


def clock_minutes(value):
    """GTFS time (may pass 24:00 and carry seconds) as minutes after midnight."""
    hour, minute, second = map(int, value.split(":"))
    return hour * 60 + minute + second / 60


def rounded(points, digits):
    return [[round(x, digits), round(y, digits)] for x, y in points]


def stop_label(name):
    """'Brentwood Station @ Bay 4' -> 'Brentwood Station'; hyphenated station names get an en dash."""
    place = name.split(" @ ")[0].strip()
    for heading in ("Northbound ", "Southbound ", "Eastbound ", "Westbound "):
        place = place.removeprefix(heading)
    return place.replace("-", "–") if "Station" in place else place


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", required=True, type=Path)
    parser.add_argument("--data", default=Path("app/data.json"), type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    planner = json.loads(args.data.read_text(encoding="utf-8"))
    targets = planner["targetRoutes"]
    departure_trips = {trip["tripId"]: route for route, info in planner["routes"].items() for trip in info["departures"]}

    with zipfile.ZipFile(args.gtfs) as archive:
        feed = next(read_zip_csv(archive, "feed_info.txt"))
        services = active_services(archive, SERVICE_DATE)
        routes = {r["route_id"]: r for r in read_zip_csv(archive, "routes.txt")}
        trips = {r["trip_id"]: r for r in read_zip_csv(archive, "trips.txt") if r["service_id"] in services}
        stops = {r["stop_id"]: r for r in read_zip_csv(archive, "stops.txt")}
        ubc_stops = {sid for sid, s in stops.items() if s["stop_name"].startswith("UBC Exchange")}

        # For every trip running that day: where and when it starts and ends, and when the planner's
        # departures leave UBC Exchange.
        leave, first, last = {}, {}, {}
        for row in read_zip_csv(archive, "stop_times.txt"):
            tid = row["trip_id"]
            if tid not in trips:
                continue
            seq = int(row["stop_sequence"])
            if tid in departure_trips and row["stop_id"] in ubc_stops and (tid not in leave or seq < leave[tid][0]):
                leave[tid] = (seq, clock_minutes(row["departure_time"]))
            if tid not in first or seq < first[tid][0]:
                first[tid] = (seq, clock_minutes(row["departure_time"]), row["stop_id"])
            if tid not in last or seq > last[tid][0]:
                last[tid] = (seq, clock_minutes(row["arrival_time"]), row["stop_id"])

        # Context: the most common shape of every other bus route, and the top SkyTrain shapes.
        by_route = defaultdict(Counter)
        for t in trips.values():
            by_route[t["route_id"]][t["shape_id"]] += 1
        bus_shapes = [c.most_common(1)[0][0] for rid, c in by_route.items() if routes[rid]["route_type"] == "3"]
        rail_shapes = [(routes[rid]["route_long_name"], sid) for rid, c in by_route.items() if routes[rid]["route_type"] == "1"
                       for sid, _ in c.most_common(3)]

        trip_shapes = {tid: trips[tid]["shape_id"] for tid in departure_trips if tid in trips}
        wanted = set(trip_shapes.values()) | set(bus_shapes) | {sid for _, sid in rail_shapes}
        points = defaultdict(list)
        for row in read_zip_csv(archive, "shapes.txt"):
            if row["shape_id"] in wanted:
                points[row["shape_id"]].append((int(row["shape_pt_sequence"]), float(row["shape_pt_lon"]), float(row["shape_pt_lat"])))
        shape = {sid: [[lon, lat] for _, lon, lat in sorted(pts)] for sid, pts in points.items()}

    platforms = defaultdict(list)
    for s in stops.values():
        if " Station @ Platform" in s["stop_name"]:
            platforms[s["stop_name"].split(" Station")[0].replace("-", "–")].append((float(s["stop_lon"]), float(s["stop_lat"])))
    stations = {name: (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) for name, pts in platforms.items()}

    def place(stop_id):
        stop = stops[stop_id]
        x, y = float(stop["stop_lon"]), float(stop["stop_lat"])
        near = min(stations, key=lambda n: length_km([[x, y], list(stations[n])]))
        name = f"{near} Station" if length_km([[x, y], list(stations[near])]) < 0.45 else stop_label(stop["stop_name"])
        return {"name": name, "lon": round(x, 5), "lat": round(y, 5)}

    # One entry per distinct departure shape: geometry, length and where it ends.
    shape_ids = sorted(set(trip_shapes.values()))
    index = {sid: i for i, sid in enumerate(shape_ids)}
    end_stop = {}
    for tid, sid in trip_shapes.items():
        if tid in last:
            end_stop.setdefault(sid, Counter())[last[tid][2]] += 1
    shapes_out = []
    for sid in shape_ids:
        route = departure_trips[next(t for t, s in trip_shapes.items() if s == sid)]
        end_id = end_stop[sid].most_common(1)[0][0]
        end = place(end_id)
        headsign = Counter(trips[tid]["trip_headsign"] for tid, trip_shape in trip_shapes.items() if trip_shape == sid).most_common(1)[0][0]
        if "Dundarave" in headsign:
            end["name"] = "Dundarave"
        elif route == "N17":
            end["name"] = stop_label(stops[end_id]["stop_name"])
        shapes_out.append({"route": route, "lengthKm": round(length_km(shape[sid]), 1), "end": end,
                           "coords": rounded(simplify(shape[sid], 0.00003), 5)})
    by_block = defaultdict(list)
    for tid, t in trips.items():
        if tid in first and t["block_id"]:
            by_block[t["block_id"]].append((first[tid][1], tid))
    for runs in by_block.values():
        runs.sort()

    # Buses whose day ends at UBC Exchange, on a planner route: [route, arrival minute, bay, lon, lat].
    spare = []
    for runs in by_block.values():
        tid = runs[-1][1]
        route = routes[trips[tid]["route_id"]]["route_short_name"].lstrip("0")
        stop = stops[last[tid][2]]
        if last[tid][2] in ubc_stops and route in planner["routes"]:
            spare.append([route, round(last[tid][1]), stop["stop_name"].split(" @ ")[-1],
                          round(float(stop["stop_lon"]), 6), round(float(stop["stop_lat"]), 6)])
    spare.sort(key=lambda bus: (bus[1], bus[0]))
    block_stops, stop_index = [], {}

    def stop_ref(stop_id):
        if stop_id not in stop_index:
            stop_index[stop_id] = len(block_stops)
            block_stops.append(place(stop_id))
        return stop_index[stop_id]

    trips_out = {}
    for tid, sid in trip_shapes.items():
        if tid not in leave or tid not in last:
            continue
        record = [index[sid], round(last[tid][1] - leave[tid][1])]
        runs = by_block.get(trips[tid]["block_id"])
        if runs:  # the bus's next trip, and its next departure from UBC Exchange (None: its day ends)
            later = [t for start, t in runs if start > leave[tid][1]]
            following = later[0] if later else None
            next_ubc = next((t for t in later if first[t][2] in ubc_stops), None)
            record += [round(first[following][1]) if following else None,
                       stop_ref(first[following][2]) if following else None,
                       round(first[next_ubc][1]) if next_ubc else None]
        trips_out[tid] = record

    # Each route's usual departure pattern: its most common shape among the planner's departures.
    main_shape = {}
    for route in planner["routes"]:
        counts = Counter(index[trip_shapes[t["tripId"]]] for t in planner["routes"][route]["departures"] if t["tripId"] in trip_shapes)
        main_shape[route] = counts.most_common(1)[0][0]

    uses = Counter(record[0] for record in trips_out.values())
    everything = [p for i, s in enumerate(shapes_out) if uses[i] >= 5 for p in s["coords"]]  # rare variants may run off the map
    view = [min(p[0] for p in everything) - 0.01, min(p[1] for p in everything) - 0.01,
            max(p[0] for p in everything) + 0.01, max(p[1] for p in everything) + 0.01]
    box = [view[0] - 0.02, view[1] - 0.015, view[2] + 0.02, view[3] + 0.015]

    bays = [(float(s["stop_lon"]), float(s["stop_lat"])) for s in stops.values() if s["stop_name"].startswith("UBC Exchange @ Bay")]

    result = {
        "serviceDate": SERVICE_DATE.isoformat(),
        "feedVersion": feed["feed_version"],
        "targetRoutes": targets,
        "bbox": [round(v, 4) for v in view],
        "ubc": [round(sum(b[0] for b in bays) / len(bays), 5), round(sum(b[1] for b in bays) / len(bays), 5)],
        "shapes": shapes_out,
        "mainShape": main_shape,
        "trips": trips_out,
        "blockStops": block_stops,
        "spareBuses": spare,
        "stations": [{"name": n, "lon": round(x, 5), "lat": round(y, 5)} for n, (x, y) in sorted(stations.items())
                     if box[0] <= x <= box[2] and box[1] <= y <= box[3]],
        "skytrain": [{"name": name, "coords": rounded(simplify(run, 0.00006), 5)}
                     for name, sid in rail_shapes for run in clip(shape[sid], box)],
        "network": [rounded(simplify(run, 0.0002), 4) for sid in bus_shapes for run in clip(shape[sid], box)],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    usual = ", ".join(f"{r}: {shapes_out[main_shape[r]]['lengthKm']} km to {shapes_out[main_shape[r]]['end']['name']}" for r in planner["routes"])
    with_block = sum(1 for r in trips_out.values() if len(r) == 5)
    print(f"{len(trips_out)}/{len(departure_trips)} departures mapped onto {len(shapes_out)} shapes; "
          f"{with_block} with their bus's next trip; {len(spare)} buses end their day at UBC "
          f"({args.out.stat().st_size // 1024} KB)\n{usual}")


if __name__ == "__main__":
    main()
