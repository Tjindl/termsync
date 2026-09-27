/*
 * Bus switch finder: which bus could fill a gap on a crowded route, and is it practical?
 *
 * A gap is the time between two scheduled departures of the target route at UBC Exchange. Two kinds of
 * bus can fill it:
 *
 *   Finishing bus   A bus from another route whose day ends at UBC Exchange (GTFS vehicle block) runs one
 *                   more trip, on the target route, before heading to the depot. Nobody loses a trip; the cost is extra
 *                   driver and bus time. This is what dispatchers try first.
 *   Borrowed trip   A bus about to leave UBC on another route runs the target trip instead. Its own
 *                   riders wait for the next bus on their route.
 *
 * Checks (any failure rules a bus out):
 *   1. Timing        It leaves at least 3 min from either scheduled target bus, or it only bunches with
 *                    them. A finishing bus leaves at the middle of the gap if it can, after 5 min recovery,
 *                    and waits at most 20 min.
 *   2. Bay           A borrowed bus's bay is within 250 m of the target's bay.
 *   3. Vehicle       Electric trolley buses (4, 9, 14) need overhead wire and can't pass other trolleys,
 *                    so they only cover other trolley routes, not the 99, R4, 49 and other diesel routes. The campus shuttle (68) and NightBus (N17) are
 *                    not swapped with city routes.
 *   4. Its riders    After a borrowed trip is cancelled, the next bus on its route must end up less full
 *                    than the target bus it relieves: never make another route worse than the gap you fix.
 *                    Crowded (84%+, TransLink's line) or over capacity is flagged.
 *   5. Its schedule  From where the covered trip ends, an empty run (road ≈ 1.3 × straight line; no stops,
 *                    so 25 km/h in peaks and 32 km/h otherwise) plus 5 min recovery reaches its next trip.
 *                    Failing that, it returns to UBC for its next departure there, cancelling one more trip.
 *   6. Net benefit   Riders overall gain more waiting time than they lose.
 *
 * Scoring in rider-minutes. Riders turn up at random; λ = riders per minute for a route and time block =
 * 2025 TSPR average peak load ÷ scheduled headway (these trips start at UBC, so the busiest point's load
 * stands in for everyone on board). Splitting a gap G into a + b saves λ(G² − a² − b²)/2 = λ·a·b; merging
 * a borrowed trip's two headways costs its riders the same formula in reverse. A bus can carry its route's
 * capacity (TSPR peak load ÷ load factor, median over the day); riders beyond it are left behind and wait
 * one more headway. A cancelled return trip is costed like the borrowed one (inbound loads aren't in the data).
 *
 * Not modelled: the driver's route knowledge and shift rules, the depot, and today's real loads.
 */
