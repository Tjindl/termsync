# UBC Exchange queue-priority demo

From the repository root, run `python3 -m http.server 5173` and open `http://localhost:5173/`. This is a static HTML/CSS/JavaScript app with no build step.

**Design.** Every colour, type size, space and radius is a token at the top of [`styles.css`](styles.css). The palette is warm paper and ink, one teal accent, red only for losses, and a dark departure board (amber figures) for the recommendation; other colour belongs to routes and load levels. Type is Newsreader for headlines and big figures, Hanken Grotesk for text, Big Shoulders Display for route numbers and IBM Plex Mono for times. Use the tokens rather than adding raw values.

The page has 12 selectable routes from UBC Exchange. Ten regular routes (99, R4, 49, 9, 44, 84, 4, 14, 25, 33) support the queue comparison. Route 68 is a [UBC campus shuttle](https://planning.ubc.ca/transportation/transit) and N17 has timetable and map context only. Neither is offered as a city-route donor. Queue counts in step 03 start from a **Monte Carlo student-demand simulation**; they are editable estimates, not observations.

1. Pick a route. For the 10 regular routes, step 1 is a **line chart by hour**. It plots simulated students leaving UBC Exchange on that route each hour (Mon–Fri average, or one weekday) from the team's Monte Carlo model. The dashed line is the capacity of the buses the 2026 timetable runs each hour: the buses scheduled, times the capacity per bus implied by TransLink's 2025 TSPR loads (average peak load ÷ load factor). Each dot is coloured by how full that hour is: red overloaded (100%+), orange crowded (84–99%), yellow moderate (60–83%), green lighter (under 60%). Clicking an hour jumps steps 02–03 to it; the shaded band is the TransLink time block it falls in. The demand is simulated and counts students only, not all riders. Routes 68 and N17 have no simulated demand, so they keep the time-block bar chart of fall 2025 TSPR **average peak passengers on board**.
2. Pick a time block, hour, and departure on the 2026-09-28 TransLink GTFS timetable. Step 2 shows the gap to the next departure. The historical load and timetable are from different years and are not matched observations.
3. Step 3, **Which bus could fill the gap?**, searches other regular routes for a departure inside a gap of 4–60 minutes. **Hard rules** decide whether the move is possible at all:
   - the bus leaves from a bay within 250 m straight-line of the target bay
   - its previous GTFS vehicle-block trip ends within 500 m of that bay at least five minutes earlier, or this is its first trip of the day
   - electric trolley buses (4, 9, 14) only cover other trolley routes
   - if its block has a next passenger trip, it can still reach it with five minutes' recovery; when the covered trip ends more than 500 m from that trip's start, this allows an empty run of 1.3 × the straight-line distance at 25 km/h

   **Soft rules** describe fit. Breaking one adds a caution and ranks the bus lower, instead of hiding it, so the busiest blocks still show the least-bad buses to redirect:
   - more than a third of the covered trip is over 80 m from the donor's usual path
   - it finishes more than 5 km from its usual end
   - it needs an empty run
   - it's the bus's first trip of the day
   - its own route averaged 84%+ peak load in that block

   Options are ranked by fewest cautions, then the largest simulated wait saving, then the most even target gap, and each route appears at most once. When the app picks a departure for you, it chooses the gap whose best option has the fewest cautions and then saves the most simulated time. All thresholds are in `SCREEN` in `app.js`. These are screening rules for the demo, not TransLink operating rules.
4. Picking a bus redraws the map in step 3: the donor's usual route and the route it would cover, with the bay change and destination difference. It shows the next published trip when one appears in the GTFS block. A blank next trip does not prove the bus or driver is free; depot movement and shifts are unknown.
5. Below the map, step 3 fills in how many people are **currently waiting** at the two bays. Each count is the route's simulated students leaving UBC per hour on the weekday chosen in step 01 (or the Mon–Fri average), spread evenly over the hour, from that route's previous departure to the rerouted departure. Type over either count to use your own. The displayed bay-only wait calculation is `target queue × (next target departure − rerouted departure) − donor queue × (next donor departure − removed donor departure)`. A positive result means less waiting for those queues; a negative result means more. Moving a donor bus changes its own maximum departure gap, which is shown alongside the target gap. Changing the route, time or departure returns to simulated counts.
6. Step 4, **How should we handle this gap?**, compares **three ways to handle the gap**, using the simulated line counts described in 5 for the chosen weekday. The score is bay-only passenger-minutes:
   - **redirect** the best screened bus
   - **add one trip** at the middle of the gap
   - **leave it**

   It recommends the first of these that holds:
   1. Redirect, if that saves waiting.
   2. Add a trip, if the hour runs at 84%+ of its scheduled capacity (the step 1 chart).
   3. Leave it.

   An added trip always helps riders at least as much as a redirect, but it needs a spare bus and driver.

**Shareable views.** The address bar always describes the current view, for example `?route=R4&day=thu&hour=18&trip=…&bus=…`, so a slide or a message can link straight to it. With no parameters, the page opens on the crunch: R4, Thursday, 18:00. Figures and chart exports for the deck are in [`presentation/`](../presentation/key-numbers.md).

The first scenario button redirects a scheduled **99 at 17:43** from Bay 7 to the **9 at Bay 9**; the bays are 233 m apart. The 9's maximum gap changes 28 → 14 minutes and the 99's 3 → 5 minutes. In the simulation, 79 students have reached the 9 line in the 14 minutes since its 17:29 bus, and 21 have reached the 99 line in the 2 minutes since its 17:41 bus: 79 × 14 − 21 × 3 = 1,043 passenger-minutes saved, the largest saving of the day. It carries one caution: the 99 itself averaged 100% peak load in that 2025 block. The second redirects a **4 at 19:38** from Bay 11 to the **14 at Bay 10**, 57 m away. It is a clean fit under every timetable rule, but the simulation rejects it. The 14's maximum gap changes 17 → 12 minutes while the 4's grows 24 → 44 minutes; with 22 students simulated at the 14 and 34 at the 4, it adds 570 passenger-minutes (22 × 5 − 34 × 20). Across the 1,457 options the app lists on the sample day (up to three per gap), 286 save simulated waiting time, 917 add to it and 244 change nothing. All 25 that save 300 or more fall between 13:40 and 19:43, with a 99, 25, R4, 49 or 14 bus covering the 9, 33, 44 or 84. Before noon no option saves more than 179, though the simulation undercounts morning departures. No 84 bus saves time, and every 4 → 14 option adds waiting. These are timetable scenarios with simulated demand, not verified service recommendations.

`app/queue_demand.json` holds the Departure rows of [`data/monte_carlo_bus_demand.csv`](../data/monte_carlo_bus_demand.csv): simulated students leaving UBC by route, weekday and hour from 06:00 to 23:59. Arrival rows are left out because those students get off at UBC and never queue. The simulation matches UBC's 2025 survey at the evening peak but not in the morning: its Monday 17:00–18:00 outbound total on these 10 routes (4,748 students) is 84% of the 5,655 transit trips UBC counted leaving campus on all routes, but at 09:00–10:00 it has 37 departures against 1,500 counted, so morning counts are far too low. It models students only. Hours before 06:00 and after midnight have no simulated demand, so counts that reach into them start empty. The simulation's companion capacity-utilization file is not used: it adds arrivals and departures together, and its hourly capacities do not match the buses scheduled in this timetable.

The calculation omits passengers already on board and waiting at later stops, bus capacity (it assumes the bus takes everyone counted), observed queue arrivals, traffic, trolley/vehicle compatibility, driver assignments, depot trips, and dispatch approval. It cannot establish whether an individual bus is underloaded or available. An operational pilot needs current per-trip passenger counts, pass-ups, vehicle and driver records, and observed UBC bay queues. The supplied synthetic cell activity is kept separately in [`data/`](../data/README.md); it does not estimate bay queues, bus loads, or bus arrival times.

`app/data.json` is a dated snapshot of 12 routes and 1,116 UBC Exchange departures. Rebuild it with `python3 scripts/build_app_data.py --gtfs google_transit.zip --tspr-peak-loads tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv --out app/data.json` after downloading the [official GTFS feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip) and [official 2025 TSPR CSV](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv). The map and vehicle-block files use the same GTFS feed and service date:

```sh
python3 scripts/build_route_map.py --gtfs google_transit.zip --data app/data.json --out app/route_map.json
python3 scripts/build_block_duties.py --gtfs google_transit.zip --data app/data.json --out app/block_duties.json
python3 scripts/build_queue_demand.py --demand data/monte_carlo_bus_demand.csv --out app/queue_demand.json
```

The scripts need only Python's standard library. The page still shows its route loads and timetables if the map or block snapshot is missing, but it cannot screen reroutes without both. Without `queue_demand.json`, queue counts start empty and must be typed in.
