# Minimal bus planner app

From the repository root, run `python3 -m http.server 5173` and open `http://localhost:5173/`. This is a static HTML/CSS/JavaScript app; it has no framework or build step.

The page has 12 selectable routes from UBC Exchange on its sample timetable. Ten regular routes (99, R4, 49, 9, 44, 84, 4, 14, 25, 33) have the full comparison flow:

The demo opens on route 33's afternoon peak because it gives a clear 15-minute gap and a transparent added-trip example; the September 2026 service-increase caveat appears beside that example.

1. Click a route to rank its fall weekday time blocks by 2025 **average peak passengers on board** from TransLink's TSPR. The percentage/status uses the corresponding historical average peak load factor. It describes the busiest point along the route, not UBC Exchange.
2. Click a time block, hour, and scheduled departure from the 2026-09-28 TransLink GTFS feed. The app shows the gap until the next scheduled bus. This is a **2025 versus 2026 scenario**, not a matched observation.
3. The app searches the other routes in its UBC Exchange snapshot for a scheduled departure **inside a gap of at most 60 minutes**, from a bay no more than **250 m straight-line** from the target bay, with a 2025 load factor below **60%** in the same time block. Longer intervals are treated as scheduled service breaks. The 60% threshold is our exploration rule, not an official TransLink underloading designation. Clicking a candidate compares the target gap after adding it with the donor gap after removing it. A candidate passes the route-fit screen only when at most one third of the covered trip lies more than 80 m from the donor's usual path and its destination is within 5 km straight-line of the donor's usual end. A positive verdict also requires the target route's historical load factor to reach 84% in that block. These are exploration thresholds, not operational rules.
4. When a route's historical load factor is at least 84% and the selected same-block timetable gap is 6–60 minutes, the app also shows a **new-trip scenario** at the gap midpoint. It calculates the new scheduled intervals and departure count. This needs an additional vehicle and operator; it does not assume one is spare or predict how many people would use the new trip. See the [route 33 planning example](../PEAK_SERVICE_PLAN.md).

The candidate is a proposed **trip reassignment**, not a real-time bus location, an empty bus, or a verified spare vehicle. Moving it would remove a donor-route trip. Any real change requires current per-trip passenger loads, vehicle compatibility, driver/block assignment, recovery time, and operational approval. The late-night route 49 example illustrates why a nearby bay alone is insufficient: its route fit is poor. The busiest 15:00–18:00 block has no lower-load donor under this rule.

Route 68 is a [UBC campus shuttle](https://planning.ubc.ca/transportation/transit). Its timetable, map, and historical load are visible, but the app excludes it as either a target or donor in city-route swaps. N17 has timetable and map data only: the app has no comparable 2025 peak-load series for this NightBus and makes no crowding or bus-swap claim for it. Its after-midnight GTFS departures appear in the `00–04 +1` time block, meaning the calendar day after the sample service date.

`app/data.json` is a compact, dated snapshot of 12 routes and 1,116 UBC Exchange departures. Rebuild it with `scripts/build_app_data.py --gtfs google_transit.zip --tspr-peak-loads tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv --out app/data.json` after downloading the [official GTFS feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip) and [official 2025 TSPR CSV](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv). The script needs only Python's standard library.

The supplied synthetic activity is kept in the separate [`data/` package](../data/README.md) and is not used to estimate bus loads or specific bus arrival times. For the hackathon, run the source analysis and build the curated tables in Databricks before presenting the app's decisions.

**Step 04, the route map.** The 12 selectable routes keep one colour everywhere (route buttons, map lines, chips). The nearby bus is always orange. When step 03 finds a nearby bus, the map shows:
- its usual route, dashed
- the route it would run instead, with the bus riding it
- where it would finish compared with its usual end

The cards below the map spell out the reroute:
- **Bay change:** which UBC Exchange bays it moves between, and how far apart they are.
- **Off its usual path:** kilometres of the covered trip that are more than 80 m from the bus's usual path, checked every 50 m.
- **Trip time:** the covered trip's scheduled run time, next to the bus's own.
- **Finish:** the straight-line distance from where it normally ends.

Each candidate card also shows a one-line reroute preview.

Geometry, trip shapes and run times come from the GTFS feed for every departure in `data.json`, so the map needs no tiles and works offline. Rebuild it with `python3 scripts/build_route_map.py --gtfs google_transit.zip --data app/data.json --out app/route_map.json` (standard library only; it reuses the sample date and helpers in `scripts/build_app_data.py`). The page still works if `app/route_map.json` is missing; step 04 just stays hidden.
