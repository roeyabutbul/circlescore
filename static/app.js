// ---- State ----
let people = [];
let scores = {};
let selectedIds = new Set();
let currentTab = "predict";
let scoringPersonId = null;

// ---- Bubble animation ----
let bubbleState = [];   // { id, home: {x,y} }
let animFrameId = null;
const BUBBLE_R = 58;
const FLOAT_VARIANTS = 6;

function computeAllHomes(count, W, H) {
  if (count === 0) return [];

  const cx = W / 2, cy = H / 2;
  const CENTER_R = 62;
  const AVATAR_R = 44;
  const EDGE_PAD = AVATAR_R + 14;

  // --- Middle section: 2 spots on each side of center circle ---
  const gap = 22;
  const near = CENTER_R + AVATAR_R + gap;
  const far  = near + AVATAR_R * 2 + gap;
  const middleSlots = [
    { x: cx - far,  y: cy },
    { x: cx - near, y: cy },
    { x: cx + near, y: cy },
    { x: cx + far,  y: cy },
  ];

  const positions = [];

  // Fill middle slots first (up to 4)
  const middleCount = Math.min(count, 4);
  for (let i = 0; i < middleCount; i++) positions.push(middleSlots[i]);

  const remaining = count - middleCount;
  if (remaining === 0) return positions;

  // --- Top and bottom sections ---
  const sectionH = H / 3;
  const topY    = { min: EDGE_PAD,              max: sectionH - AVATAR_R };
  const bottomY = { min: H - sectionH + AVATAR_R, max: H - EDGE_PAD };

  const topCount    = Math.ceil(remaining / 2);
  const bottomCount = remaining - topCount;

  function gridPositions(n, yMin, yMax) {
    if (n === 0) return [];
    const pts = [];
    const cellW = (W - EDGE_PAD * 2) / n;
    const y = (yMin + yMax) / 2;
    for (let i = 0; i < n; i++) {
      pts.push({ x: EDGE_PAD + (i + 0.5) * cellW, y });
    }
    return pts;
  }

  return [
    ...positions,
    ...gridPositions(topCount, topY.min, topY.max),
    ...gridPositions(bottomCount, bottomY.min, bottomY.max),
  ];
}

function startBubbleArena() {
  const arena = document.getElementById("bubble-arena");
  if (!arena) return;
  const W = arena.offsetWidth, H = arena.offsetHeight;
  if (W === 0 || H === 0) { requestAnimationFrame(startBubbleArena); return; }

  // Drop state for removed people
  bubbleState = bubbleState.filter(b => people.find(p => p.id === b.id));

  // Recompute all homes so every bubble fits in the frame
  const homes = computeAllHomes(people.length, W, H);

  people.forEach((p, i) => {
    const home = homes[i];
    if (!home) return;

    let state = bubbleState.find(b => b.id === p.id);
    if (!state) { state = { id: p.id, home }; bubbleState.push(state); }
    else state.home = home;

    const el = document.getElementById(`bubble-${p.id}`);
    if (el) {
      el.style.left = (home.x - BUBBLE_R) + "px";
      el.style.top  = (home.y - BUBBLE_R) + "px";
      if (!el.dataset.animated) {
        const v = Math.floor(Math.random() * FLOAT_VARIANTS);
        const dur = (10 + Math.random() * 7).toFixed(1);
        const delay = (-Math.random() * 10).toFixed(1);
        el.style.animation = `bubble-float-${v} ${dur}s ${delay}s ease-in-out infinite`;
        el.dataset.animated = "1";
      }
    }
  });

  if (animFrameId) cancelAnimationFrame(animFrameId);
  animFrameId = requestAnimationFrame(tickLines);
}

function stopBubbleArena() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
}

// Only updates SVG lines — no physics
function tickLines() {
  updateLines();
  animFrameId = requestAnimationFrame(tickLines);
}

