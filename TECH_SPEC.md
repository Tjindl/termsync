# UBC Service Planner — app specification

This is the original hackathon proposal for three routes. The current static demo has [12 selectable UBC Exchange routes](app/README.md) and does not implement every Databricks or academic-week feature proposed below.

## 1. Purpose

Build a Databricks-powered planning app for existing UBC bus routes **99, R4, and 49**. A planner selects a week, direction, and time, sees the published departures and historical crowding evidence, and tests adding or moving a departure. The app answers: **Which service change is worth investigating or piloting?**

This is a frequency and departure-timing planner. It does not redesign the street paths of the routes. It does not claim to know the number of riders on an individual bus or the length of a queue at UBC Exchange.

**Primary user:** TransLink service planner. **Secondary user:** UBC transportation planner. **Hackathon demo user:** a judge who can understand a recommendation and its evidence in under a minute.

## 2. Source roles and data rules

| Source | Grain | What the app may use it for | What it cannot establish |
| --- | --- | --- | --- |
| Supplied synthetic UBC file | Activity record with timestamp, origin, dwell, and one shared UBC coordinate; aggregate to 30-minute bins | Flag simulated UBC-area activity changes by week or time of day | People, unique devices, riders, route choice, bus-stop queues, or actual crowd density |
| [TransLink schedule / GTFS](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data) | Scheduled trip and stop time | Exact published departures, direction, and gaps between scheduled buses | Actual arrivals, on-board load, or delay |
| [TransLink 2025 TSPR](https://www.translink.ca/tspr) | Route × direction × season × day type × time block | Historical average peak passenger load, peak load factor, service intensity, and overcrowding | Which bus or UBC stop was crowded; an exact 30-minute load |
| [UBC 2025 Transportation Status Report](https://planning.ubc.ca/sites/default/files/2026-06/UBC2025-TransportationStatusReport-FINAL.pdf) | Campus screenline snapshots, route/day totals, selected all-route peak hours | Campus-scale demand context and a check on direction of peak travel | Repeated daily observations or route-by-hour boardings |
| [UBC academic calendar](https://vancouver.calendar.ubc.ca/dates-and-deadlines) | Term, exam, and break dates | Label teaching weeks, exams, and breaks | Attendance or transit use on a given day |

The synthetic file covers **November 2025 through August 2026**. The currently downloaded September 2026 schedule starts after that period. The app must never present them as simultaneous observations. When combining a 2025 load with a 2026 timetable, show **“cross-year scenario”** beside the result.

Every metric displayed in the app must carry a source type: **synthetic activity**, **observed transit**, **published schedule**, or **scenario**. Counts of synthetic records must never be labelled “people,” “passengers,” or “arrivals at a bus stop.”

### Required initial data tables

1. `ubc_activity_30m`: `bin_start_utc`, `local_date`, `local_slot`, `record_count`, `same_weekday_slot_baseline`, `activity_ratio`, `quality_flag`.
2. `scheduled_departures`: `schedule_version`, `effective_start`, `effective_end`, `service_date`, `route`, `direction`, `stop_id`, `stop_name`, `departure_local`, `trip_id`.
3. `route_load_history`: `year`, `season`, `day_type`, `time_block`, `route`, `direction`, `average_peak_passenger_load`, `peak_load_factor`, `trips_per_clock_hour_per_direction`, `source_url`. Keep annual route-level `overcrowded_trip_pct` in a companion table or record with its distinct grain; do not attach it to each time block as if measured there.
4. `ubc_travel_context`: `year`, `metric`, `route_or_all_routes`, `direction`, `time_period`, `value`, `unit`, `source_url`.
5. `academic_dates`: `start_date`, `end_date`, `label`, `source_url`.

Use Vancouver local time in the interface and preserve UTC plus the offset in storage. Keep effective schedule dates so the app can distinguish a matched historical comparison from a current-schedule scenario.

## 3. Core user flow

1. **Choose a week.** The app shows a calendar strip of synthetic UBC-area activity relative to a comparable weekday/time baseline. Teaching, exam, and break dates are marked. A conspicuous label says **“simulated area activity; not transit ridership.”**
2. **Choose a route and direction.** Cards for 99, R4, and 49 show historical TransLink peak load factor, overcrowded-trip percentage where available, UBC daily route trips, and scheduled departures. All values retain their year and time-block labels.
3. **Inspect the timetable.** A timeline shows actual published departure times for the selected route, direction, and stop. The planner can see the largest scheduled gaps and insert a proposed departure at a chosen time.
4. **Compare before and after.** The app shows the exact effect on schedule gaps, then a separate historical-crowding sensitivity range. It explains the assumption required to translate an added trip into lower average load.
5. **Export one recommendation card.** The card names the route, direction, time, proposed change, evidence, assumptions, and what passenger counts are still needed before implementation.

### Planning modes from the working document

| Mode | MVP behavior | Additional data needed for a real service plan |
| --- | --- | --- |
| **Peak-week overload trip** | Select an activity-flagged week, then test adding one 99/R4/49 departure in a historically crowded direction and time block. The output is a pilot candidate. | Current stop-level loads, vehicle and driver availability, and operational approval. |
| **Summer-to-term allocation** | Compare seasonal TSPR crowding and published summer/fall service side by side; draft an added or moved departure for the term schedule. Never claim unused summer buses or budget neutrality from activity ratios alone. | Matched historical timetables, vehicle run schedules, recovery/deadhead times, labour and depot constraints, and demand on any service being reduced. |
| **Class-start spreading** | Offer a clearly labelled *assumption slider* for shifting a specified number of campus arrivals out of a peak hour. Do not infer class attendance from cell records. | Course-section start times, enrolments, attendance patterns, and mode/route choices to produce a defensible estimate. |

The Sunday demo should implement the **peak-week overload trip** mode end to end. The other two modes can show the source comparisons and required inputs without fabricating their outputs.

## 4. Computations

### 4.1 Synthetic activity flag

Aggregate raw UBC records to 30-minute bins in Databricks. Compare each bin with the median of other weeks having the same local weekday and 30-minute slot; exclude the target bin from its own baseline. Also show a weekly aggregate, which is less sensitive to clock interpretation.

**Data-quality gate:** the previously computed local-hour profile peaks around 5 a.m., unlike UBC's measured travel peaks. Check the source timestamp convention before using hour-level activity to select a bus departure. Until resolved, only **week-level** synthetic flags may affect the planning workflow. Do not silently shift timestamps to make the profiles align.

The flag means “inspect this period,” never “add a bus.” Do not multiply synthetic record counts by a bus-ridership conversion factor without paired measured data and validation.

### 4.2 Historical crowding evidence

For the chosen route, direction, day type, season, and TransLink time block, display the reported average peak passenger load and load factor. Define the metric in the interface: it is the average highest on-board load during a trip **somewhere along the full route**. [TransLink's definition](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/tspr_2019_bus_seabus_handydart_definitions.pdf) calls 84% or more crowded and 100% or more overcrowded.

Use UBC route/day trips and its selected all-route peak-hour counts as context. Do not assign all-route peak-hour riders to individual routes by default. If a user enters a route share, show it as a **user assumption**, not a measured value.

### 4.3 Candidate generation

For the chosen day type and period, list route/direction combinations with a historical load factor of at least 84%. Within each matching published timetable, identify the largest departure gaps and propose a midpoint departure for review. Rank candidates first by measured historical load factor, then by the reduction in the selected schedule gap. Show both components; do not make a synthetic-record-to-rider score. A synthetic high-activity week highlights **when to review** these candidates, while TransLink evidence determines **which route and direction** appears crowded. A candidate based on a different year's timetable must say **“cross-year planning scenario.”**

### 4.4 Proposed departure

The selected departure time changes the timetable exactly: recompute the gap before and after the new departure, local maximum gap, and departures within the selected hour. This part uses schedule data and does not require passenger estimates.

Show a separate **capacity sensitivity**, using the historical TransLink time block. Let `N` be the historical *average* trips per clock hour per direction multiplied by the block's hours, and `P` its historical average peak load factor. Under *fixed passenger volume and perfectly even redistribution* across one additional trip, the illustrative factor is `P × N / (N + 1)`. Show a range from **no redistribution** (`P`) to this idealized case. Because `N` is an average service-intensity estimate, this is a block-level illustration, not a particular day's measured trip count. State that the formula cannot predict the load of the added bus, an exact queue, or the effect at a particular stop. In the MVP, disable the sensitivity result if no same-year `N` is available. A future cross-year mode may combine 2025 demand with a 2026 schedule only behind an explicit assumption toggle.

Moving a departure is a second scenario type. Recompute gaps, but label operator, vehicle, layover, and depot feasibility **“not assessed.”** Do not call a plan cost-neutral merely because one departure was moved; an added trip may require a whole vehicle run and driver time.

### 4.5 Future validated mode

If stop-level, timestamped passenger-arrival counts and bus occupancy become available, enable a per-bus queue model: waiting passengers before bus `i` equal leftovers from bus `i−1` plus new arrivals; boardings are limited by available vehicle capacity. Train and test on separate dates. Keep this mode disabled in the MVP because the current public sources do not provide those inputs.

## 5. Interface

**Single-screen layout:**

- Top: question, selected week, and a clear evidence-status badge.
- Left: synthetic UBC weekly activity chart and academic-calendar markers.
- Centre: 99/R4/49 comparison cards with measured historical crowding and current scheduled service.
- Bottom: departure timeline. Click a gap to insert an extra trip or select a trip to move.
- Right: before/after panel with schedule-gap change, crowding sensitivity range, assumptions, and source links.

Use distinct visual styles for measured data, synthetic data, and scenario outputs. A map is optional; plotting the shared UBC coordinate as individual people is prohibited because every synthetic UBC record uses the same coordinate.

## 6. MVP architecture

- **Databricks notebooks / SQL:** ingest the supplied CSV and official transit tables, clean dates/directions, aggregate synthetic activity, create the five curated tables above, and record source URLs and transformation dates.
- **Frontend:** a Streamlit [Databricks App](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/tutorial-streamlit) reading curated Unity Catalog tables through the Databricks SQL connector. Keep scenario math in a small, testable Python module. A local CSV-backed mode is acceptable for development, but the demo must show the Databricks-produced tables.
- **Charts:** activity heatmap, route comparison, and interactive timetable. No 3D crowd map is required.
- **Attribution:** if using TransLink GTFS, include the attribution statement required on its [GTFS data page](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data).

## 7. MVP acceptance criteria

1. User can select 99, R4, or 49, direction, day type, and time; the app displays matching scheduled departures and their effective schedule version.
2. User can insert one departure and see the changed schedule gaps immediately.
3. The app generates at least one candidate route, direction, and departure time from a published schedule and a historical crowding threshold, with each ranking component visible.
4. Historical crowding shows route, direction, time block, year, metric definition, and source link. A missing match displays **“insufficient data”** rather than a fabricated number.
5. The crowding scenario states fixed-demand and passenger-redistribution assumptions and never claims exact per-bus occupancy or queue length.
6. Synthetic record counts are labelled correctly, and the app cannot use hour-level flags while timestamp quality is unresolved.
7. Any mismatch between activity dates, schedule dates, and historical load years is visible before a recommendation can be exported.
8. A judge can understand one example in five minutes: choose a term week, inspect an activity flag, compare 99/R4/49 evidence, add a departure, and read the resulting recommendation card.
9. The exported card says **“pilot candidate”**, not “deploy,” and identifies the missing current passenger and operations data.

## 8. Explicitly deferred

Per-bus crowd predictions, riders left behind, real-time dispatch, weather-caused transit demand, origin-to-bus-route assignment, cost-neutral claims, and changing the physical street alignment of a bus route. These require data or operational constraints absent from the current package.

## 9. Source documents

- [Hackathon working document](https://docs.google.com/document/d/18OgdGXW3euRX57bmUCWkv35_HasoUdm00i__LVAz2p4/edit?tab=t.ddbc50i3nbm1)
- [TransLink current Vancouver/UBC timetable, effective September 7, 2026](https://www.translink.ca/-/media/translink/documents/schedules-and-maps/schedules-by-region/2026-schedules/september/vancouver2-p156.pdf)
- [TransLink 2025 Transit Service Performance Review and downloads](https://www.translink.ca/tspr)
- [UBC 2025 Transportation Status Report](https://planning.ubc.ca/sites/default/files/2026-06/UBC2025-TransportationStatusReport-FINAL.pdf)
