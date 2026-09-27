# A fallback when every nearby route is busy

This is a **planning test**, not a claim that a bus or driver is currently available. It uses [TransLink's 2025 route-load CSV](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/csv-data/2025/tspr2025_bus_peakload_yearlinedaytypeseasontimerangedirection.csv) and the [published GTFS timetable](https://www.translink.ca/about-us/doing-business-with-translink/app-developer-resources/gtfs/gtfs-data), feed `26SEP_20260925`, for Monday 2026-09-28.

## What the data say

For fall 2025 weekdays, eastbound route-level peak load factors during **15:00–18:00** range from **80.3% to 100.2%** across the ten regular routes in the demo. These load factors describe average peak load **somewhere along each route**, not loads at UBC Exchange or on a specific 2026 departure. Taking an existing trip from another busy route could move the problem elsewhere; current per-trip and bay counts are needed to judge that tradeoff. [TransLink defines peak load factor this way](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/tspr/tspr_2019_bus_seabus_handydart_definitions.pdf).

| Route | Fall 2025 eastbound load factor, 15–18 | Departures in sample 2026 block | Longest scheduled internal gap | What an added midpoint trip would do |
| --- | ---: | ---: | --- | --- |
| 33 | 100.0% | 14 | 15:25–15:40, 15 min | Propose **15:32**, splitting the gap into 7 and 8 min; 15 block departures |
| 99 | 100.2% | 56 | 15:57–16:04, 7 min | Propose **16:00**, splitting the gap into 3 and 4 min; 57 block departures |

The 33 is the clearer **timetable illustration**: the proposed trip would depart UBC Exchange Bay 1 and follow the existing 33 path towards 29th Avenue Station. A nearby scheduled 33 trip takes about 77 minutes to complete, so a new trip requires a vehicle, operator, a compatible bay slot, and a plan for what the bus does after reaching the other end. Its effect on actual passenger loads is unknown.

## Crucial check before a pilot

TransLink [already increased weekday afternoon route 33 service in September 2026](https://www.translink.ca/holidayservice): it advertises 9–15 minute departures towards 29th Avenue Station from 14:30 to 18:00, compared with 12–18 minutes previously. The GTFS sample above reflects a **post-change timetable**, while the crowding signal is from **2025**. We therefore cannot say the 33 still needs more service. First obtain post-change per-trip automatic passenger counts or pass-up reports. If sustained crowding remains, test one additional peak trip (or a larger compatible vehicle); if it does not, present the September service increase as the intervention that addressed the earlier signal. [TransLink's service guidelines](https://www.translink.ca/-/media/translink/documents/plans-and-projects/managing-the-transit-network/transit-oriented-communities/transit-services-guidelines-public-summary.pdf) identify added trips or larger vehicles as possible responses to high passenger loads.

This is an earlier, separate planning analysis. The current app focuses on reassigning an existing scheduled trip between nearby bays; it does not offer an added-bus option.
