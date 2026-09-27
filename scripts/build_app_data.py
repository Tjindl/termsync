#!/usr/bin/env python3
"""Build the small browser snapshot from TransLink GTFS and the 2025 TSPR CSV."""

import argparse
import csv
import datetime as dt
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path


SERVICE_DATE = dt.date(2026, 9, 28)  # Representative fall Monday in the bundled feed.
TARGETS = ("99", "R4", "49", "9", "44", "84")
BLOCKS = ((4, 240, 360, "04–06"), (6, 360, 540, "06–09"),
          (9, 540, 900, "09–15"), (15, 900, 1080, "15–18"),
          (18, 1080, 1260, "18–21"), (21, 1260, 1440, "21–24"),
          (24, 1440, 1680, "00–04"))
GTFS_URL = "https://gtfs-static.translink.ca/gtfs/google_transit.zip"
TSPR_URL = "https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv"


def read_zip_csv(archive, name):
    return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig", newline=""))


def active_services(archive, date):
    key = date.strftime("%Y%m%d")
    weekday = date.strftime("%A").lower()
    services = {r["service_id"] for r in read_zip_csv(archive, "calendar.txt")
                if r["start_date"] <= key <= r["end_date"] and r[weekday] == "1"}
    for row in read_zip_csv(archive, "calendar_dates.txt"):
        if row["date"] == key:
            if row["exception_type"] == "1":
                services.add(row["service_id"])
            elif row["exception_type"] == "2":
                services.discard(row["service_id"])
    return services


def route_number(short_name):
    return short_name.lstrip("0") or "0" if short_name.isdigit() else short_name


def minutes(time_string):
    hour, minute, second = map(int, time_string.split(":"))
    if second != 0:
        raise ValueError(f"Unexpected seconds in GTFS schedule: {time_string}")
    return hour * 60 + minute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", required=True, type=Path)
    parser.add_argument("--tspr-peak-loads", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    load = defaultdict(dict)
    with args.tspr_peak_loads.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if (row["SeasonYear"], row["Season"], row["DayType"], row["direction_updated"]) != ("2025", "Fall", "MF", "EAST"):
                continue
            if row["Average_Peak_Load_Factor"] == "NULL":
                continue
            route = row["Lineno_renamed"]
            code = row["HourRange"]
            if code in load[route]:
                raise ValueError(f"Duplicate route/block in TSPR: {route}/{code}")
            load[route][code] = {
                "peakOnboard": round(float(row["Average_Peak_Passenger_Load"]), 1),
                "loadPercent": round(float(row["Average_Peak_Load_Factor"]), 1),
            }

    with zipfile.ZipFile(args.gtfs) as archive:
        feed = next(read_zip_csv(archive, "feed_info.txt"))
        services = active_services(archive, SERVICE_DATE)
        gtfs_routes = {r["route_id"]: {"id": route_number(r["route_short_name"]), "name": r["route_long_name"]}
                       for r in read_zip_csv(archive, "routes.txt")}
        trips = {r["trip_id"]: r for r in read_zip_csv(archive, "trips.txt")
                 if r["service_id"] in services and r["route_id"] in gtfs_routes}
        bays = {r["stop_id"]: r for r in read_zip_csv(archive, "stops.txt")
                if r["stop_name"].startswith("UBC Exchange @ Bay")}
        departures = defaultdict(list)
        for row in read_zip_csv(archive, "stop_times.txt"):
            trip = trips.get(row["trip_id"])
            bay = bays.get(row["stop_id"])
            if not trip or not bay or row.get("pickup_type") == "1":
                continue
            route = gtfs_routes[trip["route_id"]]["id"]
            if route not in load:
                continue
            departures[route].append({
                "minute": minutes(row["departure_time"]),
                "tripId": row["trip_id"],
                "blockId": trip["block_id"],
                "bay": bay["stop_name"].replace("UBC Exchange @ ", ""),
                "stopId": bay["stop_id"],
                "lat": round(float(bay["stop_lat"]), 6),
                "lon": round(float(bay["stop_lon"]), 6),
            })
    route_data = {}
    for route, trips in departures.items():
        trips.sort(key=lambda x: (x["minute"], x["tripId"]))
        if not trips:
            continue
        route_id = next(k for k, v in gtfs_routes.items() if v["id"] == route)
        route_data[route] = {"name": gtfs_routes[route_id]["name"], "blocks": load[route], "departures": trips}
    assert all(route in route_data for route in TARGETS)
    result = {
        "serviceDate": SERVICE_DATE.isoformat(),
        "feedVersion": feed["feed_version"],
        "historicalPeriod": "Fall 2025 · weekdays",
        "targetRoutes": TARGETS,
        "timeBlocks": [{"code": code, "start": start, "end": end, "label": label} for code, start, end, label in BLOCKS],
        "routes": route_data,
        "sources": {"gtfs": GTFS_URL, "tspr": TSPR_URL},
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Saved {len(route_data)} routes and {sum(len(v['departures']) for v in route_data.values())} UBC Exchange departures to {args.out}")


if __name__ == "__main__":
    main()