(function (root) {
  "use strict";

  const RULES = {
    maxBayMetres: 250,
    minSplitMinutes: 3,
    crowdedLoad: 84,
    fullLoad: 100,
    recoveryMinutes: 5,
    comfortableSlackMinutes: 3,  // "recommended" needs at least this much spare time before its next trip
    clearBenefitShare: 0.5,      // ...and a borrowed trip must keep at least half of what the target riders gain
    maxSpareWaitMinutes: 20,     // a finishing bus won't be held at UBC longer than this
    roadFactor: 1.3,
    emptyRunKmh: { peak: 25, offPeak: 32 },
    peakWindows: [[7 * 60, 9 * 60 + 30], [15 * 60, 18 * 60 + 30]],
    trolleyRoutes: ["4", "9", "14"],
    trolleyCapableTargets: [],
    maxGapMinutes: 60,           // a longer gap is a scheduled service break, not a gap to fill
  };

  function clock(minute) {
    const m = Math.round(minute);
    return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  function km(a, b) {
    const rad = Math.PI / 180;
    const x = Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lon - a.lon) * rad / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(x));
  }

  function emptyRunMinutes(straightKm, minute) {
    const m = minute % 1440;
    const peak = RULES.peakWindows.some(([start, end]) => m >= start && m < end);
    return straightKm * RULES.roadFactor / (peak ? RULES.emptyRunKmh.peak : RULES.emptyRunKmh.offPeak) * 60;
  }

  const cache = new WeakMap();
  function memo(data, key, make) {
    if (!cache.has(data)) cache.set(data, new Map());
    const store = cache.get(data);
    if (!store.has(key)) store.set(key, make());
    return store.get(key);
  }

  /** Riders a route's bus can carry: TSPR peak load ÷ load factor, median over its time blocks. */
  function capacity(data, routeId) {
    return memo(data, `cap:${routeId}`, () => {
      const values = Object.values(data.routes[routeId]?.blocks || {})
        .filter((b) => b.loadPercent > 0 && b.peakOnboard > 0).map((b) => b.peakOnboard / (b.loadPercent / 100)).sort((a, b) => a - b);
      return values.length ? values[Math.floor(values.length / 2)] : null;
    });
  }

  /** Headway, riders per minute and capacity for a route at a given minute (null without data). */
  function routeStats(data, routeId, minute) {
    const period = data.timeBlocks.find((b) => minute >= b.start && minute < b.end);
    if (!period) return null;
    return memo(data, `stats:${routeId}:${period.code}`, () => {
      const measure = data.routes[routeId]?.blocks[String(period.code)];
      const cap = capacity(data, routeId);
      if (!measure || !measure.peakOnboard || !cap) return null;
      const count = data.routes[routeId].departures.filter((t) => t.minute >= period.start && t.minute < period.end).length;
      if (!count) return null;
      const headway = (period.end - period.start) / count;
      return { headway, capacity: cap, perMinute: measure.peakOnboard / headway, load: measure.loadPercent };
    });
  }

  const leftBehind = (stats, minutes, cap) => Math.max(0, stats.perMinute * minutes - cap);

  /** Effect on the target route's riders of an extra bus (capacity `cap`) leaving at minute t. */
  function targetEffect(T, gap, t, cap) {
    const a = t - gap.first.minute, b = gap.next.minute - t, G = a + b;
    const relief = Math.max(0, leftBehind(T, G, T.capacity) - leftBehind(T, b, T.capacity) - leftBehind(T, a, cap));
    return {
      gap: G, split: [a, b], nextBus: gap.next, riders: T.perMinute * G,
      waitBefore: G / 2, waitAfter: (a * a + b * b) / (2 * G),
      nextLoadBefore: T.perMinute * G / T.capacity * 100,
      nextLoadAfter: T.perMinute * b / T.capacity * 100,
      extraBusLoad: T.perMinute * a / cap * 100,
      leftBehindRelief: relief,
      waitSaved: T.perMinute * a * b,
      leftBehindSaved: relief * T.headway,
    };
  }

  /** How a borrowed bus gets back to its own schedule after running the covered trip. */
  function planReturn(map, gap, trip) {
    const covered = map?.trips?.[gap.first.tripId];
    const own = map?.trips?.[trip.tripId];
    if (!covered || !own) return { kind: "unknown" };
    const end = map.shapes[covered[0]].end;
    const finish = trip.minute + covered[1];
    const base = { finish, end, run: covered[1] };
    if (own.length < 5) return { ...base, kind: "unknown" };
    if (own[2] === null) {  // its day ends after this trip: it heads to the depot from somewhere else
      const usualEnd = map.shapes[own[0]].end;
      return { ...base, kind: "ends", at: usualEnd, apartKm: km(end, usualEnd) };
    }
    const nextStop = map.blockStops[own[3]];
    const toNext = km(end, nextStop);
    const arrive = finish + emptyRunMinutes(toNext, finish);
    const slack = own[2] - RULES.recoveryMinutes - arrive;
    if (slack >= 0) {
      return { ...base, kind: "rejoin", at: nextStop, emptyKm: toNext * RULES.roadFactor, emptyMinutes: arrive - finish, nextDeparture: own[2], slack };
    }
    if (own[4] !== null) {  // skip its next trip and go straight back to UBC for its next departure there
      const ubc = { lon: map.ubc[0], lat: map.ubc[1], name: "UBC Exchange" };
      const toUbc = km(end, ubc);
      const arriveUbc = finish + emptyRunMinutes(toUbc, finish);
      const slackUbc = own[4] - RULES.recoveryMinutes - arriveUbc;
      if (slackUbc >= 0) {
        return { ...base, kind: "ubc", at: ubc, emptyKm: toUbc * RULES.roadFactor, emptyMinutes: arriveUbc - finish, nextDeparture: own[4], slack: slackUbc,
          skipped: { departure: own[2], from: nextStop } };
      }
    }
    return { ...base, kind: "late", at: nextStop, nextDeparture: own[2], shortBy: -slack };
  }

  /** Rule a bus out; `code` groups reasons for a summary (bunch, bay, trolley, service, data, edge, crowd, late, timing, net, duplicate). */
  function reject(option, code, text) {
    option.reasons.push(text);
    option.codes.push(code);
  }

  function vehicleCheck(option, data, donorId, targetId) {
    const service = data.routes[donorId]?.serviceType;
    if (service && service !== "regular") {
      reject(option, "service", service === "campus_shuttle" ? "Campus shuttle: it isn't swapped with city routes." : "NightBus: it isn't swapped with daytime city routes.");
    }
    const wired = RULES.trolleyRoutes.includes(targetId) || RULES.trolleyCapableTargets.includes(targetId);
    if (RULES.trolleyRoutes.includes(donorId) && !wired) {
      reject(option, "trolley", `Electric trolley bus: it needs overhead wire and can't pass other trolleys, so it can't run the ${targetId}.`);
    }
  }

  function finish(option, targetId) {
    if (!option.reasons.length) {
      const gain = option.target.waitSaved + option.target.leftBehindSaved;
      option.net = gain - (option.donor ? option.donor.cost : 0);
      if (option.net <= 0) reject(option, "net", `${option.donorId} riders would lose more waiting time than ${targetId} riders save.`);
      else if (option.net < RULES.clearBenefitShare * gain) option.warnings.push(`Close call: ${option.donorId} riders lose almost as much waiting time as ${targetId} riders save.`);
    }
    const easy = option.kind === "spare" || (option.plan.kind === "rejoin" && option.plan.slack >= RULES.comfortableSlackMinutes);
    option.verdict = option.reasons.length ? "rejected" : easy && !option.warnings.length ? "recommended" : "workable";
    return option;
  }

  /** A bus on route `donorId` leaving UBC as departure number `index`, running the target trip instead. */
  function evaluateTrip(ctx, gap, targetId, donorId, index) {
    const { data, map } = ctx;
    const trips = data.routes[donorId].departures;
    const trip = trips[index];
    const t = trip.minute;
    const option = { kind: "trip", id: `${donorId}:${trip.tripId}`, donorId, trip, departure: t,
      distance: Math.round(km(gap.first, trip) * 1000), reasons: [], codes: [], warnings: [] };
    const fail = (code, text) => reject(option, code, text);

    if (t - gap.first.minute < RULES.minSplitMinutes || gap.next.minute - t < RULES.minSplitMinutes) {
      fail("bunch", `Leaves within ${RULES.minSplitMinutes} min of a scheduled ${targetId}, so it would only bunch with it.`);
    }
    if (option.distance > RULES.maxBayMetres) fail("bay", `Its bay is ${option.distance} m from the ${targetId} bay (limit ${RULES.maxBayMetres} m).`);
    vehicleCheck(option, data, donorId, targetId);

    const T = routeStats(data, targetId, t), D = routeStats(data, donorId, t);
    const prev = trips[index - 1], next = trips[index + 1];
    if (!T || !D) fail("data", "No 2025 load data for this time of day.");
    else if (!prev || !next) fail("edge", `First or last ${donorId} of the day, so no other bus can take its riders.`);
    else {
      option.target = targetEffect(T, gap, t, D.capacity);
      const p = t - prev.minute, n = next.minute - t, merged = p + n;
      const extraLeft = Math.max(0, leftBehind(D, merged, D.capacity) - leftBehind(D, p, D.capacity) - leftBehind(D, n, D.capacity));
      option.donor = {
        split: [p, n], gap: merged, nextBus: next, riders: D.perMinute * merged,
        waitBefore: (p * p + n * n) / (2 * merged), waitAfter: merged / 2,
        nextLoadBefore: D.perMinute * n / D.capacity * 100,
        nextLoadAfter: D.perMinute * merged / D.capacity * 100,
        leftBehind: extraLeft,
        waitAdded: D.perMinute * p * n,
        leftBehindAdded: extraLeft * D.headway,
      };
      const load = Math.round(option.donor.nextLoadAfter), relieved = Math.round(option.target.nextLoadBefore);
      if (load >= relieved) fail("crowd", `The next ${donorId} (${clock(next.minute)}) would be about ${load}% full, worse than the ${relieved}% ${targetId} it relieves.`);
      else if (load > RULES.fullLoad) option.warnings.push(`Some ${donorId} riders may be left behind: the ${clock(next.minute)} would be about ${load}% full.`);
      else if (load >= RULES.crowdedLoad) option.warnings.push(`The next ${donorId} (${clock(next.minute)}) would be crowded, about ${load}% full.`);
    }

    option.plan = planReturn(map, gap, trip);
    const plan = option.plan;
    if (plan.kind === "late") fail("late", `Can't get back in time: it would reach ${plan.at.name} about ${Math.ceil(plan.shortBy)} min too late for its ${clock(plan.nextDeparture)} trip.`);
    if (plan.kind === "unknown") option.warnings.push("Its own schedule couldn't be checked.");
    if (plan.kind === "ends") option.warnings.push("It's this bus's last trip of the day, so it heads to the depot from a different place.");
    if (plan.kind === "ubc") option.warnings.push(`It also skips its ${clock(plan.skipped.departure)} trip from ${plan.skipped.from.name} to get back to UBC.`);
    if (plan.kind === "rejoin" && plan.slack < RULES.comfortableSlackMinutes) option.warnings.push(`Only ${Math.floor(plan.slack)} min to spare before its ${clock(plan.nextDeparture)} trip.`);
    if (option.donor) {
      option.donor.skippedCost = plan.kind === "ubc" ? option.donor.waitAdded : 0;
      option.donor.cost = option.donor.waitAdded + option.donor.leftBehindAdded + option.donor.skippedCost;
    }
    return finish(option, targetId);
  }

  /** A bus finishing its day at UBC (`bus` = [route, arrival, bay, lon, lat]) running one more trip. */
  function evaluateSpare(ctx, gap, targetId, bus) {
    const { data, map } = ctx;
    const [donorId, arrival, bay, lon, lat] = bus;
    const option = { kind: "spare", id: `spare:${donorId}:${arrival}`, donorId, arrival, bay: { bay, lon, lat },
      distance: Math.round(km(gap.first, { lon, lat }) * 1000), reasons: [], codes: [], warnings: [] };
    const lo = Math.max(arrival + RULES.recoveryMinutes, gap.first.minute + RULES.minSplitMinutes);
    const hi = Math.min(arrival + RULES.maxSpareWaitMinutes, gap.next.minute - RULES.minSplitMinutes);
    const ideal = Math.round((gap.first.minute + gap.next.minute) / 2);
    option.departure = Math.min(Math.max(ideal, lo), Math.max(lo, hi));
    if (gap.next.minute - gap.first.minute < 2 * RULES.minSplitMinutes) {
      reject(option, "bunch", `The gap is only ${gap.next.minute - gap.first.minute} min, so any extra bus would bunch with a scheduled ${targetId}.`);
    } else if (arrival + RULES.recoveryMinutes > gap.next.minute - RULES.minSplitMinutes) {
      reject(option, "timing", `It reaches UBC at ${clock(arrival)}, too late to leave before the ${clock(gap.next.minute)} ${targetId}.`);
    } else if (lo > hi) {
      reject(option, "timing", `It reaches UBC at ${clock(arrival)} and would wait more than ${RULES.maxSpareWaitMinutes} min.`);
    }
    vehicleCheck(option, data, donorId, targetId);
    const T = routeStats(data, targetId, option.departure), cap = capacity(data, donorId);
    if (!T || !cap) reject(option, "data", "No 2025 load data for this time of day.");
    else option.target = targetEffect(T, gap, option.departure, cap);
    const covered = map?.trips?.[gap.first.tripId];
    option.plan = covered
      ? { kind: "depot", end: map.shapes[covered[0]].end, run: covered[1], finish: option.departure + covered[1],
        wait: option.departure - arrival, extraMinutes: option.departure - arrival + covered[1] }
      : { kind: "depot", wait: option.departure - arrival };
    return finish(option, targetId);
  }

  /** Every bus that could fill the gap: practical options (best first) and the rest with reasons. */
  function switchesForGap(ctx, gap, targetId) {
    if (!gap || gap.next.minute - gap.first.minute > RULES.maxGapMinutes) return { options: [], rejected: [], checked: 0 };
    const all = [];
    for (const [donorId, info] of Object.entries(ctx.data.routes)) {
      if (donorId === targetId) continue;
      info.departures.forEach((trip, index) => {
        if (trip.minute > gap.first.minute && trip.minute < gap.next.minute) all.push(evaluateTrip(ctx, gap, targetId, donorId, index));
      });
    }
    for (const bus of ctx.map?.spareBuses || []) {  // other routes' finishing buses, arriving from just before the gap to its end
      if (bus[0] === targetId) continue;
      if (bus[1] >= gap.first.minute - RULES.maxSpareWaitMinutes && bus[1] < gap.next.minute) all.push(evaluateSpare(ctx, gap, targetId, bus));
    }
    const rank = { recommended: 0, workable: 1 };
    const seen = new Set(), options = [];
    for (const o of all.filter((x) => x.verdict !== "rejected")
      .sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.net - a.net || (a.plan.emptyKm ?? 0) - (b.plan.emptyKm ?? 0))) {
      if (!seen.has(o.donorId)) { seen.add(o.donorId); options.push(o); continue; }
      reject(o, "duplicate", `A better ${o.donorId} bus is already offered.`);  // one bus per route, its best option
      o.verdict = "rejected";
    }
    const rejected = all.filter((o) => o.verdict === "rejected").sort((a, b) => a.departure - b.departure);
    return { options, rejected, checked: all.length };
  }

  const api = { RULES, clock, capacity, routeStats, emptyRunMinutes, planReturn, evaluateTrip, evaluateSpare, switchesForGap };
  root.Switching = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
