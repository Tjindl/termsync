# Minimal bus planner app

From the repository root, run `python3 -m http.server 5173` and open `http://localhost:5173/`. This is a static HTML/CSS/JavaScript app; it has no framework or build step.

The page optimises three crowded routes from UBC Exchange: **99, R4 and 49**. The data covers all 12 routes on its sample timetable; the other nine (9, 44, 84, 4, 14, 25, 33, 68, N17) are checked as buses that could fill the three routes' gaps:

1. Click a route to rank its fall weekday time blocks by 2025 **average peak passengers on board** from TransLink's TSPR. The percentage/status uses the corresponding historical average peak load factor. It describes the busiest point along the route, not UBC Exchange.
2. Click a time block, hour, and scheduled departure from the 2026-09-28 TransLink GTFS feed. The app shows the gap until the next scheduled bus. This is a **2025 versus 2026 scenario**, not a matched observation.
3. For city routes, the app checks every bus that could fill a gap of **at most 60 minutes** and ranks the practical ones (`app/switching.js`, below). Longer intervals are treated as scheduled service breaks. The campus shuttle (68) and NightBus (N17) are shown for context only and are never swapped with city routes. Each option shows what it does for the target route's riders, what it costs the other route's riders, and what operations has to do.

The options are **schedule scenarios**, not real-time bus locations. Any real change still needs current per-trip loads, a willing driver, and dispatch approval.

**Step 03, the switch finder.** Two kinds of bus can fill a gap:
- **Finishing bus.** A bus from another route whose day ends at UBC Exchange (from the GTFS vehicle blocks) runs one more trip on the target route, then goes to the depot. Nobody loses a trip; the cost is extra driver and bus time. Dispatchers try this first.
- **Borrowed trip.** A bus about to leave UBC on another route runs the target trip instead. Its own riders wait for the next bus on their route.

A bus is ruled out, with the reason shown, if any check fails:
1. **Timing.** It must leave at least 3 min from either scheduled bus, or it only bunches with them. A finishing bus leaves mid-gap after 5 min recovery and waits at most 20 min.
2. **Bay.** A borrowed bus's bay must be within 250 m of the target bay.
3. **Vehicle.** Electric trolley buses (4, 9, 14) need overhead wire and can't pass other trolleys, so they only cover other trolley routes. The 68 and N17 are never borrowed.
4. **Its riders.** After a borrowed trip is cancelled, the next bus on its route must end up less full than the target bus it relieves. Over 84% ("crowded") or over capacity is flagged.
5. **Its schedule.** An empty run from where the covered trip ends gets it to its next trip. The run is 1.3 × the straight-line distance, at 25 km/h in peaks and 32 km/h otherwise (no stops), plus 5 min recovery. Failing that, it returns to UBC for its next departure there, skipping one more trip.
6. **Net benefit.** Riders overall must save more waiting time than they lose.

The score is in rider-minutes of waiting:
- Riders per minute come from the 2025 TSPR average peak load ÷ the scheduled headway.
- Splitting a gap G into a + b saves λ·a·b. Merging the borrowed trip's two headways costs its riders the same, in reverse.
- A bus carries its route's capacity (TSPR peak load ÷ load factor, median over the day). Riders beyond that are left behind for one more headway.

Verdicts:
- **Recommended:** passes every check, has at least 3 min to spare before its next trip, raises no flags, and (for a borrowed trip) keeps at least half of what the target riders gain.
- **Workable, with care:** passes every check but misses one of those conditions.

Up to three options are shown: the best bus from each other route. A route's own buses are never offered for its own gaps.

Two exploration screens don't change the verdict but are shown as checks under each option:
- **Route knowledge:** more than a third of the covered trip lies over 80 m from the bus's usual path.
- **Crowding:** the target route's block average is under the 84% crowding line.

Every rule is a named constant in `Switching.RULES`. Not modelled: driver shifts and route knowledge, depot locations, and today's real loads.

What it finds on the 2026-09-28 schedule:
- Practical switches are common midday and evenings, almost all from finishing buses.
- 15:00–18:00 is thin. Every route is busy, so borrowing a trip only moves the crowding, and no bus finishes its day at UBC before 17:11. The R4 has no practical switch in that block.

Run the tests with `node --test tests/` (Node 18+, no dependencies).

Route 68 is a [UBC campus shuttle](https://planning.ubc.ca/transportation/transit). Its timetable, map, and historical load are visible, but the app excludes it as either a target or donor in city-route swaps. N17 has timetable and map data only: the app has no comparable 2025 peak-load series for this NightBus and makes no crowding or bus-swap claim for it. Its after-midnight GTFS departures appear in the `00–04 +1` time block, meaning the calendar day after the sample service date.

`app/data.json` is a compact, dated snapshot of 12 routes and 1,116 UBC Exchange departures. Rebuild it with `scripts/build_app_data.py --gtfs google_transit.zip --tspr-peak-loads tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv --out app/data.json` after downloading the [official GTFS feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip) and [official 2025 TSPR CSV](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv). The script needs only Python's standard library.

The supplied synthetic activity is kept in the separate [`data/` package](../data/README.md) and is not used to estimate bus loads or specific bus arrival times. For the hackathon, run the source analysis and build the curated tables in Databricks before presenting the app's decisions.

**Step 04, the route map.** The 99, R4 and 49 keep one colour everywhere (route buttons, map lines, chips). The nearby bus is always orange. When step 03 finds a bus, the map shows:
- its usual route, dashed
- the route it would run instead, with the bus riding it
- dotted, how it gets back to its own schedule: an empty run to its next trip, or back to UBC

The cards below the map spell out the reroute:
- **Bay change:** which UBC Exchange bays it moves between, and how far apart they are.
- **Off its usual path:** kilometres of the covered trip that are more than 80 m from the bus's usual path, checked every 50 m.
- **Trip time:** the covered trip's scheduled run time, next to the bus's own.
- **Finish and then:** where it finishes compared with its usual end, and what it does next (spare minutes before its next trip, a skipped trip, or extra driver time for a finishing bus).

Each candidate card also shows a one-line reroute preview.

Geometry, trip shapes, run times, each bus's next trip (vehicle blocks) and the buses that finish their day at UBC come from the GTFS feed for every departure in `data.json`, so the map needs no tiles and works offline. Rebuild it with `python3 scripts/build_route_map.py --gtfs google_transit.zip --data app/data.json --out app/route_map.json` (standard library only; it reuses the sample date and helpers in `scripts/build_app_data.py`). The page still works if `app/route_map.json` is missing; step 04 just stays hidden.
