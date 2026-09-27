# Termsync

A small UBC Exchange service-planning demo for all 12 routes departing the Exchange in its sample timetable: **99, R4, 49, 9, 44, 84, 4, 14, 25, 33, 68, and N17**.

Run it locally from this folder:

```sh
python3 -m http.server 5173
```

Then open [http://localhost:5173](http://localhost:5173). Pick a route, inspect the busiest historical time blocks, click a scheduled departure, and compare nearby lower-load trip reassignment candidates. The app is static and needs no build step.

- [How the app works and what its numbers mean](app/README.md)
- [Curated data and source links](data/README.md)
- [Original hackathon technical specification](TECH_SPEC.md)

The displayed crowding is a **2025 route-level historical average**, while the scheduled departure times come from a **2026 GTFS sample date**. Routes 4, 14, 25, and 33 now use the full load, timetable, and map flow. Route 68 is a campus shuttle and is excluded from city-route swaps; N17 is a schedule-and-map view because the app has no comparable historical load series for it. The app cannot tell whether a particular bus is full or free to redirect. A candidate is a planning scenario that also removes a trip from its donor route.
