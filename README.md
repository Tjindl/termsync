# Termsync

A small UBC Exchange service-planning demo for routes **99, R4, and 49**.

Run it locally from this folder:

```sh
python3 -m http.server 5173
```

Then open [http://localhost:5173](http://localhost:5173). Pick a route, inspect the busiest historical time blocks, click a scheduled departure, and compare nearby lower-load trip reassignment candidates. The app is static and needs no build step.

- [How the app works and what its numbers mean](app/README.md)
- [Curated data and source links](data/README.md)
- [Full technical specification](TECH_SPEC.md)

The displayed crowding is a **2025 route-level historical average**, while the scheduled departure times come from a **2026 GTFS sample date**. The app cannot tell whether a particular bus is full or free to redirect. A candidate is a planning scenario that also removes a trip from its donor route.
