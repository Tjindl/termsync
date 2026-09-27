const state = {
  data: null,
  route: "99",
  block: 15,
  hour: 17 * 60,
  tripId: null,
  candidateId: null,
  swap: null,
  map: null,
};
const MAX_FILLABLE_GAP = 60;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function route(id = state.route) { return state.data.routes[id]; }
function block(code = state.block) { return state.data.timeBlocks.find((item) => item.code === code); }
function departures(id = state.route) { return route(id).departures; }
function measure(id = state.route, code = state.block) { return route(id).blocks[String(code)]; }

function timeLabel(minute) {
  const hour = Math.floor(minute / 60);
  const clock = `${String(hour % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  return minute >= 1440 ? `${clock} +1` : clock;
}

function hourLabel(minute) {
  return `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:00${minute >= 1440 ? " +1" : ""}`;
}

function pressureStatus(percent) {
  if (percent >= 100) return { label: "Overloaded", short: "overloaded", high: true };
  if (percent >= 84) return { label: "Crowded", short: "crowded", high: true };
  if (percent < 60) return { label: "Lighter", short: "lighter", high: false };
  return { label: "Moderate", short: "moderate", high: false };
}

function distanceMetres(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(x)));
}

function selectedGap() {
  const index = departures().findIndex((trip) => trip.tripId === state.tripId);
  if (index < 0 || index >= departures().length - 1) return null;
  return { first: departures()[index], next: departures()[index + 1] };
}

function candidatesForGap(gap, targetId = state.route, code = state.block) {
  if (!gap || route(targetId).serviceType !== "regular") return [];
  const result = [];
  const before = gap.next.minute - gap.first.minute;
  if (before > MAX_FILLABLE_GAP) return result;
  for (const [donorId, donor] of Object.entries(state.data.routes)) {
    if (donorId === targetId || donor.serviceType !== "regular") continue;
    const historical = donor.blocks[String(code)];
    if (!historical || historical.loadPercent >= 60) continue;
    for (let i = 1; i < donor.departures.length - 1; i++) {
      const trip = donor.departures[i];
      if (trip.minute <= gap.first.minute || trip.minute >= gap.next.minute) continue;
      const distance = distanceMetres(gap.first, trip);
      if (distance > 250) continue;
      const donorBefore = Math.max(trip.minute - donor.departures[i - 1].minute,
        donor.departures[i + 1].minute - trip.minute);
      const donorAfter = donor.departures[i + 1].minute - donor.departures[i - 1].minute;
      const targetAfter = Math.max(trip.minute - gap.first.minute, gap.next.minute - trip.minute);
      result.push({
        id: `${donorId}:${trip.tripId}`,
        donorId,
        trip,
        distance,
        historical,
        targetBefore: before,
        targetAfter,
        benefit: before - targetAfter,
        donorBefore,
        donorAfter,
        donorPenalty: donorAfter - donorBefore,
      });
    }
  }
  result.sort((a, b) => (b.benefit - b.donorPenalty) - (a.benefit - a.donorPenalty) || b.benefit - a.benefit || a.distance - b.distance);
  const distinctRoutes = new Set();
  return result.filter((candidate) => {
    if (distinctRoutes.has(candidate.donorId)) return false;
    distinctRoutes.add(candidate.donorId);
    return true;
  }).slice(0, 3);
}

function bestCandidateGap(routeId, code, restrictHour = null) {
  const trips = departures(routeId);
  const period = block(code);
  let best = null;
  for (let i = 0; i < trips.length - 1; i++) {
    const first = trips[i];
    if (first.minute < period.start || first.minute >= period.end) continue;
    if (restrictHour !== null && (first.minute < restrictHour || first.minute >= restrictHour + 60)) continue;
    const options = candidatesForGap({ first, next: trips[i + 1] }, routeId, code);
    if (!options.length) continue;
    const candidate = options[0];
    const score = (candidate.benefit - candidate.donorPenalty) * 100 + candidate.benefit;
    if (!best || score > best.score) best = { tripId: first.tripId, hour: Math.floor(first.minute / 60) * 60, score };
  }
  return best;
}

function selectDefaultTrip(routeId, code) {
  const possible = bestCandidateGap(routeId, code);
  if (possible) return possible;
  const period = block(code);
  const preferredHour = code === 15 ? 17 * 60 : Math.floor((period.start + period.end) / 120) * 60;
  const trips = departures(routeId);
  let pool = trips.map((trip, index) => ({ trip, index }))
    .filter(({ trip, index }) => index < trips.length - 1 && trip.minute >= preferredHour && trip.minute < preferredHour + 60
      && trips[index + 1].minute - trip.minute <= MAX_FILLABLE_GAP);
  if (!pool.length) {
    pool = trips.map((trip, index) => ({ trip, index }))
      .filter(({ trip, index }) => index < trips.length - 1 && trip.minute >= period.start && trip.minute < period.end
        && trips[index + 1].minute - trip.minute <= MAX_FILLABLE_GAP);
  }
  if (!pool.length) return { tripId: null, hour: preferredHour };
  pool.sort((a, b) => (trips[b.index + 1].minute - b.trip.minute) - (trips[a.index + 1].minute - a.trip.minute));
  return { tripId: pool[0].trip.tripId, hour: Math.floor(pool[0].trip.minute / 60) * 60 };
}

function selectRoute(routeId) {
  state.route = routeId;
  const available = state.data.timeBlocks.filter((item) => departures(routeId).some((trip) => trip.minute >= item.start && trip.minute < item.end));
  const ranked = available.filter((item) => measure(routeId, item.code));
  state.block = ranked.length
    ? ranked.reduce((best, item) => measure(routeId, item.code).peakOnboard > measure(routeId, best.code).peakOnboard ? item : best).code
    : available.reduce((best, item) => departures(routeId).filter((trip) => trip.minute >= item.start && trip.minute < item.end).length
        > departures(routeId).filter((trip) => trip.minute >= best.start && trip.minute < best.end).length ? item : best).code;
  const initial = selectDefaultTrip(routeId, state.block);
  state.hour = initial.hour;
  state.tripId = initial.tripId;
  state.candidateId = null;
  render();
}

function selectBlock(code) {
  state.block = code;
  const initial = selectDefaultTrip(state.route, code);
  state.hour = initial.hour;
  state.tripId = initial.tripId;
  state.candidateId = null;
  render();
}

function selectHour(hour) {
  state.hour = hour;
  const possible = bestCandidateGap(state.route, state.block, hour);
  const trips = departures();
  if (possible) state.tripId = possible.tripId;
  else {
    const inHour = trips.map((trip, index) => ({ trip, index }))
      .filter(({ trip, index }) => index < trips.length - 1 && trip.minute >= hour && trip.minute < hour + 60
        && trips[index + 1].minute - trip.minute <= MAX_FILLABLE_GAP)
      .sort((a, b) => (trips[b.index + 1].minute - b.trip.minute) - (trips[a.index + 1].minute - a.trip.minute));
    state.tripId = inHour[0]?.trip.tripId || null;
  }
  state.candidateId = null;
  render();
}

function renderRoutes() {
  $("route-nav").innerHTML = state.data.targetRoutes.map((id) => {
    const info = route(id);
    const peak = Object.values(info.blocks).length ? Math.max(...Object.values(info.blocks).map((value) => value.loadPercent)) : null;
    const detail = info.serviceType === "nightbus" ? "NightBus · schedule only"
      : info.serviceType === "campus_shuttle" ? `Campus shuttle · ${Math.round(peak)}% peak load`
        : `Peak block ${Math.round(peak)}% load`;
    return `<button class="route-button" type="button" data-route="${escapeHtml(id)}" aria-pressed="${id === state.route}" style="--route-color:${routeColor(id)}">
      <span class="route-number">${escapeHtml(id)}</span>
      <span class="route-info"><strong>${escapeHtml(info.name)}</strong><small>${detail}</small></span>
      <span class="route-arrow" aria-hidden="true">↗</span></button>`;
  }).join("");
  $("route-nav").querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => selectRoute(button.dataset.route)));
}

function renderPeriods() {
  const scheduleOnly = route().serviceType === "nightbus";
  $("pressure-title").textContent = scheduleOnly ? "When does it run?" : "When is it busiest?";
  $("pressure-subtitle").textContent = scheduleOnly ? "Scheduled departures on the sample service day" : "Ranked by average highest on-board count";
  $("pressure-source").textContent = scheduleOnly ? "2026 SCHEDULE" : "2025 HISTORY";
  $("pressure-source").className = scheduleOnly ? "source-tag schedule-tag" : "source-tag";
  $("pressure-note").textContent = scheduleOnly
    ? "These are scheduled departures after midnight on the following calendar day. No comparable historical load series is available here."
    : "Each bar is the average busiest point along the full route. It is not a count at UBC Exchange.";
  const values = state.data.timeBlocks.filter((item) => scheduleOnly
    ? departures().some((trip) => trip.minute >= item.start && trip.minute < item.end)
    : measure(state.route, item.code) && departures().some((trip) => trip.minute >= item.start && trip.minute < item.end))
    .map((item) => scheduleOnly
      ? { block: item, count: departures().filter((trip) => trip.minute >= item.start && trip.minute < item.end).length }
      : { block: item, ...measure(state.route, item.code) })
    .sort((a, b) => scheduleOnly ? b.count - a.count : b.peakOnboard - a.peakOnboard);
  const max = Math.max(1, ...values.map((item) => scheduleOnly ? item.count : item.peakOnboard));
  $("period-list").innerHTML = values.map((item) => {
    const status = scheduleOnly ? null : pressureStatus(item.loadPercent);
    return `<button class="period-row ${status?.high ? "is-high" : ""}" type="button" data-block="${item.block.code}" aria-pressed="${item.block.code === state.block}">
      <span class="period-time">${item.block.label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, (scheduleOnly ? item.count : item.peakOnboard) / max * 100)}%"></span></span>
      <span class="period-value">${scheduleOnly ? `${item.count} buses` : `${Math.round(item.peakOnboard)} ppl`}</span>
      <span class="period-state">${scheduleOnly ? "scheduled" : status.short}</span>
    </button>`;
  }).join("");
  $("period-list").querySelectorAll("[data-block]").forEach((button) => button.addEventListener("click", () => selectBlock(Number(button.dataset.block))));
}

function renderSchedule() {
  const info = measure();
  const status = info ? pressureStatus(info.loadPercent) : null;
  $("schedule-subtitle").textContent = `${route().name} · from UBC Exchange · ${block().label}`;
  $("pressure-callout").className = `pressure-callout ${status?.high ? "is-high" : ""}`;
  $("pressure-callout").innerHTML = info
    ? `<strong>${status.label} in this time block</strong><span>${Math.round(info.loadPercent)}% avg peak load</span><p>Historical route average; this does not predict the load on any bus below.</p>`
    : `<strong>Schedule only</strong><span>No load estimate</span><p>This app has no comparable historical load measure for ${escapeHtml(state.route)}, so it cannot estimate crowding or suggest a bus swap.</p>`;
  const hours = [];
  for (let hour = block().start; hour < block().end; hour += 60) hours.push(hour);
  $("hour-tabs").innerHTML = hours.map((hour) => `<button class="hour-tab" type="button" role="tab" data-hour="${hour}" aria-selected="${hour === state.hour}">${hourLabel(hour)}</button>`).join("");
  $("hour-tabs").querySelectorAll("[data-hour]").forEach((button) => button.addEventListener("click", () => selectHour(Number(button.dataset.hour))));
  const trips = departures().filter((trip) => trip.minute >= state.hour && trip.minute < state.hour + 60);
  $("departure-list").innerHTML = trips.length ? trips.map((trip) => `<button class="departure" type="button" data-trip="${escapeHtml(trip.tripId)}" aria-pressed="${trip.tripId === state.tripId}" aria-label="Scheduled departure ${timeLabel(trip.minute)}, ${escapeHtml(trip.bay)}">${timeLabel(trip.minute)}</button>`).join("")
    : `<p class="empty-departures">No scheduled departures in this hour.</p>`;
  $("departure-list").querySelectorAll("[data-trip]").forEach((button) => button.addEventListener("click", () => { state.tripId = button.dataset.trip; state.candidateId = null; renderSchedule(); renderCandidates(); }));
  const gap = selectedGap();
  $("gap-summary").innerHTML = gap ? `<div><span class="gap-label">${gap.next.minute - gap.first.minute > MAX_FILLABLE_GAP ? "Scheduled service break" : "Selected scheduled gap"}</span><strong>${timeLabel(gap.first.minute)} → ${timeLabel(gap.next.minute)}</strong></div><div class="gap-number">${gap.next.minute - gap.first.minute}<small>min</small></div>`
    : `<div><span class="gap-label">Select a departure</span><strong>See its next scheduled bus</strong></div>`;
}

function renderCandidates() {
  const gap = selectedGap();
  const special = route().serviceType !== "regular";
  $("candidates-step").textContent = special ? "ROUTE CONTEXT" : "TEST A NEARBY TRIP";
  $("candidates-title").textContent = special ? "How can we use this route?" : "Could a nearby bus fill that gap?";
  $("candidates-description").textContent = special
    ? "Its published timetable and path are available. Bus-swap suggestions are limited to comparable city routes with historical load data."
    : "Same terminal · within 250 m · scheduled inside the selected gap · historically below 60% load. Check the map for route fit.";
  if (special) {
    state.candidateId = null;
    state.swap = null;
    $("candidate-count").textContent = "ROUTE VIEW";
    const title = route().serviceType === "campus_shuttle" ? "Campus shuttle" : "NightBus schedule";
    const explanation = route().serviceType === "campus_shuttle"
      ? "Route 68 connects UBC Exchange with Wesbrook Village. Its historical load and timetable are shown, but this campus shuttle is excluded from swaps with city routes."
      : "N17 has scheduled trips and a mapped path, but no comparable 2025 route-load series in this app. A crowding or reassignment claim would be unsupported.";
    $("candidates-content").innerHTML = `<div class="no-candidates"><span class="no-candidates-icon" aria-hidden="true">i</span><div><strong>${title}</strong><p>${explanation}</p></div></div>`;
    renderMap();
    return;
  }
  const candidates = candidatesForGap(gap);
  $("candidate-count").textContent = `${candidates.length} ${candidates.length === 1 ? "OPTION" : "OPTIONS"}`;
  if (!candidates.length) {
    state.candidateId = null;
    state.swap = null;
    const lowerLoadRoutes = Object.entries(state.data.routes).filter(([id, info]) => id !== state.route && info.serviceType === "regular" && info.blocks[String(state.block)]?.loadPercent < 60).length;
    const serviceBreak = gap && gap.next.minute - gap.first.minute > MAX_FILLABLE_GAP;
    const explanation = !gap ? "Choose a scheduled departure above to inspect its following gap."
      : serviceBreak ? "This is a scheduled service break, not a continuous-service gap. It is excluded from bus-swap suggestions."
        : lowerLoadRoutes === 0 ? "Every other route with a comparable historical load at UBC Exchange is at or above the 60% cutoff in this block. Moving service would be hard to justify from these data."
        : "Lower-load routes exist, but no scheduled trip from a bay within 250 m falls inside this exact gap. Try another departure.";
    const another = bestCandidateGap(state.route, state.block);
    const later = state.block !== 18 && measure(state.route, 18) ? bestCandidateGap(state.route, 18) : null;
    const action = another ? `<button class="try-button" type="button" id="try-option">Find a possible swap →</button>`
      : later ? `<button class="try-button" type="button" id="try-later">Try 18–21 →</button>` : "";
    $("candidates-content").innerHTML = `<div class="no-candidates"><span class="no-candidates-icon" aria-hidden="true">∅</span><div><strong>${serviceBreak ? "Scheduled service break" : "No suitable nearby trip for this gap"}</strong><p>${explanation}</p></div>${action}</div>`;
    $("try-option")?.addEventListener("click", () => { state.hour = another.hour; state.tripId = another.tripId; render(); });
    $("try-later")?.addEventListener("click", () => selectBlock(18));
    renderMap();
    return;
  }
  if (!candidates.some((candidate) => candidate.id === state.candidateId)) state.candidateId = candidates[0].id;
  const selected = candidates.find((candidate) => candidate.id === state.candidateId);
  state.swap = selected;
  const reroute = rerouteFor(gap, selected);
  const corridorFit = reroute && reroute.offKm / reroute.totalKm <= 1 / 3 && reroute.endGapKm <= 5;
  const scheduleFit = selected.benefit >= selected.donorPenalty;
  const pressureFit = measure().loadPercent >= 84;
  const verdict = !reroute ? "Route fit unavailable" : !corridorFit ? "Poor route fit" : !scheduleFit ? "Poor schedule tradeoff"
    : !pressureFit ? "No high-load signal" : "Needs operations check";
  const explanation = !reroute ? "The trip geometry is unavailable."
    : !corridorFit ? "The bus would leave much of its usual route or finish too far from its usual end."
      : !scheduleFit ? "The donor gap grows more than the target gap shrinks."
        : !pressureFit ? "This route and time block is below the app's 84% historical crowding threshold."
        : "The schedule and path pass this first screen.";
  $("candidates-content").innerHTML = `<div class="candidate-grid">${candidates.map((candidate) => `<button class="candidate" type="button" data-candidate="${escapeHtml(candidate.id)}" aria-pressed="${candidate.id === state.candidateId}">
    <span class="candidate-top"><span class="candidate-route">${escapeHtml(candidate.donorId)}</span><span><span class="candidate-name">${escapeHtml(route(candidate.donorId).name)}</span><span class="candidate-time">${timeLabel(candidate.trip.minute)} · ${escapeHtml(candidate.trip.bay)}</span></span></span>
    <span class="candidate-divider"></span><span class="candidate-facts"><span>${Math.round(candidate.historical.loadPercent)}% historical load</span><span>${candidate.distance} m away</span></span>
    ${(() => { const r = rerouteFor(gap, candidate); return r ? `<span class="candidate-reroute">↪ ${r.offKm.toFixed(1)} km off its route · ends ${r.endGapKm.toFixed(1)} km from its usual end</span>` : ""; })()}
  </button>`).join("")}</div>
  <div class="swap-detail" aria-live="polite">
    <div><span class="metric-label">TARGET GAP IF MOVED</span><strong>${selected.targetBefore} → <span>${selected.targetAfter} min</span></strong></div>
    <div class="penalty"><span class="metric-label">DONOR GAP IF REMOVED</span><strong>${selected.donorBefore} → <span>${selected.donorAfter} min</span></strong></div>
    <p><span class="swap-verdict ${corridorFit && scheduleFit && pressureFit ? "is-favorable" : ""}">${verdict}</span><br />${explanation} This is a timetable scenario, not an available bus. Check actual loads, vehicle type, driver block and recovery time.</p>
  </div>`;
  $("candidates-content").querySelectorAll("[data-candidate]").forEach((button) => button.addEventListener("click", () => { state.candidateId = button.dataset.candidate; renderCandidates(); }));
  renderMap();
}

// ── Route map and rerouting ─────────────────────────────────────────────────────────────
// Target routes keep one colour everywhere. The nearby bus being borrowed is always orange, like the
// donor gap in the swap detail. The projection is equirectangular, fitted to the routes: at city
// scale a kilometre is the same length on both axes, and no map tiles are needed.
const ROUTE_COLORS = {
  99: "var(--route-99)", R4: "var(--route-R4)", 49: "var(--route-49)", 9: "var(--route-9)",
  44: "var(--route-44)", 84: "var(--route-84)", 4: "var(--route-4)", 14: "var(--route-14)",
  25: "var(--route-25)", 33: "var(--route-33)", 68: "var(--route-68)", N17: "var(--route-N17)",
};
const MAP = { width: 1200, minHeight: 400, maxHeight: 640, pad: 30 };
const MAP_LABELS = {
  "Commercial–Broadway": [11, -13, "start"], "Joyce–Collingwood": [13, 5, "start"], "Metrotown": [13, 17, "start"],
  "Broadway–City Hall": [9, 21, "start", true], "Oakridge–41st Avenue": [9, -10, "start", true], "Langara–49th Avenue": [9, 17, "start", true],
};
// Sideways offsets (map units) so lines sharing a street draw side by side: the R4 and 49 on SW Marine
// Drive, and the nearby bus's usual route beside the route it would cover.
const MAP_OFFSET = { R4: -3, 49: 3, 99: -3, 9: 3, 44: -3, 84: 3 };
const MAP_CHIP_FRACTION = { 99: .52, R4: .59, 49: .69, 9: .78, 44: .37, 84: .70 };
const DONOR_OFFSET = 7;
const OFF_ROUTE_KM = 0.08;  // more than 80 m from the bus's usual path counts as off-route
const KM_PER_LON = 111.32 * Math.cos(49.25 * Math.PI / 180), KM_PER_LAT = 110.57;
const INSET = { width: 282, height: 150 };

function routeColor(id) { return ROUTE_COLORS[id] || "var(--ink)"; }

function mapProjector(bbox, box) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const k = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
  const scale = Math.min((box.width - 2 * box.pad) / ((maxLon - minLon) * k || 1e-9), (box.height - 2 * box.pad) / ((maxLat - minLat) || 1e-9));
  const offX = box.x + (box.width - (maxLon - minLon) * k * scale) / 2;
  const offY = box.y + (box.height - (maxLat - minLat) * scale) / 2;
  return { xy: ([lon, lat]) => [offX + (lon - minLon) * k * scale, offY + (maxLat - lat) * scale], pxPerKm: scale / 111.32 };
}

function offsetPoints(points, d) {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] + (b[1] - a[1]) / len * d, p[1] - (b[0] - a[0]) / len * d];
  });
}

function svgPath(points) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

function toKm([lon, lat]) { return [lon * KM_PER_LON, lat * KM_PER_LAT]; }

function densify(coords, stepKm = 0.05) {
  const points = coords.map(toKm), out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepKm));
    for (let k = 1; k <= steps; k++) out.push([ax + (bx - ax) * k / steps, ay + (by - ay) * k / steps]);
  }
  return out;
}

function distanceToLine([px, py], line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1e-12)));
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

/** How far a nearby bus would leave its own route if it covered this gap instead. */
function rerouteFor(gap, candidate) {
  const map = state.map;
  const covered = gap && map?.trips[gap.first.tripId];
  const usual = candidate && map?.trips[candidate.trip.tripId];
  if (!covered || !usual) return null;
  const path = map.shapes[covered[0]], own = map.shapes[usual[0]];
  const ownLine = own.coords.map(toKm);
  const points = densify(path.coords);
  let offKm = 0, totalKm = 0;
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const middle = [(points[i][0] + points[i - 1][0]) / 2, (points[i][1] + points[i - 1][1]) / 2];
    totalKm += step;
    if (distanceToLine(middle, ownLine) > OFF_ROUTE_KM) offKm += step;
  }
  const [ex, ey] = toKm([path.end.lon, path.end.lat]), [ox, oy] = toKm([own.end.lon, own.end.lat]);
  return { path, own, pathRun: covered[1], ownRun: usual[1], offKm, sharedKm: totalKm - offKm, totalKm, endGapKm: Math.hypot(ex - ox, ey - oy) };
}

function typicalRun(routeId) {
  const runs = departures(routeId).map((trip) => state.map.trips[trip.tripId]?.[1]).filter(Number.isFinite).sort((a, b) => a - b);
  return runs.length ? runs[Math.floor(runs.length / 2)] : null;
}

function mapChip(x, y, label, className = "", color = "") {
  return `<g class="map-chip ${className}" transform="translate(${(x - 24).toFixed(1)},${(y - 24).toFixed(1)})"${color ? ` style="--route-line:${color}"` : ""}>
    <rect x="-17" y="-11" width="34" height="22" rx="4" /><text dy="0.35em">${escapeHtml(label)}</text></g>`;
}

/** Point a fraction t of the way along a projected polyline. */
function pointAlong(points, t) {
  const lengths = points.slice(1).map((pt, i) => Math.hypot(pt[0] - points[i][0], pt[1] - points[i][1]));
  let target = lengths.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const f = lengths[i] ? target / lengths[i] : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f];
    }
    target -= lengths[i];
  }
  return points[points.length - 1];
}

/** Frame the map on the routes in play, so they fill the panel. */
function frameFor(shapes) {
  const pts = shapes.flatMap((shape) => shape.coords);
  const box = [Math.min(...pts.map((pt) => pt[0])) - 0.009, Math.min(...pts.map((pt) => pt[1])) - 0.006,
    Math.max(...pts.map((pt) => pt[0])) + 0.026, Math.max(...pts.map((pt) => pt[1])) + 0.006];  // labels extend right
  const k = Math.cos((box[1] + box[3]) / 2 * Math.PI / 180);
  const height = MAP.width * (box[3] - box[1]) / ((box[2] - box[0]) * k) + 2 * MAP.pad;
  return { box, height: Math.round(Math.min(MAP.maxHeight, Math.max(MAP.minHeight, height))) };
}

function bayInset(gap, swap) {
  const bays = new Map();
  for (const info of Object.values(state.data.routes)) for (const trip of info.departures) bays.set(trip.bay, trip);
  const all = [...bays.values()];
  const box = [Math.min(...all.map((b) => b.lon)), Math.min(...all.map((b) => b.lat)), Math.max(...all.map((b) => b.lon)), Math.max(...all.map((b) => b.lat))];
  const p = mapProjector(box, { x: 0, y: 8, width: INSET.width, height: INSET.height - 8, pad: 22 });
  const target = bays.get(gap.first.bay), donor = bays.get(swap.trip.bay);
  const dot = (b) => {
    const [x, y] = p.xy([b.lon, b.lat]);
    const role = b === target ? "is-target" : b === donor ? "is-donor" : "";
    return `<g class="bay ${role}"${role === "is-target" ? ` style="--route-line:${routeColor(state.route)}"` : ""}><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${role ? 7 : 4}" />
      ${role ? `<text x="${(x + (role === "is-donor" ? -10 : 10)).toFixed(1)}" y="${(y - 11).toFixed(1)}" text-anchor="${role === "is-donor" ? "end" : "start"}">${escapeHtml(b.bay)}</text>` : ""}</g>`;
  };
  const [x1, y1] = p.xy([donor.lon, donor.lat]), [x2, y2] = p.xy([target.lon, target.lat]);
  return `<svg class="bay-inset" viewBox="0 0 ${INSET.width} ${INSET.height}" role="img" aria-label="UBC Exchange: the bus moves from ${escapeHtml(donor.bay)} to ${escapeHtml(target.bay)}, ${swap.distance} metres.">
    <line class="bay-link" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" />
    ${all.filter((b) => b !== target && b !== donor).map(dot).join("")}${[donor, target].map(dot).join("")}
    <text class="bay-distance" x="${((x1 + x2) / 2).toFixed(1)}" y="${((y1 + y2) / 2 + 17).toFixed(1)}">${swap.distance} m</text></svg>`;
}

function renderRerouteSummary(gap, swap, reroute) {
  const map = state.map;
  if (!reroute) {
    const selectedTrip = gap ? map.trips[gap.first.tripId] : null;
    const shape = map.shapes[selectedTrip ? selectedTrip[0] : map.mainShape[state.route]];
    const run = selectedTrip ? selectedTrip[1] : typicalRun(state.route);
    const reason = route().serviceType === "nightbus" ? "N17 is shown for schedule and path context. No load-based swap is proposed."
      : route().serviceType === "campus_shuttle" ? "Route 68 is a campus shuttle, so it is not treated as a substitute for a city route."
        : !gap ? "Pick a scheduled departure in step 02."
          : "No nearby bus qualifies for this selected gap. Try another departure to screen a possible reassignment.";
    $("reroute").innerHTML = `<div class="reroute-card is-wide"><span class="reroute-eyebrow">SELECTED ROUTE</span>
      <div class="reroute-pair"><span class="chip" style="--route-color:${routeColor(state.route)}">${escapeHtml(state.route)}</span>
        <span><strong>${escapeHtml(route().name)}</strong><small>UBC → ${escapeHtml(shape.end.name)} · ${shape.lengthKm} km${run ? ` · ~${run} min` : ""}</small></span></div></div>
      <div class="reroute-card"><span class="reroute-eyebrow">PLANNING NOTE</span><p class="reroute-note">${reason}</p></div>`;
    return;
  }
  const target = state.route, donorId = swap.donorId;
  const minutesDiff = reroute.pathRun - reroute.ownRun;
  const offShare = reroute.totalKm ? reroute.offKm / reroute.totalKm * 100 : 0;
  $("reroute").innerHTML = `<div class="reroute-card">
      <span class="reroute-eyebrow">WHICH BUS IS REROUTED</span>
      <div class="reroute-pair"><span class="chip is-donor">${escapeHtml(donorId)}</span>
        <span><strong>${escapeHtml(route(donorId).name)}</strong><small>scheduled ${timeLabel(swap.trip.minute)} from ${escapeHtml(swap.trip.bay)}</small></span></div>
      <div class="reroute-arrow">would instead run ↓</div>
      <div class="reroute-pair"><span class="chip" style="--route-color:${routeColor(target)}">${escapeHtml(target)}</span>
        <span><strong>${escapeHtml(route(target).name)}</strong><small>from ${escapeHtml(gap.first.bay)}</small></span></div>
    </div>
    <div class="reroute-card"><span class="reroute-eyebrow">MOVES BAYS AT UBC EXCHANGE</span>${bayInset(gap, swap)}</div>
    <div class="reroute-card"><dl class="reroute-facts">
      <div><dt>Off its usual path</dt><dd><strong>${reroute.offKm.toFixed(1)} km</strong> of ${reroute.totalKm.toFixed(1)} km
        <span class="reroute-bar" aria-hidden="true"><i style="width:${offShare.toFixed(0)}%"></i></span>
        <small>${reroute.sharedKm < 0.1 ? "No shared street with its usual route" : `${reroute.sharedKm.toFixed(1)} km on streets it normally uses`}</small></dd></div>
      <div><dt>Trip time</dt><dd><strong>~${reroute.pathRun} min</strong> <small class="inline">vs ${reroute.ownRun} min on its own route (${minutesDiff > 0 ? "+" : minutesDiff < 0 ? "−" : "±"}${Math.abs(minutesDiff)})</small></dd></div>
    </dl></div>
    <div class="reroute-card"><dl class="reroute-facts">
      <div><dt>Finishes at</dt><dd><strong>${escapeHtml(reroute.path.end.name)}</strong>
        <small>${reroute.endGapKm.toFixed(1)} km (straight line) from its usual end, ${escapeHtml(reroute.own.end.name)}</small></dd></div>
    </dl>
    <p class="reroute-note">In short: the ${escapeHtml(donorId)} bus leaves its route for ${reroute.offKm.toFixed(1)} km and finishes ${reroute.endGapKm.toFixed(1)} km from where it normally ends. It then needs an empty run back, or a return ${escapeHtml(target)} trip, to rejoin its own schedule.</p></div>`;
}

function renderMap() {
  if (!state.map) return;
  const map = state.map;
  const gap = selectedGap();
  const swap = state.swap;
  const reroute = swap ? rerouteFor(gap, swap) : null;
  const covered = gap && map.trips[gap.first.tripId] ? map.shapes[map.trips[gap.first.tripId][0]] : null;
  const shapeFor = (id) => (id === state.route && covered ? covered : map.shapes[map.mainShape[id]]);
  const frame = frameFor([shapeFor(state.route), ...(reroute ? [reroute.own] : [])]);
  const p = mapProjector(frame.box, { x: 0, y: 0, width: MAP.width, height: frame.height, pad: MAP.pad });

  const network = map.network.map((line) => svgPath(line.map(p.xy))).join("");
  const rail = map.skytrain.map((line) => `<path class="map-rail" d="${svgPath(line.coords.map(p.xy))}" />`).join("");
  const order = [...map.targetRoutes.filter((id) => id !== state.route), state.route];  // selected route drawn last, on top
  const lines = {};
  const routes = order.map((id) => {
    const points = lines[id] = offsetPoints(shapeFor(id).coords.map(p.xy), MAP_OFFSET[id] || 0);
    const d = svgPath(points);
    const [cx, cy] = pointAlong(points, MAP_CHIP_FRACTION[id] || .62);
    const role = id === state.route ? "is-selected" : reroute ? "is-faded" : "";
    return `<g class="map-route ${role}" data-map-route="${escapeHtml(id)}" style="--route-line:${routeColor(id)}">
      <path class="map-casing" d="${d}" /><path class="map-line" d="${d}" /><path class="map-hit" d="${d}"><title>Route ${escapeHtml(id)}: ${escapeHtml(route(id).name)}</title></path>
      ${mapChip(cx + 24, cy + 24, id)}</g>`;
  }).join("");

  let overlay = "", bus = "";
  if (reroute) {
    const own = offsetPoints(reroute.own.coords.map(p.xy), DONOR_OFFSET);
    const ownD = svgPath(own);
    const [ex, ey] = p.xy([reroute.path.end.lon, reroute.path.end.lat]);
    const [ox, oy] = p.xy([reroute.own.end.lon, reroute.own.end.lat]);
    const [dcx, dcy] = pointAlong(own, 0.45);
    const close = Math.hypot(ex - ox, ey - oy) < 90;
    // Keep the "usual end" label on the far side from where the rerouted bus ends.
    const usualLeft = ox < ex;
    overlay = `<path class="map-donor-casing" d="${ownD}" /><path class="map-donor" d="${ownD}" />
      <line class="map-end-gap" x1="${ex.toFixed(1)}" y1="${ey.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" />
      <g class="map-end is-covered" style="--route-line:${routeColor(state.route)}"><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="9" /></g>
      <g class="map-end is-usual"><circle cx="${ox.toFixed(1)}" cy="${oy.toFixed(1)}" r="8" />
        <text x="${(ox + (usualLeft ? -12 : 12)).toFixed(1)}" y="${(oy - 12).toFixed(1)}" text-anchor="${usualLeft ? "end" : "start"}">Usual end: ${escapeHtml(reroute.own.end.name.replace(" Station", ""))}</text></g>
      <text class="map-gap-label" x="${(close ? ex : (ex + ox) / 2).toFixed(1)}" y="${(close ? ey + 30 : (ey + oy) / 2 + 22).toFixed(1)}" text-anchor="middle">${reroute.endGapKm.toFixed(1)} km apart</text>
      ${mapChip(dcx + 24, dcy + 24, swap.donorId, "is-donor")}`;
    const path = lines[state.route];
    const d = svgPath(path);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [mx, my] = pointAlong(path, 0.35);
    bus = `<g class="map-bus"${reduce ? ` transform="translate(${mx.toFixed(1)},${my.toFixed(1)})"` : ""}>
      <circle r="9" /><path d="M-4 -3h8v5h-8z M-3 3.5a1 1 0 1 0 0.01 0 M3 3.5a1 1 0 1 0 0.01 0" />
      ${reduce ? "" : `<animateMotion dur="${Math.max(6, reroute.totalKm * 0.55).toFixed(1)}s" repeatCount="indefinite" path="${d}" />`}</g>`;
  }

  const stations = map.stations.filter((s) => MAP_LABELS[s.name]).map((s) => {
    const [x, y] = p.xy([s.lon, s.lat]);
    const [dx, dy, anchor, minor] = MAP_LABELS[s.name];
    return `<g class="map-station${minor ? " is-minor" : ""}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${minor ? 4.5 : 6}" />
      <text x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(s.name.replace(" Avenue", ""))}</text></g>`;
  }).join("");
  const [ux, uy] = p.xy(map.ubc);
  const bar = 2 * p.pxPerKm;
  const label = reroute
    ? `Map: the ${swap.donorId} bus from ${swap.trip.bay} would run route ${state.route} to ${reroute.path.end.name} instead of its usual trip to ${reroute.own.end.name}; ${reroute.offKm.toFixed(1)} km off its usual path, ending ${reroute.endGapKm.toFixed(1)} km from its usual end.`
    : `Map of routes ${map.targetRoutes.join(", ")} leaving UBC Exchange: ${map.targetRoutes.map((id) => `${id} to ${shapeFor(id).end.name}`).join("; ")}.`;
  $("route-map").innerHTML = `<svg id="map-svg" viewBox="0 0 ${MAP.width} ${frame.height}" role="img" aria-label="${escapeHtml(label)}">
    <path class="map-network" d="${network}" />${rail}${routes}${overlay}${stations}
    <g class="map-ubc"><circle cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="10" /><circle class="map-ubc-core" cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="3.5" />
      <text x="${(ux - 6).toFixed(1)}" y="${(uy + 30).toFixed(1)}">UBC Exchange</text></g>${bus}
    <g class="map-scale" transform="translate(28,${frame.height - 22})"><path d="M0 -5V5M0 0H${bar.toFixed(1)}M${bar.toFixed(1)} -5V5" /><text x="${(bar + 8).toFixed(1)}" dy="0.35em">2 km</text></g>
    <g class="map-north" transform="translate(${MAP.width - 30},32)"><path d="M0 -13L6 4L0 0L-6 4Z" /><text y="18" text-anchor="middle">N</text></g>
  </svg>`;
  $("map-legend-routes").innerHTML = map.targetRoutes.map((id) => `<span><i class="key-line" style="background:${routeColor(id)}"></i>${escapeHtml(id)}</span>`).join("");
  renderRerouteSummary(gap, swap, reroute);
  const special = route().serviceType !== "regular";
  $("map-step").textContent = special ? "SEE THE ROUTE" : "SEE THE REROUTE";
  $("map-title").textContent = special ? `Where does the ${state.route} go?` : "Where would the nearby bus go?";
  $("map-subtitle").textContent = reroute
    ? `The orange bus normally runs the ${swap.donorId} (dashed orange). To cover the ${state.route} gap at ${timeLabel(swap.trip.minute)}, it would follow the ${state.route} line instead.`
    : special ? `Published route geometry for ${state.route} from UBC Exchange. No reassignment scenario is shown for this service.`
      : `Select one of the ${map.targetRoutes.length} routes to inspect its path. When step 03 finds a nearby trip, the map shows how far that bus would leave its usual route.`;
}

function render() {
  renderRoutes();
  renderPeriods();
  renderSchedule();
  renderCandidates();
}

async function boot() {
  try {
    // The map is optional: the planner still works if route_map.json is missing.
    const mapRequest = fetch("app/route_map.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const response = await fetch("app/data.json");
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = await response.json();
    if (!state.data.routes?.[state.route]) throw new Error("The route data is missing.");
    state.map = await mapRequest;
    if (state.map) {
      $("map-panel").hidden = false;
      $("route-map").addEventListener("click", (event) => {
        const line = event.target.closest("[data-map-route]");
        if (line && line.dataset.mapRoute !== state.route) selectRoute(line.dataset.mapRoute);
      });
    }
    const initial = selectDefaultTrip(state.route, state.block);
    state.hour = initial.hour;
    state.tripId = initial.tripId;
    $("app-content").hidden = false;
    render();
  } catch (error) {
    $("app-error").hidden = false;
    $("app-error").textContent = `The planner could not load its data. Serve this folder with a local web server, then reload. ${error.message}`;
  }
}

boot();
