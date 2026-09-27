// node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const Switching = require("../app/switching.js");

const UBC = { lon: -123.2466, lat: 49.2674 };
const near = (metres) => ({ lon: UBC.lon + metres / 72700, lat: UBC.lat });  // ~72.7 km per degree of longitude here

function every(route, start, step, count, extra = {}) {
  return Array.from({ length: count }, (_, i) => ({ minute: start + i * step, tripId: `${route}-${start + i * step}`, bay: `Bay ${route}`, ...near(0), ...extra }));
}

/** A 15–18 block: the 99 every 10 min at 100% load, a light 25 every 10 min, a busy 33, a trolley 9, a 44 that bunches. */
function fixture({ nextDeparture = 980, nextUbc = 1030, spare = [] } = {}) {
  const routes = {
    99: { departures: every("99", 900, 10, 18), blocks: { 15: { peakOnboard: 75, loadPercent: 100 } } },
    25: { departures: every("25", 905, 10, 18, near(40)), blocks: { 15: { peakOnboard: 8, loadPercent: 16 } } },
    33: { departures: every("33", 905, 10, 18, near(60)), blocks: { 15: { peakOnboard: 45, loadPercent: 90 } } },
    9: { departures: every("9", 905, 10, 18, near(30)), blocks: { 15: { peakOnboard: 5, loadPercent: 10 } } },
    44: { departures: every("44", 901, 10, 18, near(30)), blocks: { 15: { peakOnboard: 5, loadPercent: 10 } } },
  };
  const data = { timeBlocks: [{ code: 15, start: 900, end: 1080, label: "15–18" }], routes };
  const endA = { name: "End A", lon: -123.07, lat: 49.26 }, endB = { name: "End B", lon: -123.07, lat: 49.27 };
  const trips = {};
  for (const [id, info] of Object.entries(routes)) for (const trip of info.departures) trips[trip.tripId] = [id === "99" ? 0 : 1, 40, nextDeparture, 0, nextUbc];
  const map = { ubc: [UBC.lon, UBC.lat], shapes: [{ route: "99", end: endA }, { route: "25", end: endB }], trips, blockStops: [endB], spareBuses: spare };
  return { data, map };
}

const gapAt = (ctx, minute) => {
  const trips = ctx.data.routes["99"].departures;
  const i = trips.findIndex((t) => t.minute === minute);
  return { first: trips[i], next: trips[i + 1] };
};
const donorIndex = (ctx, route, minute) => ctx.data.routes[route].departures.findIndex((t) => t.minute === minute);

test("an extra bus mid-gap halves the average wait and saves λ·a·b rider-minutes", () => {
  const ctx = fixture();
  const o = Switching.evaluateTrip(ctx, gapAt(ctx, 920), "99", "25", donorIndex(ctx, "25", 925));
  assert.deepEqual(o.target.split, [5, 5]);
  assert.equal(o.target.waitBefore, 5);
  assert.equal(o.target.waitAfter, 2.5);
  assert.equal(o.target.waitSaved, 7.5 * 5 * 5);        // 75 riders per 10 min
  assert.equal(o.donor.waitAdded, 0.8 * 10 * 10);         // its 10 + 10 min headways merge into 20
  assert.equal(Math.round(o.donor.nextLoadAfter), 32);
  assert.equal(o.plan.kind, "rejoin");
  assert.equal(o.verdict, "recommended");
  assert.ok(Math.abs(o.net - (187.5 - 80)) < 1e-9);
});

test("buses that would bunch, trolleys and busy routes are ruled out with a reason", () => {
  const ctx = fixture();
  const gap = gapAt(ctx, 920);
  const bunch = Switching.evaluateTrip(ctx, gap, "99", "44", donorIndex(ctx, "44", 921));
  const trolley = Switching.evaluateTrip(ctx, gap, "99", "9", donorIndex(ctx, "9", 925));
  const busy = Switching.evaluateTrip(ctx, gap, "99", "33", donorIndex(ctx, "33", 925));
  assert.ok(bunch.codes.includes("bunch"));
  assert.ok(trolley.codes.includes("trolley"));
  assert.deepEqual(busy.codes, ["crowd"]);                 // its next bus would be 180% full vs the 99's 100%
  for (const o of [bunch, trolley, busy]) assert.equal(o.verdict, "rejected");
});

test("a bus that can't reach its next trip goes back to UBC and skips one, or is rejected", () => {
  const skip = fixture({ nextDeparture: 970 });
  const viaUbc = Switching.evaluateTrip(skip, gapAt(skip, 920), "99", "25", donorIndex(skip, "25", 925));
  assert.equal(viaUbc.plan.kind, "ubc");
  assert.equal(viaUbc.plan.skipped.departure, 970);
  assert.equal(viaUbc.donor.skippedCost, viaUbc.donor.waitAdded);
  assert.notEqual(viaUbc.verdict, "recommended");

  const tight = fixture({ nextDeparture: 970, nextUbc: 1010 });
  const late = Switching.evaluateTrip(tight, gapAt(tight, 920), "99", "25", donorIndex(tight, "25", 925));
  assert.equal(late.plan.kind, "late");
  assert.ok(late.codes.includes("late"));
});

