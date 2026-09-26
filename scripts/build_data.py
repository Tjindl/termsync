#!/usr/bin/env python3
"""Build the small UBC service-planner data package from local source files.

Requires only Python 3.9+ and the source files named in data/README.md.
"""

import argparse
import csv
import datetime as dt
import io
import statistics
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo


ROUTES = {"99", "R4", "49"}
GTFS_ROUTE_NAMES = {"099": "99", "R4": "R4", "049": "49"}
GTFS_URL = "https://gtfs-static.translink.ca/gtfs/google_transit.zip"
ANNUAL_URL = "https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_yearline.csv"
BLOCKS = {4: ("04:00", "06:00", 2), 6: ("06:00", "09:00", 3),
          9: ("09:00", "15:00", 6), 15: ("15:00", "18:00", 3),
          18: ("18:00", "21:00", 3), 21: ("21:00", "24:00", 3),
          24: ("24:00", "04:00", 4)}
CALENDAR_URL_2025 = "https://vancouver.calendar.ubc.ca/academic-year-202526/all-months"
CALENDAR_URL_2026 = "https://vancouver.calendar.ubc.ca/dates-and-deadlines"


def rows(path):
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def write_csv(path, fieldnames, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)
    return len(records)


def build_activity(source, output):
    source_rows = rows(source)
    assert source_rows, "Synthetic activity input is empty"
    by_slot = defaultdict(list)
    by_date = Counter()
    for row in source_rows:
        key = (row["vancouver_weekday"], int(row["vancouver_half_hour_slot"]))
        by_slot[key].append(int(row["synthetic_activity_records"]))
        by_date[row["vancouver_date"]] += 1
    first_date = min(by_date)
    last_date = max(by_date)
    activity_rows = []
    weekly = defaultdict(lambda: {"records": 0, "baseline": 0.0, "bins": 0, "dates": set()})
    for row in source_rows:
        count = int(row["synthetic_activity_records"])
        date = dt.date.fromisoformat(row["vancouver_date"])
        slot = int(row["vancouver_half_hour_slot"])
        peers = by_slot[(row["vancouver_weekday"], slot)]
        # Remove exactly this observation, preserving equal-valued observations.
        peer_values = peers.copy()
        peer_values.remove(count)
        baseline = statistics.median(peer_values)
        quality = ["hourly_alignment_unverified"]
        if by_date[row["vancouver_date"]] != 48:
            quality.append("partial_local_date" if row["vancouver_date"] in (first_date, last_date) else "dst_transition")
        activity_rows.append({
            "bin_start_utc": row["bin_start_utc"],
            "bin_start_vancouver": row["bin_start_vancouver"],
            "local_date": row["vancouver_date"],
            "local_weekday": row["vancouver_weekday"],
            "local_slot": slot,
            "record_count": count,
            "same_weekday_slot_baseline": round(baseline, 2),
            "activity_ratio": round(count / baseline, 4) if baseline else "",
            "quality_flag": "|".join(quality),
        })
        week_start = date - dt.timedelta(days=date.weekday())
        group = weekly[week_start]
        group["records"] += count
        group["baseline"] += baseline
        group["bins"] += 1
        group["dates"].add(date)
    activity_rows.sort(key=lambda r: r["bin_start_utc"])
    quarterly = defaultdict(list)
    for row in activity_rows:
        date = dt.date.fromisoformat(row["bin_start_utc"][:10])
        quarterly[f"{date.year}Q{(date.month - 1) // 3 + 1}"].append(row)
    n = 0
    for quarter, quarter_rows in sorted(quarterly.items()):
        n += write_csv(output / f"ubc_activity_30m_{quarter}.csv", list(activity_rows[0]), quarter_rows)
    weekly_rows = []
    for start, group in sorted(weekly.items()):
        end = start + dt.timedelta(days=6)
        expected_dates = {start + dt.timedelta(days=i) for i in range(7)}
        complete = group["dates"] == expected_dates and all(
            by_date[day.isoformat()] in (46, 48, 50) for day in expected_dates
        )
        weekly_rows.append({
            "week_start_local": start.isoformat(),
            "week_end_local": end.isoformat(),
            "record_count": group["records"],
            "expected_baseline_records": round(group["baseline"], 2),
            "activity_ratio": round(group["records"] / group["baseline"], 4),
            "observed_bins": group["bins"],
            "quality_flag": "hourly_alignment_unverified" if complete else "partial_week|hourly_alignment_unverified",
        })
    write_csv(output / "ubc_activity_weekly.csv", list(weekly_rows[0]), weekly_rows)
    return n, len(weekly_rows)


