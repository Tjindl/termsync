const state = {
  data: null,
  route: "99",
  block: 15,
  hour: 17 * 60,
  tripId: null,
  candidateId: null,
};

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
  if (!gap) return [];
  const result = [];
  const before = gap.next.minute - gap.first.minute;
  for (const [donorId, donor] of Object.entries(state.data.routes)) {
    if (donorId === targetId) continue;
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
    .filter(({ trip, index }) => index < trips.length - 1 && trip.minute >= preferredHour && trip.minute < preferredHour + 60);
  if (!pool.length) {
    pool = trips.map((trip, index) => ({ trip, index }))
      .filter(({ trip, index }) => index < trips.length - 1 && trip.minute >= period.start && trip.minute < period.end);
  }
  if (!pool.length) return { tripId: null, hour: preferredHour };
  pool.sort((a, b) => (trips[b.index + 1].minute - b.trip.minute) - (trips[a.index + 1].minute - a.trip.minute));
  return { tripId: pool[0].trip.tripId, hour: Math.floor(pool[0].trip.minute / 60) * 60 };
}

function selectRoute(routeId) {
  state.route = routeId;
  const available = state.data.timeBlocks.filter((item) => measure(routeId, item.code));
  state.block = available.reduce((best, item) => measure(routeId, item.code).peakOnboard > measure(routeId, best.code).peakOnboard ? item : best).code;
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
      .filter(({ trip, index }) => index < trips.length - 1 && trip.minute >= hour && trip.minute < hour + 60)
      .sort((a, b) => (trips[b.index + 1].minute - b.trip.minute) - (trips[a.index + 1].minute - a.trip.minute));
    state.tripId = inHour[0]?.trip.tripId || null;
  }
  state.candidateId = null;
  render();
}

function renderRoutes() {
  $("route-nav").innerHTML = state.data.targetRoutes.map((id) => {
    const info = route(id);
    const peak = Math.max(...Object.values(info.blocks).map((value) => value.loadPercent));
    return `<button class="route-button" type="button" data-route="${escapeHtml(id)}" aria-pressed="${id === state.route}">
      <span class="route-number">${escapeHtml(id)}</span>
      <span class="route-info"><strong>${escapeHtml(info.name)}</strong><small>Peak block ${Math.round(peak)}% load</small></span>
      <span class="route-arrow" aria-hidden="true">↗</span></button>`;
  }).join("");
  $("route-nav").querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => selectRoute(button.dataset.route)));
}

function renderPeriods() {
  const values = state.data.timeBlocks.filter((item) => measure(state.route, item.code))
    .map((item) => ({ block: item, ...measure(state.route, item.code) }))
    .sort((a, b) => b.peakOnboard - a.peakOnboard);
  const max = Math.max(...values.map((item) => item.peakOnboard));
  $("period-list").innerHTML = values.map((item) => {
    const status = pressureStatus(item.loadPercent);
    return `<button class="period-row ${status.high ? "is-high" : ""}" type="button" data-block="${item.block.code}" aria-pressed="${item.block.code === state.block}">
      <span class="period-time">${item.block.label}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.max(3, item.peakOnboard / max * 100)}%"></span></span>
      <span class="period-value">${Math.round(item.peakOnboard)} ppl</span>
      <span class="period-state">${status.short}</span>
    </button>`;
  }).join("");
  $("period-list").querySelectorAll("[data-block]").forEach((button) => button.addEventListener("click", () => selectBlock(Number(button.dataset.block))));
}

function renderSchedule() {
  const info = measure();
  const status = pressureStatus(info.loadPercent);
  $("schedule-subtitle").textContent = `${route().name} · from UBC Exchange · ${block().label}`;
  $("pressure-callout").className = `pressure-callout ${status.high ? "is-high" : ""}`;
  $("pressure-callout").innerHTML = `<strong>${status.label} in this time block</strong><span>${Math.round(info.loadPercent)}% avg peak load</span><p>Historical route average; this does not predict the load on any bus below.</p>`;
  const hours = [];
  for (let hour = block().start; hour < block().end; hour += 60) hours.push(hour);
  $("hour-tabs").innerHTML = hours.map((hour) => `<button class="hour-tab" type="button" role="tab" data-hour="${hour}" aria-selected="${hour === state.hour}">${hourLabel(hour)}</button>`).join("");
  $("hour-tabs").querySelectorAll("[data-hour]").forEach((button) => button.addEventListener("click", () => selectHour(Number(button.dataset.hour))));
  const trips = departures().filter((trip) => trip.minute >= state.hour && trip.minute < state.hour + 60);
  $("departure-list").innerHTML = trips.length ? trips.map((trip) => `<button class="departure" type="button" data-trip="${escapeHtml(trip.tripId)}" aria-pressed="${trip.tripId === state.tripId}" aria-label="Scheduled departure ${timeLabel(trip.minute)}, ${escapeHtml(trip.bay)}">${timeLabel(trip.minute)}</button>`).join("")
    : `<p class="empty-departures">No scheduled departures in this hour.</p>`;
  $("departure-list").querySelectorAll("[data-trip]").forEach((button) => button.addEventListener("click", () => { state.tripId = button.dataset.trip; state.candidateId = null; renderSchedule(); renderCandidates(); }));
  const gap = selectedGap();
  $("gap-summary").innerHTML = gap ? `<div><span class="gap-label">Selected scheduled gap</span><strong>${timeLabel(gap.first.minute)} → ${timeLabel(gap.next.minute)}</strong></div><div class="gap-number">${gap.next.minute - gap.first.minute}<small>min</small></div>`
    : `<div><span class="gap-label">Select a departure</span><strong>See its next scheduled bus</strong></div>`;
}

