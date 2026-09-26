# Minimal bus planner app

From the repository root, run `python3 -m http.server 5173` and open `http://localhost:5173/`. This is a static HTML/CSS/JavaScript app; it has no framework or build step.

The page has three target routes (99, R4, 49):

1. Click a route to rank its fall weekday time blocks by 2025 **average peak passengers on board** from TransLink's TSPR. The percentage/status uses the corresponding historical average peak load factor. It describes the busiest point along the route, not UBC Exchange.
2. Click a time block, hour, and scheduled departure from the 2026-09-28 TransLink GTFS feed. The app shows the gap until the next scheduled bus. This is a **2025 versus 2026 scenario**, not a matched observation.
3. The app searches the other routes in its UBC Exchange snapshot for a scheduled departure **inside that gap**, from a bay no more than **250 m straight-line** from the target bay, with a 2025 load factor below **60%** in the same time block. The 60% threshold is our exploration rule, not an official TransLink underloading designation. Clicking a candidate compares the target gap after adding it with the donor gap after removing it.

The candidate is a proposed **trip reassignment**, not a real-time bus location, an empty bus, or a verified spare vehicle. Moving it would remove a donor-route trip. Any real change requires current per-trip passenger loads, vehicle compatibility, driver/block assignment, recovery time, and operational approval. The late-night route 49 example illustrates the interface; the busiest 15:00–18:00 block has no lower-load donor under this rule.

`app/data.json` is a compact, dated snapshot of 10 routes and 1,047 UBC Exchange departures. Rebuild it with `scripts/build_app_data.py --gtfs google_transit.zip --tspr-peak-loads tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv --out app/data.json` after downloading the [official GTFS feed](https://gtfs-static.translink.ca/gtfs/google_transit.zip) and [official 2025 TSPR CSV](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv). The script needs only Python's standard library.

The supplied synthetic activity is kept in the separate [`data/` package](../data/README.md) and is not used to estimate bus loads or specific bus arrival times. For the hackathon, run the source analysis and build the curated tables in Databricks before presenting the app's decisions.
