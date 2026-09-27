# Termsync

A small UBC Exchange planning demo for the 12 routes in its sample timetable: **99, R4, 49, 9, 44, 84, 4, 14, 25, 33, 68, and N17**. It asks a concrete question: if one bay has a long line and another nearby bay has few people waiting, would redirecting a scheduled bus reduce waiting without disrupting that bus's next trip?

Run it locally from this folder:

```sh
python3 -m http.server 5173
```

Then open [http://localhost:5173](http://localhost:5173). The app is static and needs no build step. Try either marked example, or pick a route and time, choose a screened nearby trip, and enter the two bay line counts. The app shows the wait change at both bays, the departure gaps, the bay distance, the route overlap, and a GTFS vehicle-block timing check.

- [How the app works and what its numbers mean](app/README.md)
- [Curated data and source links](data/README.md)
- [Original hackathon technical specification](TECH_SPEC.md)
- [Earlier peak-service analysis](PEAK_SERVICE_PLAN.md)

The displayed crowding is a **fall 2025 route-level historical average**, while scheduled trips come from the **2026-09-28 GTFS sample day**. Neither source measures a live UBC bay queue. The two example line counts are illustrative and manually entered counts are unverified. Rerouting removes one trip from its original route; actual changes require passenger, capacity, vehicle, driver, bay, and recovery checks. Route 68 is a campus shuttle and N17 has no comparable historical load series, so neither is used for a city-route reassignment.