function renderCandidates() {
  const gap = selectedGap();
  const candidates = candidatesForGap(gap);
  $("candidate-count").textContent = `${candidates.length} ${candidates.length === 1 ? "OPTION" : "OPTIONS"}`;
  if (!candidates.length) {
    state.candidateId = null;
    const lowerLoadRoutes = Object.entries(state.data.routes).filter(([id, info]) => id !== state.route && info.blocks[String(state.block)]?.loadPercent < 60).length;
    const explanation = !gap ? "Choose a scheduled departure above to inspect its following gap."
      : lowerLoadRoutes === 0 ? "Every other route with a comparable historical load at UBC Exchange is at or above the 60% cutoff in this block. Moving service would be hard to justify from these data."
        : "Lower-load routes exist, but no scheduled trip from a bay within 250 m falls inside this exact gap. Try another departure.";
    const another = bestCandidateGap(state.route, state.block);
    const later = state.block !== 18 && measure(state.route, 18) ? bestCandidateGap(state.route, 18) : null;
    const action = another ? `<button class="try-button" type="button" id="try-option">Find a possible swap →</button>`
      : later ? `<button class="try-button" type="button" id="try-later">Try 18–21 →</button>` : "";
    $("candidates-content").innerHTML = `<div class="no-candidates"><span class="no-candidates-icon" aria-hidden="true">∅</span><div><strong>No suitable nearby trip for this gap</strong><p>${explanation}</p></div>${action}</div>`;
    $("try-option")?.addEventListener("click", () => { state.hour = another.hour; state.tripId = another.tripId; render(); });
    $("try-later")?.addEventListener("click", () => selectBlock(18));
    return;
  }
  if (!candidates.some((candidate) => candidate.id === state.candidateId)) state.candidateId = candidates[0].id;
  const selected = candidates.find((candidate) => candidate.id === state.candidateId);
  const favorable = selected.benefit >= selected.donorPenalty;
  $("candidates-content").innerHTML = `<div class="candidate-grid">${candidates.map((candidate) => `<button class="candidate" type="button" data-candidate="${escapeHtml(candidate.id)}" aria-pressed="${candidate.id === state.candidateId}">
    <span class="candidate-top"><span class="candidate-route">${escapeHtml(candidate.donorId)}</span><span><span class="candidate-name">${escapeHtml(route(candidate.donorId).name)}</span><span class="candidate-time">${timeLabel(candidate.trip.minute)} · ${escapeHtml(candidate.trip.bay)}</span></span></span>
    <span class="candidate-divider"></span><span class="candidate-facts"><span>${Math.round(candidate.historical.loadPercent)}% historical load</span><span>${candidate.distance} m away</span></span>
  </button>`).join("")}</div>
  <div class="swap-detail" aria-live="polite">
    <div><span class="metric-label">TARGET GAP IF MOVED</span><strong>${selected.targetBefore} → <span>${selected.targetAfter} min</span></strong></div>
    <div class="penalty"><span class="metric-label">DONOR GAP IF REMOVED</span><strong>${selected.donorBefore} → <span>${selected.donorAfter} min</span></strong></div>
    <p><span class="swap-verdict ${favorable ? "is-favorable" : ""}">${favorable ? "Worth an operations check" : "Poor schedule tradeoff"}</span><br />${favorable ? "The target gap shrinks at least as much as the donor gap grows." : "The donor gap grows more than the target gap shrinks."} This is a timetable scenario, not an available bus. Check actual loads, vehicle type, driver block and recovery time.</p>
  </div>`;
  $("candidates-content").querySelectorAll("[data-candidate]").forEach((button) => button.addEventListener("click", () => { state.candidateId = button.dataset.candidate; renderCandidates(); }));
}

function render() {
  renderRoutes();
  renderPeriods();
  renderSchedule();
  renderCandidates();
}

async function boot() {
  try {
    const response = await fetch("app/data.json");
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = await response.json();
    if (!state.data.routes?.[state.route]) throw new Error("The route data is missing.");
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
