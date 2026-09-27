# Termsync

A small UBC Exchange service-planning demo for three crowded routes: **99, R4 and 49**. The other routes departing the Exchange in its sample timetable (9, 44, 84, 4, 14, 25, 33, 68 and N17) are checked as buses that could fill their gaps.

Run it locally from this folder:

```sh
python3 -m http.server 5173
```

Then open [http://localhost:5173](http://localhost:5173). Pick a route, inspect the busiest historical time blocks, click a scheduled departure, and see which bus from another route could practically fill the gap, or where an added trip would help. The app is static and needs no build step.

- [How the app works and what its numbers mean](app/README.md)
- [Peak service fallback and route 33 example](PEAK_SERVICE_PLAN.md)
- [Curated data and source links](data/README.md)
- [Original hackathon technical specification](TECH_SPEC.md)

The displayed crowding is a **2025 route-level historical average**, while the scheduled departure times come from a **2026 GTFS sample date**. Route 68 is a campus shuttle and N17 has no comparable historical load series, so neither is used as a replacement. The app cannot tell whether a particular bus is full or free to redirect. A finishing bus adds driver time; a borrowed trip removes a trip from its own route; an added-trip scenario requires a new bus and operator.
