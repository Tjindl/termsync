#!/usr/bin/env python3
"""Build a compact GTFS vehicle-block snapshot for UBC Exchange departures."""

import argparse
import json
import zipfile
from collections import defaultdict
from pathlib import Path

from build_app_data import SERVICE_DATE, active_services, read_zip_csv


def minute_value(value):
    hour, minute, second = map(int, value.strip().split(":"))
    return hour * 60 + minute + second / 60


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gtfs", required=True, type=Path)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    app_data = json.loads(args.data.read_text(encoding="utf-8"))
    if app_data["serviceDate"] != SERVICE_DATE.isoformat():
        raise ValueError("App data and block snapshot must use the same service date")
    target_ids = {trip["tripId"] for route in app_data["routes"].values()
                  for trip in route["departures"]}

    with zipfile.ZipFile(args.gtfs) as archive:
        feed = next(read_zip_csv(archive, "feed_info.txt"))
        if feed["feed_version"] != app_data["feedVersion"]:
            raise ValueError("App data and block snapshot must use the same GTFS version")
        services = active_services(archive, SERVICE_DATE)
        trips = {r["trip_id"]: r["block_id"] for r in read_zip_csv(archive, "trips.txt")
                 if r["service_id"] in services and r["block_id"]}
        stops = {r["stop_id"]: [round(float(r["stop_lat"]), 6),
                                 round(float(r["stop_lon"]), 6)]
                 for r in read_zip_csv(archive, "stops.txt")}
        spans = {trip_id: [float("inf"), float("-inf"), None, None]
                 for trip_id in trips}
        for row in read_zip_csv(archive, "stop_times.txt"):
            span = spans.get(row["trip_id"])
            if span is None:
                continue
            arrival, departure = minute_value(row["arrival_time"]), minute_value(row["departure_time"])
            if arrival < span[0]:
                span[0], span[2] = arrival, row["stop_id"]
            if departure > span[1]:
                span[1], span[3] = departure, row["stop_id"]

    blocks = defaultdict(list)
    for trip_id, block_id in trips.items():
        start, end, first_stop, last_stop = spans[trip_id]
        if start == float("inf"):
            continue
        blocks[block_id].append((start, end, trip_id, first_stop, last_stop))
    for block in blocks.values():
        block.sort()

    result = {}
    for block in blocks.values():
        for index, trip in enumerate(block):
            if trip[2] not in target_ids:
                continue
            previous = block[index - 1] if index else None
            following = block[index + 1] if index + 1 < len(block) else None
            result[trip[2]] = {
                "previous": [previous[1], *stops[previous[4]]] if previous else None,
                "next": [following[0], *stops[following[3]]] if following else None,
            }
    missing = target_ids - result.keys()
    if missing:
        raise ValueError(f"No block data for {len(missing)} app departures")
    output = {"serviceDate": app_data["serviceDate"], "feedVersion": feed["feed_version"],
              "trips": result}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Saved {len(result)} UBC departure block records to {args.out}")


if __name__ == "__main__":
    main()
