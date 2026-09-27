# Key numbers for the deck

Every figure below comes from the app's own data files and logic, as of 2026-09-27, after merging Harshpreet's simulated line counts. The deck and the live site should quote the same values. If the data or rules change, re-check these numbers against the site.

## The headline

At UBC Exchange, the R4 and 49 run at or over capacity at 18:00 on Tuesdays and Thursdays. Redirecting a bus from another route there costs its riders more waiting than it saves. Adding a trip is what helps.

## Where the crunch is

**How "full" is measured.** Simulated students leaving UBC each hour (the team's Monte Carlo model, students only) ÷ scheduled capacity. Scheduled capacity is the buses the 2026 timetable runs that hour × about 75 riders per bus, the capacity implied by TransLink's 2025 TSPR loads.

| Route | Fullest hours | Hours at 84%+ in a week |
| --- | --- | ---: |
| R4 | Tue 18:00 **100%** (903 / 900) · Thu 18:00 **97%** (870 / 900) · Tue and Thu 19:00 87–89% | 4 |
| 49 | Thu 18:00 **93%** (558 / 600) · Tue 18:00 **90%** (541 / 600) · Wed 18:00 75% | 2 |
| 99 | Thu 18:00 72% (699 / 976) · Tue 18:00 71% | 0 |

**Why the 99 differs.** TransLink's 2025 route averages (TSPR, all riders, busiest point on the route, 15:00–18:00) put the 99 at **100%**, the R4 at **93%** and the 49 at **91%**. The simulation counts students only, which is why it shows the 99 lower. Say which source a number comes from.

## Redirecting vs adding a trip

This covers every gap from 15:00 to 21:00, using the app's comparison (step 03). The figures are waiting time, in passenger-minutes, for the people at the two bays.

| Route | Thursday | Tuesday |
| --- | --- | --- |
| R4 | Redirect best in 1 gap; add a trip in 19 | Redirect best in 1 gap; add a trip in 19 |
| 49 | Redirect best in 1 gap; add a trip in 8 | Redirect best in 1 gap; add a trip in 8 |
| 99 | Redirect best in 1 gap; add a trip in 0 | Redirect best in 0 gaps; add a trip in 0 |

On average, the best available redirect loses about **160 passenger-minutes** per gap for the 49, **205** for the R4, and **400** for the 99. The reason is structural. Filling a 4–8 minute gap on a frequent route saves little, while the borrowed bus usually comes from a route that runs every 10–15 minutes, so its riders wait a whole extra gap.

**Worked example (the default view).** R4, Thursday, 18:05 → 18:10 gap, at 97% of scheduled capacity:

| Option | Passenger-minutes |
| --- | ---: |
| Redirect the 99 at 18:06 | **−45** (~15 R4 riders leave 4 min sooner; ~35 99 riders wait 3 min longer) |
| Add an R4 at 18:07 | **+87** (~29 riders leave 3 min sooner; needs one bus and driver for ~50 min) |
| Leave it | 0 |

**Second example.** 49, Tuesday, 18:18 → 18:25 gap, at 90% of scheduled capacity:

| Option | Passenger-minutes |
| --- | ---: |
| Redirect the 99 at 18:24 | **−121** |
| Add a 49 at 18:21 | **+108** |

**When a redirect does win.** The app's first example button shows the 99 at 17:43 moved to the 9 on a Monday. It saves **1,043** passenger-minutes, the day's largest simulated saving: 79 students wait 14 min for the 9, against 21 on the 99.

## What the screening found

In the 15:00–18:00 block, a bus could be redirected in **16 of 56** 99 gaps, **23 of 47** R4 gaps and **23 of 35** 49 gaps. Before the screen was relaxed, none of these 138 gaps had an option. Most remaining 99 gaps are under 4 minutes, too short to fill.

## Context

- **Daily trips to and from UBC**, fall 2025 weekday screenline (UBC Transportation Status Report): 99 **18,600**, R4 **16,832**, 49 **12,880**.
- **Peak hour**, 17:00–18:00: **5,655** transit trips leave UBC eastbound, across all routes.
- **Scheduled departures from UBC** on Monday 2026-09-28 (GTFS): 99 **227**, R4 **200**, 49 **153**.

## Links to the live views

These work on the local server (`python3 -m http.server 5173`), and on the published site once it is live.

| View | Link |
| --- | --- |
| The crunch | `?route=R4&day=thu&hour=18` |
| 49 on a Tuesday | `?route=49&day=tue&hour=18` |
| 99 on a Thursday | `?route=99&day=thu&hour=18` |
| A quiet hour ("leave it") | `?route=99&day=avg&hour=12` |

## Charts in `charts/`

Images are exported at 2× resolution.

| File | Shows |
| --- | --- |
| `01-overview-r4-thu-1800.png` | The whole page at the crunch |
| `02-hourly-r4-thursday.png` | R4 students by hour against scheduled capacity; 18:00 at 97% |
| `03-options-r4-thu-1800.png` | Redirect vs add a trip vs leave it |
| `04-map-redirect-r4-thu-1800.png` | Where a redirected 99 would go. The 18:06 99 is a Boundary Loop trip, so its usual end is Boundary Rd, not Commercial–Broadway |
| `05-hourly-49-tuesday.png` | 49 hourly, Tuesday |
| `06-options-49-tue-1800.png` | 49 comparison, Tuesday 18:48 |
| `07-hourly-99-thursday.png` | 99 hourly, Thursday; never above 72% of scheduled capacity |

## Caveats to state on a slide

- **Monte Carlo demand is simulated and counts students only.** The model that generated it is not in this repo. It matches UBC's 2025 survey at the evening peak (84%) but has almost no morning departures.
- **Capacity per bus (~75) is inferred from TransLink's load factors.** Articulated buses may carry more, which would make every percentage lower.
- **TransLink loads are 2025 route averages at each route's busiest point.** The timetable is a 2026 sample Monday.
- **Passenger-minutes count only people waiting at the two bays.** They exclude riders farther along both routes.