function updateLines() {
  const svg = document.getElementById("arena-lines");
  const arena = document.getElementById("bubble-arena");
  if (!svg || !arena) return;

  if (selectedIds.size === 0) { svg.innerHTML = ""; return; }

  const arenaRect = arena.getBoundingClientRect();
  const cx = arena.offsetWidth / 2;
  const cy = arena.offsetHeight / 2;

  let markup = "";
  selectedIds.forEach(id => {
    const el = document.getElementById(`bubble-${id}`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const bx = r.left - arenaRect.left + r.width / 2;
    const by = r.top  - arenaRect.top  + r.height / 2 - 10;
    markup += `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${cx}" y2="${cy}"
      stroke="rgba(124,106,247,0.55)" stroke-width="1.5" stroke-dasharray="5,4"/>`;
  });
  svg.innerHTML = markup;
}

// ---- Init ----
async function init() {
  await Promise.all([loadPeople(), loadScores()]);
  renderAll();
}

async function loadPeople() {
  const res = await fetch("/api/people");
  people = await res.json();
}

async function loadScores() {
  const res = await fetch("/api/scores");
  scores = await res.json();
}

function renderAll() {
  renderPredictPanel();
  renderFriendsPanel();
  renderScoresPanel();
}

// ---- Tabs ----
function switchTab(tab) {
  if (currentTab === "predict" && tab !== "predict") stopBubbleArena();
  currentTab = tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");
  document.getElementById(`panel-${tab}`).classList.add("active");

  if (tab === "scores") renderScoresPanel();
  if (tab === "predict") renderPredictPanel();
  if (tab === "friends") renderFriendsPanel();
}

// ---- Predict Panel ----
function renderPredictPanel() {
  const arena = document.getElementById("bubble-arena");
  if (!arena) return;

  if (people.length === 0) {
    stopBubbleArena();
    arena.querySelectorAll(".person-bubble").forEach(el => el.remove());
    bubbleState = [];
    document.getElementById("selected-summary").textContent = "";
    updateScoreDisplay(null, [], []);
    return;
  }

  // Add bubbles for new people
  const rendered = new Set([...arena.querySelectorAll(".person-bubble")].map(el => el.dataset.pid));
  people.forEach(p => {
    if (!rendered.has(p.id)) {
      const el = document.createElement("div");
      el.className = "person-bubble" + (selectedIds.has(p.id) ? " selected" : "");
      el.id = `bubble-${p.id}`;
      el.dataset.pid = p.id;
      el.onclick = () => toggleSelect(p.id);
      el.innerHTML = p.photo
        ? `<img src="${p.photo}" class="bubble-avatar bubble-avatar-img" /><span class="bubble-name">${p.name}</span>`
        : `<div class="bubble-avatar">${initials(p.name)}</div><span class="bubble-name">${p.name}</span>`;
      el.style.left = "-300px"; // offscreen until startBubbleArena positions it
      el.style.top  = "-300px";
      arena.appendChild(el);
    }
  });

  // Remove bubbles for deleted people
  rendered.forEach(pid => {
    if (!people.find(p => p.id === pid)) {
      document.getElementById(`bubble-${pid}`)?.remove();
      bubbleState = bubbleState.filter(b => b.id !== pid);
    }
  });

  updateSelectSummary();
  startBubbleArena();
  if (selectedIds.size >= 2) runPredict();
  else updateScoreDisplay(null, [], []);
}

function toggleSelect(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  document.getElementById(`bubble-${id}`)?.classList.toggle("selected", selectedIds.has(id));
  updateSelectSummary();
  if (selectedIds.size >= 2) runPredict();
  else updateScoreDisplay(null, [], []);
}

function resetSelection() {
  selectedIds.forEach(id => {
    document.getElementById(`bubble-${id}`)?.classList.remove("selected");
  });
  selectedIds.clear();
  updateSelectSummary();
  updateScoreDisplay(null, [], []);
}

function updateSelectSummary() {
  const summary = document.getElementById("selected-summary");
  if (!summary) return;
  const count = selectedIds.size;
  if (count === 0) summary.textContent = "Tap people to predict a group score";
  else if (count === 1) summary.textContent = "Select at least one more person";
  else summary.textContent = `${count} people selected · ${count * (count - 1) / 2} pairs`;
}

async function runPredict() {
  const res = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_ids: [...selectedIds] })
  });
  const data = await res.json();
  updateScoreDisplay(data.score, data.pairs, data.missing_pairs, data.override);
}