def build_tspr(peak_source, service_source, annual_source, output):
    services = {}
    for row in rows(service_source):
        if row["Lineno_renamed"] not in ROUTES or row["SeasonYear"] != "2025":
            continue
        key = (row["SeasonYear"], row["Lineno_renamed"], row["DayType"],
               row["Season"], row["Hour_Range"])
        if key in services:
            raise ValueError(f"Duplicate seasonal service key: {key}")
        services[key] = row
    result = []
    for row in rows(peak_source):
        if row["Lineno_renamed"] not in ROUTES or row["SeasonYear"] != "2025":
            continue
        key = (row["SeasonYear"], row["Lineno_renamed"], row["DayType"],
               row["Season"], row["HourRange"])
        service = services.get(key)
        if service is None:
            raise ValueError(f"Missing matching service intensity for {key}")
        block = BLOCKS[int(row["HourRange"])]
        direction = row["direction_updated"]
        result.append({
            "year": 2025,
            "route": row["Lineno_renamed"],
            "season": row["Season"].lower(),
            "day_type": row["DayType"],
            "time_block_code": row["HourRange"],
            "time_block_start_local": block[0],
            "time_block_end_local": block[1],
            "time_block_hours": block[2],
            "direction": direction.lower(),
            "ubc_relation": "toward_ubc" if direction == "WEST" else "away_from_ubc",
            "average_peak_passenger_load": "" if row["Average_Peak_Passenger_Load"] == "NULL" else row["Average_Peak_Passenger_Load"],
            "average_peak_load_factor_percent": "" if row["Average_Peak_Load_Factor"] == "NULL" else row["Average_Peak_Load_Factor"],
            "average_trips_per_clock_hour_per_direction": service["Average_Trips_Per_Clock_Hour_Per_Direction"],
            "source_peak_url": row["source_url"],
            "source_service_url": service["source_url"],
        })
    result.sort(key=lambda r: (r["route"], r["season"], r["day_type"], int(r["time_block_code"]), r["direction"]))
    write_csv(output / "translink_route_load_history_2025.csv", list(result[0]), result)
    annual_rows = []
    for row in rows(annual_source):
        if row["Lineno_renamed"] not in ROUTES or row["CalendarYear"] != "2025":
            continue
        annual_rows.append({
            "year": 2025,
            "route": row["Lineno_renamed"],
            "annual_boardings_whole_route": row["AnnualBoardings"],
            "average_daily_boardings_weekday_whole_route": row["AVG_Daily_Boardings_MF"],
            "average_peak_load_factor_percent": row["Average_Peak_Load_Factor"],
            "percent_trips_with_overcrowding": row["Perc_Trips_w_Overcrowding"],
            "on_time_performance_percent": row["On_Time_Performance_Percentage"],
            "source_url": ANNUAL_URL,
        })
    annual_rows.sort(key=lambda r: r["route"])
    write_csv(output / "translink_route_annual_2025.csv", list(annual_rows[0]), annual_rows)
    return len(result), len(annual_rows)


