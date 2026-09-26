#!/usr/bin/env python3
"""Stream the supplied UBC CSV in its ZIP into 30-minute synthetic record counts."""

import argparse
import csv
import datetime as dt
import io
import zipfile
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--member", default="synthetic_data_ubc.csv")
    args = parser.parse_args()

    counts = Counter()
    source_rows = 0
    with zipfile.ZipFile(args.zip) as archive:
        with archive.open(args.member) as source:
            reader = csv.DictReader(io.TextIOWrapper(source, encoding="utf-8-sig", newline=""))
            for row in reader:
                if row["location_name"] != "UBC":
                    raise ValueError(f"Unexpected location {row['location_name']!r}")
                timestamp = dt.datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                start = timestamp.replace(minute=(timestamp.minute // 30) * 30, second=0, microsecond=0)
                counts[start] += 1
                source_rows += 1

    first, last = min(counts), max(counts)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as target:
        writer = csv.writer(target)
        writer.writerow(["bin_start_utc", "bin_start_vancouver", "vancouver_date", "vancouver_weekday", "vancouver_half_hour_slot", "synthetic_activity_records"])
        current = first
        while current <= last:
            local = current.astimezone(ZoneInfo("America/Vancouver"))
            writer.writerow([current.isoformat().replace("+00:00", "Z"), local.isoformat(),
                             local.date().isoformat(), local.strftime("%A"),
                             local.hour * 2 + local.minute // 30, counts[current]])
            current += dt.timedelta(minutes=30)
    print(f"Aggregated {source_rows:,} synthetic records into {len(counts):,} nonempty UTC bins")


if __name__ == "__main__":
    main()