function updateScoreDisplay(score, pairs, missing, override) {
  const numEl = document.getElementById("score-number");
  const labelEl = document.getElementById("score-label");
  const breakdownEl = document.getElementById("score-breakdown");

  const centerEl = document.getElementById("arena-center");
  if (score === null) {
    numEl.textContent = "—";
    numEl.className = "score-number empty";
    labelEl.textContent = "";
    breakdownEl.innerHTML = "";
    if (centerEl) centerEl.className = "arena-center";
    return;
  }

  numEl.textContent = score.toFixed(1);
  numEl.className = "score-number " + scoreClass(score);
  if (centerEl) centerEl.className = "arena-center score-" + scoreClass(score);
  labelEl.textContent = override === "guy_itay_rule"
    ? "Guy and Itay together? Not happening."
    : override === "all_in_rule"
    ? "The whole crew — it's going to be legendary!"
    : scoreLabel(score);

  // Breakdown chips
  const chips = pairs.map(pair => {
    const names = pairNames(pair.key);
    return `<span class="breakdown-chip">${names}: ${pair.score.toFixed(1)}</span>`;
  });
  const missingChips = missing.map(key => {
    const names = pairNames(key);
    return `<span class="breakdown-chip missing">${names}: unset (5.0)</span>`;
  });

  breakdownEl.innerHTML = chips.concat(missingChips).join("");
}

// ---- Log Meeting ----
async function logMeeting() {
  const rating = parseFloat(document.getElementById("meeting-rating").value);
  if (selectedIds.size < 2) { toast("Select at least 2 people first"); return; }

  const res = await fetch("/api/meeting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ participant_ids: [...selectedIds], rating })
  });

  if (res.ok) {
    await loadScores();
    renderScoresPanel();
    runPredict();
    toast("Meeting logged! Scores updated.");
  }
}

function updateRatingDisplay(val) {
  document.getElementById("rating-display").textContent = val;
}

// ---- Friends Panel ----
function renderFriendsPanel() {
  const list = document.getElementById("friends-list");
  if (people.length === 0) {
    list.innerHTML = '<p class="empty">No friends added yet.</p>';
    return;
  }
  list.innerHTML = people.map(p => `
    <div class="friend-row" id="frow-${p.id}">
      <label class="avatar-upload" title="Change photo">
        ${p.photo
          ? `<img src="${p.photo}" class="avatar avatar-img" />`
          : `<div class="avatar">${initials(p.name)}</div>`}
        <input type="file" accept="image/*" style="display:none"
          onchange="uploadPhoto('${p.id}', this)" />
      </label>
      <span class="friend-name-text" id="fname-${p.id}">${p.name}</span>
      <div class="friend-actions">
        <button class="edit-btn" onclick="startEditName('${p.id}')" title="Edit name">✎</button>
        <button class="delete-btn" onclick="deletePerson('${p.id}')" title="Remove">✕</button>
      </div>
    </div>
  `).join("");
}

function startEditName(id) {
  const span = document.getElementById(`fname-${id}`);
  const current = span.textContent.trim();

  const input = document.createElement("input");
  input.className = "edit-name-input";
  input.id = `finput-${id}`;
  input.value = current;

  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); saveEditName(id, input.value); }
    if (e.key === "Escape") renderFriendsPanel();
  });

  span.replaceWith(input);
  input.focus();
  input.select();
}