test("a finishing bus leaves mid-gap after recovery, and nobody loses a trip", () => {
  const ctx = fixture({ spare: [["25", 910, "Unloading Only", UBC.lon, UBC.lat]] });
  const o = Switching.evaluateSpare(ctx, gapAt(ctx, 920), "99", ctx.map.spareBuses[0]);
  assert.equal(o.departure, 925);
  assert.equal(o.plan.wait, 15);
  assert.equal(o.plan.extraMinutes, 55);
  assert.equal(o.donor, undefined);
  assert.equal(o.net, 187.5);
  assert.equal(o.verdict, "recommended");

  const tooLate = Switching.evaluateSpare(ctx, gapAt(ctx, 920), "99", ["25", 926, "Unloading Only", UBC.lon, UBC.lat]);
  const tooEarly = Switching.evaluateSpare(ctx, gapAt(ctx, 920), "99", ["25", 890, "Unloading Only", UBC.lon, UBC.lat]);
  const shortGap = Switching.evaluateSpare(ctx, { first: gapAt(ctx, 920).first, next: { minute: 925 } }, "99", ctx.map.spareBuses[0]);
  assert.deepEqual(tooLate.codes, ["timing"]);
  assert.deepEqual(tooEarly.codes, ["timing"]);
  assert.deepEqual(shortGap.codes, ["bunch"]);
});

test("service breaks are not filled, and a campus shuttle is never borrowed", () => {
  const ctx = fixture();
  ctx.data.routes["25"].serviceType = "campus_shuttle";
  const shuttle = Switching.evaluateTrip(ctx, gapAt(ctx, 920), "99", "25", donorIndex(ctx, "25", 925));
  assert.ok(shuttle.codes.includes("service"));
  const trips = ctx.data.routes["99"].departures;
  assert.deepEqual(Switching.switchesForGap(ctx, { first: trips[0], next: { ...trips[1], minute: trips[0].minute + 61 } }, "99"),
    { options: [], rejected: [], checked: 0 });
});

test("options are ranked by verdict then net benefit, one per route, never the route's own bus", () => {
  const ctx = fixture({ spare: [["25", 910, "Unloading Only", UBC.lon, UBC.lat], ["99", 915, "Unloading Only", UBC.lon, UBC.lat]] });
  const result = Switching.switchesForGap(ctx, gapAt(ctx, 920), "99");
  // The 25's finishing bus beats its borrowed trip (nobody loses a trip); the 99's own finishing bus isn't offered.
  assert.deepEqual(result.options.map((o) => `${o.kind}:${o.donorId}`), ["spare:25"]);
  assert.ok([...result.options, ...result.rejected].every((o) => o.donorId !== "99"));
  assert.equal(result.checked, result.options.length + result.rejected.length);
  assert.ok(result.rejected.every((o) => o.reasons.length && o.reasons.length === o.codes.length));
});

test("on the real 2026 schedule every option shown obeys the hard rules", () => {
  const ctx = { data: require("../app/data.json"), map: require("../app/route_map.json") };
  const R = Switching.RULES;
  let shown = 0;
  for (const target of ctx.data.targetRoutes.filter((id) => ctx.data.routes[id].serviceType === "regular")) {
    const trips = ctx.data.routes[target].departures;
    for (let i = 0; i < trips.length - 1; i++) {
      const { options } = Switching.switchesForGap(ctx, { first: trips[i], next: trips[i + 1] }, target);
      assert.equal(new Set(options.map((o) => o.donorId)).size, options.length);
      for (const o of options) {
        shown++;
        assert.notEqual(o.donorId, target, o.id);
        assert.ok(o.target.split.every((m) => m >= R.minSplitMinutes), o.id);
        assert.ok(o.net > 0, o.id);
        assert.ok(!R.trolleyRoutes.includes(o.donorId) || R.trolleyRoutes.includes(target), o.id);  // trolleys only on wired routes
        assert.equal(ctx.data.routes[o.donorId].serviceType, "regular", o.id);
        assert.ok(o.target.gap <= R.maxGapMinutes, o.id);
        if (o.kind === "trip") {
          assert.ok(o.distance <= R.maxBayMetres, o.id);
          assert.ok(o.donor.nextLoadAfter < o.target.nextLoadBefore, o.id);
          assert.ok(["rejoin", "ubc", "ends", "unknown"].includes(o.plan.kind), o.id);
        } else {
          assert.ok(o.plan.wait >= R.recoveryMinutes && o.plan.wait <= R.maxSpareWaitMinutes, o.id);
        }
      }
    }
  }
  assert.ok(shown > 100, `only ${shown} options on the whole day`);
});
