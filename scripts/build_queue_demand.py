#!/usr/bin/env python3
"""Build hourly simulated UBC Exchange departure demand for the app's queue estimates."""

import argparse
import csv
import json
from pathlib import Path

WEEKDAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demand", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    with args.demand.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    seen = set()
    for row in rows:
        key = (row["route"], row["weekday"], row["hour_of_day"], row["trip_type"])
        if key in seen:
            raise ValueError(f"Duplicate demand row {key}")
        seen.add(key)
        if row["weekday"] not in WEEKDAYS or row["trip_type"] not in ("Arrival", "Departure"):
            raise ValueError(f"Unexpected weekday or trip type in {key}")
    hours = [int(row["hour_of_day"]) for row in rows]
    first, last = min(hours), max(hours)

    # Only departures queue at the bays; arrivals get off the bus at UBC. A missing row inside the
    # simulated hours means no simulated students; hours outside them are unknown (null).
    routes = sorted({row["route"] for row in rows})
    result = {day: {route: [0 if first <= hour <= last else None for hour in range(24)] for route in routes}
              for day in WEEKDAYS}
    for row in rows:
        if row["trip_type"] == "Departure":
            result[row["weekday"]][row["route"]][int(row["hour_of_day"])] = int(row["student_count"])

    output = {"source": args.demand.name, "firstHour": first, "lastHour": last,
              "departuresPerHour": result}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")
    departures = sum(row["trip_type"] == "Departure" for row in rows)
    print(f"Saved {departures} simulated departure hours for {len(routes)} routes to {args.out}")


if __name__ == "__main__":
    main()