async function saveEditName(id, nameValue) {
  const name = (nameValue ?? document.getElementById(`finput-${id}`)?.value ?? "").trim();
  if (!name) { renderFriendsPanel(); return; }

  const res = await fetch(`/api/people/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  if (res.ok) {
    await loadPeople();
    renderAll();
    toast(`Renamed to ${name}`);
  }
}

async function uploadPhoto(id, input) {
  const file = input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`/api/people/${id}/photo`, { method: "POST", body: form });
  if (res.ok) {
    await loadPeople();
    renderAll();
    toast("Photo updated!");
  }
}

async function addPerson() {
  const input = document.getElementById("new-name");
  const name = input.value.trim();
  if (!name) return;

  const res = await fetch("/api/people", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  if (res.ok) {
    input.value = "";
    await loadPeople();
    renderAll();
    toast(`${name} added!`);
  }
}

async function deletePerson(id) {
  const person = people.find(p => p.id === id);
  if (!confirm(`Remove ${person?.name}? This will also delete their pair scores.`)) return;

  await fetch(`/api/people/${id}`, { method: "DELETE" });
  selectedIds.delete(id);
  await Promise.all([loadPeople(), loadScores()]);
  renderAll();
  toast("Removed.");
}

// ---- Scores Panel ----
function renderScoresPanel() {
  const container = document.getElementById("pairs-container");

  if (people.length < 2) {
    container.innerHTML = '<p class="empty">Add at least 2 friends to set pair scores.</p>';
    return;
  }

  if (scoringPersonId && !people.find(p => p.id === scoringPersonId)) {
    scoringPersonId = null;
  }

  const personButtons = people.map(p => `
    <button class="score-person-btn ${p.id === scoringPersonId ? 'active' : ''}"
      onclick="selectScoringPerson('${p.id}')">
      ${p.photo
        ? `<img src="${p.photo}" class="score-avatar avatar-img" />`
        : `<div class="score-avatar avatar">${initials(p.name)}</div>`}
      <span class="score-person-name">${p.name}</span>
    </button>
  `).join("");

  let pairsHtml = "";
  if (scoringPersonId) {
    const others = people.filter(p => p.id !== scoringPersonId);
    const selected = people.find(p => p.id === scoringPersonId);

    const rows = others.map(other => {
      const key = pairKey(scoringPersonId, other.id);
      const val = scores[key] != null ? Math.round(scores[key]) : null;

      const numBtns = [1,2,3,4,5,6,7,8,9,10].map(n => `
        <button class="score-num-btn ${val === n ? 'active' : ''} score-num-${n}"
          onclick="savePairScore('${scoringPersonId}','${other.id}','${key}',${n})">
          ${n}
        </button>
      `).join("");

      return `
        <div class="pair-target-row">
          <div class="pair-target-identity">
            ${other.photo
              ? `<img src="${other.photo}" class="score-avatar avatar-img" />`
              : `<div class="score-avatar avatar">${initials(other.name)}</div>`}
            <span class="pair-target-name">${other.name}</span>
          </div>
          <div class="score-num-btns" id="nums-${key}">${numBtns}</div>
        </div>
      `;
    }).join("");

    pairsHtml = `
      <div class="pairs-for-person">
        <div class="section-title" style="margin-top:20px; margin-bottom:14px">
          ${selected.name}'s connections
        </div>
        ${rows}
      </div>
    `;
  } else {
    pairsHtml = `<p class="empty" style="padding:24px 0 0">Pick a person above to rate their connections</p>`;
  }

  container.innerHTML = `
    <div class="score-person-list">${personButtons}</div>
    ${pairsHtml}
  `;
}

function selectScoringPerson(id) {
  scoringPersonId = scoringPersonId === id ? null : id;
  renderScoresPanel();
}

async function savePairScore(aId, bId, key, score) {
  const res = await fetch("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ person_a: aId, person_b: bId, score })
  });

  if (res.ok) {
    scores[key] = score;
    const container = document.getElementById(`nums-${key}`);
    if (container) {
      container.querySelectorAll(".score-num-btn").forEach((btn, i) => {
        const n = i + 1;
        btn.className = `score-num-btn ${n === score ? 'active' : ''} score-num-${n}`;
      });
    }
    if (selectedIds.size >= 2) runPredict();
  }
}

// ---- Helpers ----
function pairKey(a, b) {
  return [a, b].sort().join("__");
}

function pairNames(key) {
  const [aId, bId] = key.split("__");
  const a = people.find(p => p.id === aId)?.name ?? "?";
  const b = people.find(p => p.id === bId)?.name ?? "?";
  return `${a} & ${b}`;
}

function initials(name) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function scoreClass(s) {
  if (s >= 7) return "high";
  if (s >= 4.5) return "mid";
  return "low";
}

function scoreLabel(s) {
  if (s >= 8.5) return "This group is going to have a great time";
  if (s >= 7) return "Should be a good meeting";
  if (s >= 5.5) return "Decent, but some friction possible";
  if (s >= 4) return "Mixed bag — could go either way";
  return "This group might be tough";
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2500);
}

// Enter key on add friend input
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("new-name").addEventListener("keydown", e => {
    if (e.key === "Enter") addPerson();
  });
  init();
});