def build_ubc(route_source, peak_source, summary_source, output):
    route_rows = [r for r in rows(route_source) if r["route"] in ROUTES and r["year"] == "2025"]
    route_rows.sort(key=lambda r: r["route"])
    write_csv(output / "ubc_route_trips_2025.csv", list(route_rows[0]), route_rows)
    peak_rows = rows(peak_source)
    write_csv(output / "ubc_peak_hours_2025.csv", list(peak_rows[0]), peak_rows)
    summary_rows = rows(summary_source)
    write_csv(output / "ubc_campus_summary_2023_2025.csv", list(summary_rows[0]), summary_rows)
    context = []
    for row in route_rows:
        context.append({"year": row["year"], "metric": "campus_screenline_transit_trips", "route_or_all_routes": row["route"],
                        "direction": "both", "time_period": "fall_weekday_all_day", "value": row["average_weekday_transit_trips_to_from_ubc"],
                        "unit": "trips_per_weekday", "source_url": row["source_url"], "source_note": row["source_note"]})
    for row in peak_rows:
        context.append({"year": row["year"], "metric": "campus_screenline_transit_trips", "route_or_all_routes": "all_transit_routes",
                        "direction": row["direction"], "time_period": "fall_weekday_" + row["local_period"],
                        "value": row["average_weekday_transit_trips"], "unit": "trips_per_weekday", "source_url": row["source_url"],
                        "source_note": row["source_note"]})
    summary_metrics = [
        ("total_avg_weekday_person_trips", "all_person_trips_to_from_campus", "trips_per_weekday"),
        ("avg_weekday_transit_trips", "all_transit_trips_to_from_campus", "trips_per_weekday"),
        ("transit_mode_share_percent", "transit_mode_share", "percent"),
        ("avg_daytime_population_fte", "daytime_population", "fte"),
    ]
    for row in summary_rows:
        for input_name, metric, unit in summary_metrics:
            context.append({"year": row["year"], "metric": metric, "route_or_all_routes": "all_routes",
                            "direction": "both", "time_period": "fall_weekday_daytime" if metric == "daytime_population" else "fall_weekday_all_day",
                            "value": row[input_name], "unit": unit, "source_url": row["source_url"], "source_note": "UBC 2025 Transportation Status Report"})
    context.sort(key=lambda r: (r["year"], r["metric"], r["route_or_all_routes"], r["direction"], r["time_period"]))
    write_csv(output / "ubc_travel_context.csv", list(context[0]), context)
    return len(route_rows), len(peak_rows), len(summary_rows), len(context)


def zip_rows(zipped, path):
    return csv.DictReader(io.TextIOWrapper(zipped.open(path), encoding="utf-8-sig", newline=""))


def active_services(zipped, date):
    date_key = date.strftime("%Y%m%d")
    day = date.strftime("%A").lower()
    active = {r["service_id"] for r in zip_rows(zipped, "calendar.txt")
              if r["start_date"] <= date_key <= r["end_date"] and r[day] == "1"}
    for row in zip_rows(zipped, "calendar_dates.txt"):
        if row["date"] == date_key:
            if row["exception_type"] == "1":
                active.add(row["service_id"])
            elif row["exception_type"] == "2":
                active.discard(row["service_id"])
    return active


def dated_time(service_date, gtfs_time):
    hour, minute, second = map(int, gtfs_time.split(":"))
    local = (dt.datetime.combine(service_date, dt.time()) +
             dt.timedelta(hours=hour, minutes=minute, seconds=second))
    aware = local.replace(tzinfo=ZoneInfo("America/Vancouver"))
    return aware.isoformat(), aware.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def build_schedule(source, output):
    dates = [dt.date(2026, 9, 28), dt.date(2026, 10, 3), dt.date(2026, 10, 4)]
    with zipfile.ZipFile(source) as zipped:
        feed = next(zip_rows(zipped, "feed_info.txt"))
        route_ids = {r["route_id"]: GTFS_ROUTE_NAMES[r["route_short_name"]]
                     for r in zip_rows(zipped, "routes.txt") if r["route_short_name"] in GTFS_ROUTE_NAMES}
        stops = {r["stop_id"]: r for r in zip_rows(zipped, "stops.txt")
                 if r["stop_name"].startswith("UBC Exchange @")}
        service_dates = defaultdict(list)
        for date in dates:
            for service in active_services(zipped, date):
                service_dates[service].append(date)
        trip_dates = defaultdict(list)
        for trip in zip_rows(zipped, "trips.txt"):
            if trip["route_id"] not in route_ids:
                continue
            for date in service_dates.get(trip["service_id"], []):
                trip_dates[trip["trip_id"]].append((date, route_ids[trip["route_id"]], trip))
        result = []
        for stop_time in zip_rows(zipped, "stop_times.txt"):
            trip_id = stop_time["trip_id"]
            stop_id = stop_time["stop_id"]
            if trip_id not in trip_dates or stop_id not in stops:
                continue
            stop = stops[stop_id]
            inbound = "Unloading Only" in stop["stop_name"]
            for date, route, trip in trip_dates[trip_id]:
                arr_local, arr_utc = dated_time(date, stop_time["arrival_time"])
                dep_local, dep_utc = dated_time(date, stop_time["departure_time"])
                result.append({
                    "schedule_version": feed["feed_version"],
                    "effective_start": feed["feed_start_date"],
                    "effective_end": feed["feed_end_date"],
                    "service_date": date.isoformat(),
                    "service_day_type": "weekday" if date.weekday() < 5 else ("saturday" if date.weekday() == 5 else "sunday"),
                    "route": route,
                    "direction": "toward_ubc" if inbound else "away_from_ubc",
                    "event_type": "arrival" if inbound else "departure",
                    "stop_id": stop_id,
                    "stop_code": stop["stop_code"],
                    "stop_name": stop["stop_name"],
                    "scheduled_arrival_local": arr_local,
                    "scheduled_departure_local": dep_local,
                    "scheduled_arrival_utc": arr_utc,
                    "scheduled_departure_utc": dep_utc,
                    "trip_id": trip_id,
                    "headsign": trip["trip_headsign"],
                    "pickup_type": stop_time.get("pickup_type", ""),
                    "drop_off_type": stop_time.get("drop_off_type", ""),
                    "source_url": GTFS_URL,
                })
    result.sort(key=lambda r: (r["service_date"], r["route"], r["direction"], r["scheduled_departure_local"]))
    assert len(result) == len({(r["service_date"], r["trip_id"], r["stop_id"]) for r in result})
    counts = Counter((r["service_date"], r["route"], r["direction"]) for r in result)
    assert len(counts) == 18, f"Missing route/direction/date combination: {counts}"
    write_csv(output / "translink_ubc_exchange_schedule_fall_2026.csv", list(result[0]), result)
    return len(result), counts, feed["feed_version"]


