# UBC Exchange queue-priority demo

From the repository root, run `python3 -m http.server 5173` and open `http://localhost:5173/`. This is a static HTML/CSS/JavaScript app with no build step.

The page has 12 selectable routes from UBC Exchange. Ten regular routes (99, R4, 49, 9, 44, 84, 4, 14, 25, 33) support the queue comparison. Route 68 is a [UBC campus shuttle](https://planning.ubc.ca/transportation/transit) and N17 has timetable and map context only. Neither is offered as a city-route donor. The two buttons in step 03 load **illustrative**, editable queue counts; they are not observations.

1. Pick a route. Step 01 ranks fall 2025 weekday time blocks by TransLink TSPR **average peak passengers on board**. This is measured at the busiest point along the entire route, not at UBC Exchange.
2. Pick a time block, hour, and departure on the 2026-09-28 TransLink GTFS timetable. Step 02 shows the gap to the next departure. The historical load and timetable are from different years and are not matched observations.
3. Step 03 searches other regular routes for a departure inside a gap of at most 60 minutes. A candidate's bay must be within 250 m straight-line of the target bay. Its previous GTFS vehicle-block trip must end within 500 m of the target bay at least five minutes beforehand. No more than a third of the covered trip can lie farther than 80 m from the donor's usual path, and the rerouted destination must be within 5 km of its usual destination. If the block has a next passenger trip, the covered trip must finish at least five minutes before it and within 500 m of its start. These are screening rules for the demo, not TransLink operating rules.
4. Enter how many people are **currently waiting** at the two bays. The displayed bay-only wait calculation is `target queue × (next target departure − rerouted departure) − donor queue × (next donor departure − removed donor departure)`. A positive result means less waiting for those entered queues; a negative result means more. Moving a donor bus changes its own maximum departure gap, which is shown alongside the target gap. Counts reset when you change the route or time.
5. Step 04 maps the donor's usual route and the route it would cover, with the bay change and destination difference. It shows the next published trip when one appears in the GTFS block. A blank next trip does not prove the bus or driver is free; depot movement and shifts are unknown.

The morning example redirects a scheduled **99 at 08:14** from Bay 7 to the **9 at Bay 9**; the bays are 233 m apart. The target maximum gap changes 15 → 8 minutes and the donor maximum gap 3 → 5 minutes. Example counts of 30 and 5 produce 230 bay-only passenger-minutes saved. The evening example redirects a **4 at 23:20** from Bay 11 to the **14 at Bay 10**, 57 m away. The target maximum gap changes 30 → 20 minutes and the donor maximum gap 29 → 47 minutes. Example counts of 30 and 2 produce 242 bay-only passenger-minutes saved; the same GTFS vehicle block has a next trip at 00:06. These are timetable scenarios with invented queue counts, not verified service recommendations.

The calculation omits passengers already on board and waiting at later stops, bus capacity, actual queue arrivals, traffic, trolley/vehicle compatibility, driver assignments, depot trips, and dispatch approval. It cannot establish whether an individual bus is underloaded or available. An operational pilot needs current per-trip passenger counts, pass-ups, vehicle and driver records, and observed UBC bay queues. The supplied synthetic cell activity is kept separately in [`data/`](../data/README.md); it does not estimate bay queues, bus loads, or bus arrival times.

`app/data.json` is a dated snapshot of 12 routes and 1,116 UBC Exchange departures. Rebuild it with `python3 scripts/build_app_data.py --gtfs google_transit.zip --tspr-peak-loads tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv --out app/data.json` after downloading the [official GTFS feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip) and [official 2025 TSPR CSV](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv). The map and vehicle-block files use the same GTFS feed and service date:

```sh
python3 scripts/build_route_map.py --gtfs google_transit.zip --data app/data.json --out app/route_map.json
python3 scripts/build_block_duties.py --gtfs google_transit.zip --data app/data.json --out app/block_duties.json
```

The scripts need only Python's standard library. The page still shows its route loads and timetables if the map or block snapshot is missing, but it cannot screen reroutes without both.