def build_calendar(output):
    entries = [
        ("2025-09-02", "2025-12-05", "winter_term_1_classes", CALENDAR_URL_2025),
        ("2025-11-10", "2025-11-12", "winter_term_1_midterm_break", CALENDAR_URL_2025),
        ("2025-12-09", "2025-12-20", "winter_term_1_exams", CALENDAR_URL_2025),
        ("2026-01-05", "2026-04-10", "winter_term_2_classes", CALENDAR_URL_2025),
        ("2026-02-16", "2026-02-20", "winter_term_2_midterm_break", CALENDAR_URL_2025),
        ("2026-04-14", "2026-04-25", "winter_term_2_exams", CALENDAR_URL_2025),
        ("2026-05-11", "2026-06-18", "summer_term_1_classes", CALENDAR_URL_2025),
        ("2026-06-22", "2026-06-26", "summer_term_1_exams", CALENDAR_URL_2025),
        ("2026-07-06", "2026-08-13", "summer_term_2_classes", CALENDAR_URL_2025),
        ("2026-08-17", "2026-08-21", "summer_term_2_exams", CALENDAR_URL_2025),
        ("2026-09-08", "2026-12-07", "winter_term_1_classes", CALENDAR_URL_2026),
        ("2026-11-09", "2026-11-11", "winter_term_1_midterm_break", CALENDAR_URL_2026),
        ("2026-12-11", "2026-12-22", "winter_term_1_exams", CALENDAR_URL_2026),
    ]
    return write_csv(output / "ubc_academic_dates.csv", ["start_date", "end_date", "label", "source_url"],
                     [dict(zip(["start_date", "end_date", "label", "source_url"], r)) for r in entries])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ["activity-bins", "peak-loads", "seasonal-service", "annual", "ubc-routes", "ubc-peaks", "ubc-summary", "gtfs", "out"]:
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    output = args.out
    output.mkdir(parents=True, exist_ok=True)
    print("activity", build_activity(args.activity_bins, output))
    print("tspr", build_tspr(args.peak_loads, args.seasonal_service, args.annual, output))
    print("ubc", build_ubc(args.ubc_routes, args.ubc_peaks, args.ubc_summary, output))
    schedule_count, counts, version = build_schedule(args.gtfs, output)
    print("schedule", schedule_count, "version", version, "by group", dict(sorted(counts.items())))
    print("calendar", build_calendar(output))


if __name__ == "__main__":
    main()
