/* Catalog audit review page (same design and keyboard model as the add-songs
 * review page, tools/song-curation/review.html).
 *
 * Loads items.json (cards) and decisions.json from server.py, shows one card at
 * a time, and saves every change back to the server, which writes
 * decisions.json in the audit's batch folder. localStorage only queues clicks
 * the server hasn't confirmed yet (retried every 5 s and on reload).
 *
 * Decision format (read by make_sql.py / validate.py):
 *   {status: "approved"|"rejected"|"pending", fields: {...}, keep: <song id>|null, note}
 *   fields = the card's FULL final state relative to the (kept) song: every
 *   value that differs from the catalog, edits and chosen video included.
 */
"use strict";

// items.json carries the live genre slugs; this list is only the fallback
let GENRES = ["rock", "pop", "hip-hop", "electronic", "soundtracks", "israeli-pop",
  "israeli-cover", "israeli-rock-pop", "israeli-rap-hip-hop", "mizrahit", "israeli-soundtracks"];
const KINDS = {
  broken: "Broken video",
  duplicate: "Duplicate",
  video: "Better video",
  name: "Title / artist",
  metadata: "Genre / year",
  maybe_dup: "Possible duplicate",
  style: "Style",
};
const SEV = { 3: "must fix", 2: "should fix", 1: "nice to have" };
const STATUS_FILTERS = [["pending", "To review"], ["approved", "Approved"], ["rejected", "Rejected"], ["all", "All"]];

let ITEMS = [];
let DEC = {};
let BATCH = "";
let PENDING_KEY = "catalog-audit-pending:v1";
const F = { status: "pending", kind: "all", q: "", must: false };
let VIEW = [];
let curId = null;
const decidedStack = []; // ids decided in this session, for U on an undecided card
const players = {}; // key -> YT.Player
let activeKey = null;
let ytReady = false;
window.onYouTubeIframeAPIReady = () => { ytReady = true; };

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
function human(n) {
  if (n == null) return "?";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
}
const mmss = (s) => (s == null || !Number.isFinite(Number(s)) ? "?" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
function parseTime(v) {
  const t = String(v ?? "").trim();
  if (!t) return 0;
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d+$/.test(t) ? Number(t) : null;
}
const thumb = (vid) => `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/mqdefault.jpg`;
const ytUrl = (vid, t) => `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}${t ? `&t=${Math.floor(t)}s` : ""}`;
const statusOf = (id) => (DEC[id] && DEC[id].status) || "pending";
const sameVal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sortedGenres = (g) => [...(g || [])].sort();
const isDup = (it) => it.kind === "duplicate" || it.kind === "maybe_dup";
const cur = () => ITEMS.find((i) => i.id === curId) || null;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } },
};
function toast(msg, kind = "", ms = 2200) {
  const box = $("#toasts");
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = msg;
  box.appendChild(t);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}

/* ---------- data ---------- */
async function load() {
  const [items, dec] = await Promise.all([
    fetch("/api/items").then((r) => r.json()),
    fetch("/api/decisions").then((r) => r.json()),
  ]);
  ITEMS = items.items || [];
  if (Array.isArray(items.genres) && items.genres.length) GENRES = items.genres;
  BATCH = items.batch || "";
  // one queue per audit: item ids repeat across audits ("style-3408cf1d")
  if (BATCH) PENDING_KEY = `catalog-audit-pending:${BATCH}`;
  DEC = dec || {};
  // replay anything that never reached the server (e.g. it was down)
  for (const [id, decision] of Object.entries(readPending())) {
    if (decision === null) delete DEC[id]; else DEC[id] = decision;
  }
  if (Object.keys(readPending()).length) trySync(); else setPill("ok", "Saved");
  ITEMS.sort((a, b) => (b.severity || 0) - (a.severity || 0) || (maxPlays(b) - maxPlays(a)));
  $("#batch-name").textContent = `${BATCH || "audit"} · ${ITEMS.length} cards`;
  const remembered = store.get(`catalog-audit-cur:${BATCH}`);
  rebuild();
  curId = VIEW.some((i) => i.id === remembered) ? remembered : (VIEW[0] || {}).id || null;
  renderAll();
}
const maxPlays = (it) => Math.max(0, ...(it.songs || []).map((s) => s.plays || 0));

/* Every decision is first written to a browser-side queue (localStorage), then
 * sent to the server. If the server is down the queue keeps it, retries every
 * 5 s, and is replayed on the next page load, so a click is never lost. */
function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}"); } catch (_) { return {}; }
}
function writePending(p) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (_) { /* storage blocked */ }
}
async function postDecision(id, decision) {
  const r = await fetch("/api/decisions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: id, decision }),
  });
  if (!r.ok) throw new Error(r.status);
}
async function flushPending() {
  for (const [id, decision] of Object.entries(readPending())) {
    await postDecision(id, decision);
    const q = readPending();
    if (JSON.stringify(q[id]) === JSON.stringify(decision)) { delete q[id]; writePending(q); }
  }
}
function setPill(kind, text) {
  const p = $("#save-pill");
  p.className = `save-pill ${kind}`;
  p.textContent = text;
}
let retryTimer = null;
async function trySync() {
  try {
    await flushPending();
    clearTimeout(retryTimer);
    setPill("ok", "Saved");
  } catch (e) {
    const n = Object.keys(readPending()).length;
    setPill("error", `Server not reachable — ${n} decision(s) kept in this browser, retrying…`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(trySync, 5000);
  }
}
async function saveDecision(id, decision) {
  if (decision === null) delete DEC[id]; else DEC[id] = decision;
  const p = readPending();
  p[id] = decision;
  writePending(p);
  setPill("saving", "Saving…");
  await trySync();
}

/* ---------- filtering ---------- */
function inKind(it) {
  return F.kind === "all" ? it.kind !== "style" : it.kind === F.kind;
}
function matchesBase(it) {
  if (F.must && (it.severity || 0) < 3) return false;
  if (F.q) {
    const hay = [it.summary, ...(it.evidence || []), ...(it.songs || []).flatMap((s) => [s.title, s.artist]),
      JSON.stringify(it.proposal || {}), (DEC[it.id] && DEC[it.id].note) || ""].join(" ").toLowerCase();
    if (!hay.includes(F.q)) return false;
  }
  return inKind(it);
}
function rebuild() {
  VIEW = ITEMS.filter((it) => matchesBase(it) && (F.status === "all" || statusOf(it.id) === F.status));
}

/* ---------- top bar + queue ---------- */
function renderProgress() {
  const a = ITEMS.filter((i) => statusOf(i.id) === "approved").length;
  const r = ITEMS.filter((i) => statusOf(i.id) === "rejected").length;
  const n = ITEMS.length || 1;
  $("#pb-ok").style.width = `${(100 * a) / n}%`;
  $("#pb-bad").style.width = `${(100 * r) / n}%`;
  $("#progress-text").innerHTML = `<b>${a + r}</b>/${ITEMS.length} reviewed · <span class="ok">${a} ✓</span> · <span class="bad">${r} ✕</span> · ${ITEMS.length - a - r} left`;
}
function renderFilters() {
  const base = ITEMS.filter(matchesBase);
  const count = (st) => (st === "all" ? base.length : base.filter((i) => statusOf(i.id) === st).length);
  const mustN = ITEMS.filter((i) => inKind(i) && (i.severity || 0) >= 3 && statusOf(i.id) === "pending").length;
  $("#filters").innerHTML = STATUS_FILTERS.map(([k, label]) =>
    `<button type="button" data-status="${k}" class="${F.status === k ? "active" : ""}">${label} <b>${count(k)}</b></button>`).join("") +
    `<button type="button" data-must="1" class="must ${F.must ? "active" : ""}" title="Only the must-fix cards">Must-fix <b>${mustN}</b></button>`;
  const opt = (k, label, list) => {
    const pend = list.filter((i) => statusOf(i.id) === "pending").length;
    return `<option value="${k}" ${F.kind === k ? "selected" : ""}>${esc(label)} (${pend}/${list.length})</option>`;
  };
  let html = opt("all", "All issues", ITEMS.filter((i) => i.kind !== "style"));
  for (const k of Object.keys(KINDS)) {
    const list = ITEMS.filter((i) => i.kind === k);
    if (list.length) html += opt(k, k === "style" ? "Style (table)" : KINDS[k], list);
  }
  $("#kind").innerHTML = html;
  $("#queue-count").textContent = `${VIEW.length} shown`;
}
function rowText(it) {
  const s = it.songs[0] || {};
  const artist = isDup(it) ? it.songs.map((x) => x.artist).join(" / ") : s.artist;
  return { title: s.title || it.summary, artist };
}
function renderQueue() {
  const list = $("#queue-list");
  if (!VIEW.length) {
    list.innerHTML = `<li class="q-empty">Nothing here. Pick another filter or issue.</li>`;
    return;
  }
  list.innerHTML = VIEW.map((it, i) => {
    const t = rowText(it);
    const st = statusOf(it.id);
    return `<li class="q-row is-${st} ${it.id === curId ? "is-current" : ""}" data-id="${esc(it.id)}">
      <span class="q-idx">${i + 1}</span>
      <img class="q-thumb" loading="lazy" alt="" src="${thumb((it.songs[0] || {}).youtube_id || "")}">
      <div class="q-text"><div class="q-title" dir="auto">${esc(t.title)}</div>
        <div class="q-artist" dir="auto"><span class="q-kind sev${it.severity || 1}">${esc(KINDS[it.kind] || it.kind)}</span>${esc(t.artist)}</div></div>
      <span class="q-status"></span></li>`;
  }).join("");
}
function markCurrentRow() {
  document.querySelectorAll(".q-row.is-current").forEach((r) => r.classList.remove("is-current"));
  const row = document.querySelector(`.q-row[data-id="${CSS.escape(curId || "")}"]`);
  if (row) { row.classList.add("is-current"); row.scrollIntoView({ block: "nearest" }); }
}
function renderAll() {
  renderProgress();
  renderFilters();
  renderQueue();
  renderStage();
}

/* ---------- the card ---------- */
/* What the card shows: the saved decision's full final state, else the proposal. */
function draftFields(it, s) {
  const d = DEC[it.id];
  const over = d && d.fields ? d.fields : ((it.proposal || {}).fields || {});
  return Object.assign({ title: s.title, artist: s.artist, youtube_id: s.youtube_id, start_time: s.start_time,
    release_year: s.release_year, genres: sortedGenres(s.genres) }, over);
}
const keptId = (it) => (DEC[it.id] && DEC[it.id].keep) || (it.proposal || {}).keep || null;
const keptSong = (it) => it.songs.find((x) => x.id === keptId(it)) || it.songs[0];
function editedFields(it) {
  const p = (it.proposal && it.proposal.fields) || {};
  const show = new Set(Object.keys(p));
  if (["name", "metadata", "duplicate", "maybe_dup"].includes(it.kind)) ["title", "artist", "release_year", "genres"].forEach((f) => show.add(f));
  show.delete("youtube_id");
  return show;
}
const startEditable = (it) => !isDup(it) && ((it.candidates && it.candidates.length) || editedFields(it).has("start_time"));

function ytFacts(yt, extra = "") {
  const bad = [];
  if (yt.status && yt.status !== "OK") bad.push(`<span class="bad-badge">${esc(yt.status)}</span>${esc(yt.reason || "")}`);
  if (yt.embed === false) bad.push(`<span class="bad-badge">embed off</span>`);
  if (yt.il === false) bad.push(`<span class="bad-badge">blocked in Israel</span>`);
  const badge = yt.badge === "artist" ? `<span class="badge-artist">ARTIST</span>` : (yt.badge ? `<span class="badge-verified">${esc(yt.badge)}</span>` : "");
  return `<dt>YouTube</dt><dd dir="auto">${esc(yt.title || "?")}</dd>
    <dt>Channel</dt><dd dir="auto">${esc(yt.channel || "?")}${badge}</dd>
    <dt>Views</dt><dd><b>${human(yt.views)}</b> · ${mmss(yt.length)}${extra} · ${esc((yt.upload || "").slice(0, 10))}</dd>
    ${bad.length ? `<dt>Status</dt><dd>${bad.join(" ")}</dd>` : ""}`;
}
function songPane(it, s, n, opts = {}) {
  const yt = s.yt || {};
  return `<div class="pane ${opts.cls || ""}">
    <div class="pane-head">${opts.head || `<span class="pane-label">${esc(opts.label || "Current video")}</span>`}</div>
    <div class="pane-player" data-key="${esc(it.id)}:${n}" data-n="${n}" data-vid="${esc(s.youtube_id)}" data-start="${s.start_time || 0}"
      style="background-image:url(${thumb(s.youtube_id)})"><span class="pane-num">${n}</span><span class="pane-play">▶</span><span class="pane-len">${mmss(yt.length)}</span></div>
    <div class="pane-title" dir="auto">${esc(s.title)} — ${esc(s.artist)}</div>
    <dl class="kv">
      <dt>Catalog</dt><dd>${esc((s.genres || []).join(", ") || "no genre")} · ${s.release_year ?? "no year"} · start ${mmss(s.start_time)} · played ${s.plays || 0}×</dd>
      ${ytFacts(yt)}
    </dl>
    <a class="yt-link" href="${ytUrl(s.youtube_id, s.start_time)}" target="_blank" rel="noopener">open on YouTube ↗</a>
  </div>`;
}
function candPane(it, c, n, used, curLen) {
  const d = c.length && curLen ? c.length - curLen : 0;
  const diff = Math.abs(d) >= 8 ? ` <span class="len-diff">${d > 0 ? "+" : "−"}${Math.abs(d)}s vs current${d > 0 ? " — re-check the start" : ""}</span>` : "";
  const note = c.note ? `<div class="pane-note ${c.note.startsWith("⚠") ? "warn" : ""}" dir="auto">${esc(c.note)}</div>` : "";
  return `<div class="pane ${used ? "use" : "unused"}">
    <div class="pane-head"><span class="pane-label">${used ? "Proposed · will be used" : "Proposed · not used"}</span></div>
    <div class="pane-player" data-key="${esc(it.id)}:${n}" data-n="${n}" data-vid="${esc(c.youtube_id)}" data-start="${c.start_time ?? 0}"
      style="background-image:url(${thumb(c.youtube_id)})"><span class="pane-num">${n}</span><span class="pane-play">▶</span><span class="pane-len">${mmss(c.length)}</span></div>
    <dl class="kv">${ytFacts(c, diff)}</dl>
    ${note}
    <a class="yt-link" href="${ytUrl(c.youtube_id)}" target="_blank" rel="noopener">open on YouTube ↗</a>
  </div>`;
}
function renderCompare(it) {
  if (isDup(it)) {
    const keep = keptId(it);
    const panes = it.songs.map((s, i) => {
      const kept = s.id === keep;
      const head = `<label class="keep-pick"><input type="radio" name="keep" value="${esc(s.id)}" ${kept ? "checked" : ""}> Keep this one</label>
        <span class="pane-label">${kept ? "kept" : (keep ? "will be deleted" : "")}</span>`;
      return songPane(it, s, i + 1, { cls: kept ? "use" : (keep ? "drop" : ""), head });
    }).join("");
    return `<div class="compare cols-${Math.min(3, it.songs.length)}">${panes}</div>`;
  }
  const s = it.songs[0];
  const cands = it.candidates || [];
  if (!cands.length) return `<div class="compare cols-1">${songPane(it, s, 1)}</div>`;
  const chosen = draftFields(it, s).youtube_id;
  const shown = cands.find((c) => c.youtube_id === chosen) || cands[0];
  const pick = `<div class="cand-pick">Use:
    <button type="button" class="chip keep-cur ${chosen === s.youtube_id ? "on" : ""}" data-cand="${esc(s.youtube_id)}">Current video</button>
    ${cands.map((c, i) => `<button type="button" class="chip ${chosen === c.youtube_id ? "on" : ""}" data-cand="${esc(c.youtube_id)}">${cands.length > 1 ? `Proposal ${i + 1}` : "Proposal"} · ${human(c.views)}</button>`).join("")}
  </div>`;
  return `${pick}<div class="compare">${songPane(it, s, 1, { label: chosen === s.youtube_id ? "Current video · kept" : "Current video", cls: chosen === s.youtube_id ? "use" : "" })}${candPane(it, shown, 2, chosen === shown.youtube_id, (s.yt || {}).length)}</div>`;
}
function renderControls(it) {
  const st = statusOf(it.id);
  const start = startEditable(it)
    ? `<button type="button" class="btn" id="btn-from-start" title="Play the chosen video from the start time (P)">⟲ From start <kbd>P</kbd></button>
      <div class="start-tools" role="group" aria-label="Start time">
        <span class="start-label" title="Where the round starts, on the video that will be used">Start</span>
        <button type="button" class="btn btn-nudge" data-nudge="-5">−5</button>
        <button type="button" class="btn btn-nudge" data-nudge="-1">−1</button>
        <input type="text" id="start-input" class="start-input" data-f="start_time" inputmode="numeric" autocomplete="off" title="m:ss or seconds, Enter to apply">
        <button type="button" class="btn btn-nudge" data-nudge="1">+1</button>
        <button type="button" class="btn btn-nudge" data-nudge="5">+5</button>
      </div>
      <button type="button" class="btn" id="btn-set-now" title="Start = where the chosen video is now (S)">⏱ Set = now <kbd>S</kbd></button>`
    : "";
  return `<div class="controls">
    <div class="transport">
      <button type="button" class="btn btn-icon btn-play" id="btn-play" title="Play / pause (Space)">▶</button>
      ${start}
      <span class="clock" id="clock">0:00 / 0:00</span>
    </div>
    <div class="decide">
      <button type="button" class="btn btn-approve ${st === "approved" ? "is-on" : ""}" id="btn-approve" title="Approve and go to the next card (A)">✓ Approve <kbd>A</kbd></button>
      <button type="button" class="btn btn-reject ${st === "rejected" ? "is-on" : ""}" id="btn-reject" title="Reject and go to the next card (R)">✕ Reject <kbd>R</kbd></button>
      <button type="button" class="btn btn-icon" id="btn-undo" title="Undo (U)">↶</button>
      <span class="decide-sep"></span>
      <button type="button" class="btn btn-icon" id="btn-prev" title="Previous card (K / ↑)">‹</button>
      <button type="button" class="btn btn-icon" id="btn-next" title="Next card (J / ↓)">›</button>
    </div>
  </div>`;
}
function renderDetails(it) {
  const s = isDup(it) ? keptSong(it) : it.songs[0];
  const v = draftFields(it, s);
  const now = { title: s.title, artist: s.artist, release_year: s.release_year, genres: sortedGenres(s.genres) };
  const show = editedFields(it);
  const rows = [];
  for (const f of ["title", "artist", "release_year"]) {
    if (!show.has(f)) continue;
    const changed = !sameVal(v[f], now[f]);
    const label = { title: "Title", artist: "Artist", release_year: "Year" }[f];
    rows.push(`<div class="field ${f === "release_year" ? "field-year" : ""}">
      <label>${label} <span class="orig ${changed ? "changed" : ""}" dir="auto">now: <b>${esc(now[f] ?? "—")}</b></span></label>
      <div class="field-input"><input type="${f === "release_year" ? "number" : "text"}" dir="auto" data-f="${f}" value="${esc(v[f] ?? "")}" class="${changed ? "edited" : ""}"></div>
    </div>`);
  }
  if (show.has("genres")) {
    const g = sortedGenres(v.genres);
    const changed = !sameVal(g, now.genres);
    rows.push(`<div class="field"><div class="label">Genres <span class="orig ${changed ? "changed" : ""}">now: <b>${esc(now.genres.join(", ") || "none")}</b></span></div>
      <div class="chips ${g.length ? "" : "empty"}" data-genres>${GENRES.map((x) => `<button type="button" class="chip ${g.includes(x) ? "on" : ""}" data-genre="${esc(x)}">${esc(x)}</button>`).join("")}</div></div>`);
  }
  const dec = DEC[it.id] || {};
  const p = it.proposal || {};
  const what = isDup(it) ? `<p class="small muted">These apply to the copy you keep; the other ${it.songs.length > 2 ? "copies are" : "copy is"} deleted.</p>` : "";
  const del = p.action === "delete" ? `<div class="flag error">Proposed: delete this song from the catalog.</div>` : "";
  return `<section class="panel"><h3>Changes</h3>${del}${what}
      ${rows.join("") || (del ? "" : `<p class="small muted">Nothing to edit on this card: approve or reject the proposal.</p>`)}
      <div class="field"><label>Note</label><input class="note-input" id="note" type="text" dir="auto" placeholder="Optional" value="${esc(dec.note || "")}"></div>
    </section>`;
}
function renderStage() {
  stopAllPlayers();
  const stage = $("#stage");
  const details = $("#details");
  if (F.kind === "style") {
    stage.innerHTML = renderStyleTable(VIEW);
    details.innerHTML = "";
    wireStyle();
    return;
  }
  const it = cur();
  if (!it) {
    const done = F.status === "pending" && ITEMS.some((i) => matchesBase(i));
    stage.innerHTML = `<div class="stage-empty">${done
      ? "<h2>All done here ✓</h2><p>Every card in this view is decided. Open <b>Summary of approved</b> to see what will change, then tell Claude “apply”.</p>"
      : "<h2>Nothing to show</h2><p>Pick another filter or issue type on the left.</p>"}</div>`;
    details.innerHTML = "";
    return;
  }
  const idx = VIEW.findIndex((i) => i.id === it.id);
  const t = rowText(it);
  const st = statusOf(it.id);
  const warns = (it.evidence || []).filter((e) => e.startsWith("⚠"));
  const ev = (it.evidence || []).filter((e) => !e.startsWith("⚠"));
  stage.innerHTML = `
    <div class="song-head">
      <div class="sh-pos">${idx + 1}<span>/${VIEW.length}</span></div>
      <div class="sh-main"><span class="sh-title" dir="auto">${esc(t.title)}</span><span class="sh-sep">—</span><span class="sh-artist" dir="auto">${esc(t.artist)}</span></div>
      <div class="sh-tags"><span class="tag kind sev${it.severity || 1}">${esc(KINDS[it.kind] || it.kind)} · ${SEV[it.severity || 1]}</span>
        <span class="status-pill ${st}">${st === "pending" ? "to review" : st}</span></div>
    </div>
    <section class="issue sev${it.severity || 1}">
      <div class="issue-summary" dir="auto">${esc(it.summary)}</div>
      <div class="issue-meta">${it.confidence ? `confidence <span class="conf ${esc(it.confidence)}">${esc(it.confidence)}</span> · ` : ""}found by ${esc(it.by || "")}</div>
      ${warns.map((w) => `<div class="flag warn" dir="auto">${linkify(w)}</div>`).join("")}
      ${ev.length ? `<ul class="evidence">${ev.map((e) => `<li dir="auto">${linkify(e)}</li>`).join("")}</ul>` : ""}
    </section>
    ${renderCompare(it)}
    ${renderControls(it)}`;
  details.innerHTML = renderDetails(it);
  const si = $("#start-input");
  if (si) si.value = mmss(draftFields(it, it.songs[0]).start_time || 0);
  store.set(`catalog-audit-cur:${BATCH}`, it.id);
}

/* Read the card's editors into a decision (fields = full final state). */
function collect(it) {
  const dec = DEC[it.id] || {};
  let s = it.songs[0];
  let keep = null;
  if (isDup(it)) {
    keep = keptId(it);
    s = keptSong(it);
  }
  const fields = {};
  document.querySelectorAll("#stage [data-f], #details [data-f]").forEach((el) => {
    const f = el.dataset.f;
    let val = el.value;
    if (f === "release_year") val = val === "" ? null : Number(val);
    if (f === "start_time") val = parseTime(val) ?? s.start_time ?? 0;
    if (!sameVal(val, s[f] ?? null)) fields[f] = val;
  });
  const chips = $("#details [data-genres]");
  if (chips) {
    const g = [...chips.querySelectorAll(".chip.on")].map((b) => b.dataset.genre).sort();
    if (!sameVal(g, sortedGenres(s.genres))) fields.genres = g;
  }
  if (!isDup(it)) {
    const vid = draftFields(it, s).youtube_id;
    if (vid && vid !== s.youtube_id) fields.youtube_id = vid;
  }
  const note = (($("#note") || {}).value || "").trim();
  return { status: dec.status || "pending", fields, keep, note };
}
async function saveDraft(it) {
  await saveDecision(it.id, collect(it));
  renderProgress();
}

/* ---------- deciding + moving ---------- */
function select(id) {
  if (!id) return;
  curId = id;
  markCurrentRow();
  renderStage();
}
function move(step) {
  if (F.kind === "style" || !VIEW.length) return;
  const i = VIEW.findIndex((x) => x.id === curId);
  const n = Math.max(0, Math.min(VIEW.length - 1, (i < 0 ? 0 : i + step)));
  select(VIEW[n].id);
}
function afterDecision(oldIdx) {
  rebuild();
  if (!VIEW.some((x) => x.id === curId)) {
    curId = (VIEW[Math.min(oldIdx, VIEW.length - 1)] || {}).id || null;
  } else {
    // the card stays in view (status "All"): go on to the next undecided one
    const i = VIEW.findIndex((x) => x.id === curId);
    const next = VIEW.slice(i + 1).find((x) => statusOf(x.id) === "pending") || VIEW.find((x) => statusOf(x.id) === "pending");
    if (next) curId = next.id;
  }
  renderAll();
}
async function decide(status) {
  const it = cur();
  if (!it || F.kind === "style") return;
  const d = collect(it);
  d.status = status;
  if (status === "approved" && isDup(it) && !d.keep) { toast("Pick which copy to keep first.", "warn"); return; }
  if (status === "approved" && d.fields.genres && !d.fields.genres.length) { toast("Pick at least one genre: a song with none never comes up in a game.", "warn", 3500); return; }
  const oldIdx = VIEW.findIndex((x) => x.id === it.id);
  await saveDecision(it.id, d);
  decidedStack.push(it.id);
  toast(`${status === "approved" ? "✓ Approved" : "✕ Rejected"}: ${esc(rowText(it).title)}`, status === "approved" ? "ok" : "bad", 1400);
  afterDecision(oldIdx);
}
async function undo() {
  let it = cur();
  if (!it || statusOf(it.id) === "pending") {
    const last = decidedStack.pop();
    if (!last) { toast("Nothing to undo.", "", 1400); return; }
    it = ITEMS.find((x) => x.id === last);
  }
  await saveDecision(it.id, null);
  toast(`Back to “to review”: ${esc(rowText(it).title)}`, "", 1600);
  rebuild();
  if (!VIEW.some((x) => x.id === it.id)) { F.status = "pending"; rebuild(); } // keep the card in sight
  if (!VIEW.some((x) => x.id === it.id)) { F.q = ""; F.must = false; F.kind = it.kind === "style" ? "style" : "all"; $("#search").value = ""; rebuild(); }
  curId = it.id;
  renderAll();
}

/* ---------- players ---------- */
function startPlayer(el, startAt) {
  if (!el) return;
  if (el.dataset.live) { const p = players[el.dataset.key]; if (p && p.playVideo) p.playVideo(); return; }
  if (!ytReady || !window.YT || !YT.Player) { window.open(ytUrl(el.dataset.vid, startAt ?? el.dataset.start), "_blank"); return; }
  el.dataset.live = "1";
  el.innerHTML = "<div></div>";
  const key = el.dataset.key;
  activeKey = key;
  players[key] = new YT.Player(el.firstElementChild, {
    videoId: el.dataset.vid,
    host: "https://www.youtube-nocookie.com",
    playerVars: { start: Math.floor(Number(startAt ?? el.dataset.start) || 0), autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
    events: {
      onStateChange: (ev) => {
        if (ev.data === YT.PlayerState.PLAYING) {
          activeKey = key;
          for (const [k, p] of Object.entries(players)) if (k !== key && p.pauseVideo) try { p.pauseVideo(); } catch (_) { /* gone */ }
        }
      },
    },
  });
}
function stopAllPlayers() {
  for (const k of Object.keys(players)) { try { players[k].destroy(); } catch (_) { /* gone */ } delete players[k]; }
  activeKey = null;
}
/* the pane of the video this card will end up using */
function chosenPane(it) {
  const s = isDup(it) ? keptSong(it) : it.songs[0];
  const vid = isDup(it) ? s.youtube_id : draftFields(it, s).youtube_id;
  return document.querySelector(`#stage .pane-player[data-vid="${CSS.escape(vid)}"]`);
}
function togglePlay() {
  const p = activeKey && players[activeKey];
  if (p && p.getPlayerState) { p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(); return; }
  const it = cur();
  if (it) startPlayer(chosenPane(it) || $("#stage .pane-player"));
}
function playN(n) {
  const el = document.querySelector(`#stage .pane-player[data-n="${n}"]`);
  if (!el) return;
  const p = players[el.dataset.key];
  if (p && p.playVideo) { activeKey = el.dataset.key; p.playVideo(); } else startPlayer(el);
}
function startValue() {
  const si = $("#start-input");
  return si ? (parseTime(si.value) ?? 0) : 0;
}
function playFromStart() {
  const it = cur();
  const el = it && chosenPane(it);
  if (!el) return;
  const p = players[el.dataset.key];
  if (p && p.seekTo) { p.seekTo(startValue(), true); p.playVideo(); activeKey = el.dataset.key; } else startPlayer(el, startValue());
}
function setStart(sec) {
  const it = cur();
  const si = $("#start-input");
  if (!it || !si) return;
  si.value = mmss(Math.max(0, Math.floor(sec)));
  si.classList.add("edited");
  saveDraft(it);
}
function setStartNow() {
  const it = cur();
  const el = it && chosenPane(it);
  const p = el && players[el.dataset.key];
  if (!$("#start-input")) return;
  if (!p || !p.getCurrentTime) { toast("Play the video that will be used first, pause at the right spot, then press S.", "warn", 3500); return; }
  setStart(p.getCurrentTime());
}
function nudge(d) {
  if ($("#start-input")) setStart(startValue() + d);
}
setInterval(() => {
  const clock = $("#clock");
  if (!clock) return;
  const p = activeKey && players[activeKey];
  if (p && p.getCurrentTime) {
    try {
      clock.textContent = `${mmss(p.getCurrentTime())} / ${mmss(p.getDuration())}`;
      const btn = $("#btn-play");
      if (btn) btn.textContent = p.getPlayerState() === 1 ? "❚❚" : "▶";
    } catch (_) { /* player gone */ }
  }
}, 300);

/* ---------- style table (bulk) ---------- */
function renderStyleTable(items) {
  if (!items.length) return `<div class="stage-empty"><h2>No style cards here</h2><p>Pick another status on the left.</p></div>`;
  const rows = items.map((it) => {
    const s = it.songs[0];
    const v = draftFields(it, s);
    const p = (it.proposal || {}).fields || {};
    const cells = Object.keys(p).filter((f) => f !== "genres").map((f) =>
      `<div><span class="rule">${f}</span> <span class="old" dir="auto">${esc(s[f])}</span> → <input type="text" dir="auto" data-f="${f}" value="${esc(v[f])}"></div>`).join("");
    const st = statusOf(it.id);
    return `<tr class="is-${st}" data-id="${esc(it.id)}">
      <td dir="auto">${esc(s.title)} — ${esc(s.artist)}</td>
      <td>${cells}</td>
      <td class="rule" dir="auto">${esc(it.summary)}</td>
      <td style="white-space:nowrap"><button type="button" class="btn ok" data-act="approve">✓</button> <button type="button" class="btn no" data-act="reject">✕</button>
        <span class="state-txt ${st}">${st === "pending" ? "" : st}</span></td>
    </tr>`;
  }).join("");
  return `<div class="style-bar"><b>${items.length}</b> style fixes shown (capitalisation, quotes, “ft.”).
      <button type="button" class="btn btn-approve" id="style-all">✓ Approve all shown</button>
      <button type="button" class="btn btn-reject" id="style-none">✕ Reject all shown</button>
      <span class="small muted">You can edit a new value before approving.</span></div>
    <table class="data-table"><thead><tr><th>Song</th><th>Change</th><th>Rule</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}
function styleDecision(it, tr, status) {
  const s = it.songs[0];
  const fields = {};
  tr.querySelectorAll("[data-f]").forEach((el) => { if (el.value !== s[el.dataset.f]) fields[el.dataset.f] = el.value; });
  return { status, fields, keep: null, note: "" };
}
function wireStyle() {
  const byId = Object.fromEntries(VIEW.map((i) => [i.id, i]));
  $("#stage").querySelectorAll("tr[data-id]").forEach((tr) => {
    const it = byId[tr.dataset.id];
    tr.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-act]");
      if (!a) return;
      await saveDecision(it.id, styleDecision(it, tr, a.dataset.act === "approve" ? "approved" : "rejected"));
      const st = statusOf(it.id);
      tr.className = `is-${st}`;
      tr.querySelector(".state-txt").className = `state-txt ${st}`;
      tr.querySelector(".state-txt").textContent = st;
      renderProgress();
      renderFilters();
    });
  });
  const bulk = async (status) => {
    const trs = [...$("#stage").querySelectorAll("tr[data-id]")];
    for (const tr of trs) await saveDecision(tr.dataset.id, styleDecision(byId[tr.dataset.id], tr, status));
    toast(`${status === "approved" ? "✓ Approved" : "✕ Rejected"} ${trs.length} style fixes`, status === "approved" ? "ok" : "bad");
    rebuild();
    renderAll();
  };
  $("#style-all").onclick = () => bulk("approved");
  $("#style-none").onclick = () => bulk("rejected");
}

/* ---------- summary of approved changes (mirrors make_sql.py) ---------- */
function plan() {
  const songs = {}; // song id -> {song, set:{f:[{val,item}]}, del:[item]}
  const touch = (s) => (songs[s.id] = songs[s.id] || { song: s, set: {}, del: [] });
  for (const it of ITEMS) {
    const d = DEC[it.id];
    if (!d || d.status !== "approved") continue;
    const p = it.proposal || {};
    if (isDup(it)) {
      const keep = d.keep || p.keep;
      if (!keep) continue;
      for (const s of it.songs) if (s.id !== keep) touch(s).del.push(it);
      const k = it.songs.find((x) => x.id === keep);
      const fields = d.fields ? d.fields : (p.fields || {});
      for (const [f, val] of Object.entries(fields)) (touch(k).set[f] = touch(k).set[f] || []).push({ val, it });
      continue;
    }
    const s = it.songs[0];
    if (p.action === "delete") { touch(s).del.push(it); continue; }
    const fields = d.fields ? d.fields : (p.fields || {});
    for (const [f, val] of Object.entries(fields)) {
      const now = f === "genres" ? sortedGenres(s.genres) : s[f];
      if (sameVal(f === "genres" ? sortedGenres(val) : val, now)) continue;
      (touch(s).set[f] = touch(s).set[f] || []).push({ val, it });
    }
  }
  return songs;
}
function renderSummary() {
  const songs = Object.values(plan());
  const dels = songs.filter((x) => x.del.length);
  const ups = songs.filter((x) => !x.del.length && Object.keys(x.set).length);
  const row = (x) => {
    const s = x.song;
    if (x.del.length) {
      const extra = Object.keys(x.set).length ? ` <span class="conflict">(also has approved edits — delete wins)</span>` : "";
      return `<tr><td dir="auto">${esc(s.title)} — ${esc(s.artist)}<div class="rule">${esc(s.youtube_id)}</div></td><td class="del">DELETE${extra}</td></tr>`;
    }
    const parts = Object.entries(x.set).map(([f, vals]) => {
      const uniq = [...new Set(vals.map((v) => JSON.stringify(v.val)))];
      const conflict = uniq.length > 1 ? ` <span class="conflict">CONFLICT: ${uniq.map(esc).join(" vs ")}</span>` : "";
      const nv = vals[vals.length - 1].val;
      const was = s[f];
      return `<div><span class="rule">${f}</span> <span class="old" dir="auto">${esc(Array.isArray(was) ? was.join(", ") : was)}</span> → <span class="new" dir="auto">${esc(Array.isArray(nv) ? nv.join(", ") : nv)}</span>${conflict}</div>`;
    }).join("");
    return `<tr><td dir="auto">${esc(s.title)} — ${esc(s.artist)}<div class="rule">${esc(s.youtube_id)}</div></td><td>${parts}</td></tr>`;
  };
  return `<p class="sum-lead"><b>${ups.length}</b> songs updated · <b class="del">${dels.length}</b> songs deleted. Nothing changes in the game until you tell Claude “apply”.</p>
    <table class="data-table"><thead><tr><th>Song (current)</th><th>Change</th></tr></thead><tbody>${dels.map(row).join("")}${ups.map(row).join("")}</tbody></table>`;
}
function openModal(id) {
  if (id === "summary") $("#summary-body").innerHTML = renderSummary();
  $(`#${id}`).hidden = false;
}
const closeModals = () => document.querySelectorAll(".modal").forEach((m) => { m.hidden = true; });

/* ---------- wiring ---------- */
$("#filters").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.must) F.must = !F.must; else F.status = b.dataset.status;
  rebuild();
  if (!VIEW.some((x) => x.id === curId)) curId = (VIEW[0] || {}).id || null;
  renderAll();
});
$("#kind").addEventListener("change", (e) => {
  F.kind = e.target.value;
  rebuild();
  curId = (VIEW[0] || {}).id || null;
  renderAll();
});
let qTimer = null;
$("#search").addEventListener("input", (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    F.q = e.target.value.trim().toLowerCase();
    rebuild();
    if (!VIEW.some((x) => x.id === curId)) curId = (VIEW[0] || {}).id || null;
    renderAll();
  }, 250);
});
$("#queue-list").addEventListener("click", (e) => {
  const row = e.target.closest(".q-row");
  if (!row) return;
  if (F.kind === "style") {
    const tr = document.querySelector(`#stage tr[data-id="${CSS.escape(row.dataset.id)}"]`);
    if (tr) tr.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }
  select(row.dataset.id);
});
$("#stage").addEventListener("click", (e) => {
  const it = cur();
  if (!it || F.kind === "style") return;
  const pl = e.target.closest(".pane-player");
  if (pl && !pl.dataset.live) { e.preventDefault(); startPlayer(pl); return; }
  const cand = e.target.closest("[data-cand]");
  if (cand) {
    const s = it.songs[0];
    const d = collect(it);
    const vid = cand.dataset.cand;
    if (vid === s.youtube_id) { delete d.fields.youtube_id; delete d.fields.start_time; } else {
      d.fields.youtube_id = vid;
      const c = (it.candidates || []).find((x) => x.youtube_id === vid);
      if (c && c.start_time != null) d.fields.start_time = c.start_time;
    }
    saveDecision(it.id, Object.assign({}, DEC[it.id] || {}, d)).then(() => { renderStage(); renderProgress(); });
    return;
  }
  const nb = e.target.closest("[data-nudge]");
  if (nb) { nudge(Number(nb.dataset.nudge)); return; }
  const id = (e.target.closest("button") || {}).id;
  if (id === "btn-approve") decide("approved");
  else if (id === "btn-reject") decide("rejected");
  else if (id === "btn-undo") undo();
  else if (id === "btn-prev") move(-1);
  else if (id === "btn-next") move(1);
  else if (id === "btn-play") togglePlay();
  else if (id === "btn-from-start") playFromStart();
  else if (id === "btn-set-now") setStartNow();
});
$("#stage").addEventListener("change", (e) => {
  const it = cur();
  if (!it) return;
  if (e.target.name === "keep") {
    // A different copy is now kept: its editors must start from ITS values
    // (plus the card's proposal), never from the previously shown copy.
    const prev = DEC[it.id] || {};
    const d = { status: prev.status || "pending", fields: Object.assign({}, (it.proposal || {}).fields || {}),
      keep: e.target.value, note: prev.note || "" };
    saveDecision(it.id, d).then(() => renderStage());
    return;
  }
  if (e.target.id === "start-input") {
    const v = parseTime(e.target.value);
    if (v == null) { e.target.classList.add("bad"); toast("Start: m:ss or seconds.", "warn"); return; }
    e.target.classList.remove("bad");
    setStart(v);
  }
});
$("#details").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-genre]");
  if (!chip) return;
  chip.classList.toggle("on");
  const box = chip.closest("[data-genres]");
  box.classList.toggle("empty", !box.querySelector(".chip.on"));
  const it = cur();
  if (it) saveDraft(it);
});
$("#details").addEventListener("change", (e) => {
  const it = cur();
  if (!it || !e.target.matches("[data-f], #note")) return;
  if (e.target.matches("[data-f]")) e.target.classList.add("edited");
  saveDraft(it);
});
$("#btn-summary").addEventListener("click", () => openModal("summary"));
$("#btn-help").addEventListener("click", () => openModal("help"));
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target.classList.contains("modal")) closeModals();
  // a focused button would also "click" on Space: give focus back to the page after mouse clicks
  const b = e.target.closest("button");
  if (b && e.detail > 0 && !b.closest(".modal")) b.blur();
});

const isTyping = (t) => t && (t.matches("input:not([type=radio]):not([type=checkbox]), textarea, select") || t.isContentEditable);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ([...document.querySelectorAll(".modal")].some((m) => !m.hidden)) closeModals();
    else if (isTyping(e.target)) e.target.blur();
    return;
  }
  if (e.key === "Enter" && e.target.id === "start-input") { e.target.blur(); return; }
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const code = e.code;
  const isHelp = (code === "Slash" && e.shiftKey) || e.key === "?";
  const modalOpen = [...document.querySelectorAll(".modal")].some((m) => !m.hidden);
  if (modalOpen) { if (isHelp) closeModals(); return; }
  let handled = true;
  if (isHelp) openModal("help");
  else if (code === "Slash") { $("#search").focus(); $("#search").select(); }
  else if (e.repeat && ["KeyA", "KeyR", "KeyU"].includes(code)) handled = true;
  else {
    switch (code) {
      case "KeyA": decide("approved"); break;
      case "KeyR": decide("rejected"); break;
      case "KeyU": undo(); break;
      case "KeyJ": case "ArrowDown": move(1); break;
      case "KeyK": case "ArrowUp": move(-1); break;
      case "Space": togglePlay(); break;
      case "KeyP": playFromStart(); break;
      case "KeyS": setStartNow(); break;
      case "BracketLeft": nudge(e.shiftKey ? -5 : -1); break;
      case "BracketRight": nudge(e.shiftKey ? 5 : 1); break;
      case "Digit1": case "Numpad1": playN(1); break;
      case "Digit2": case "Numpad2": playN(2); break;
      case "Digit3": case "Numpad3": playN(3); break;
      default: handled = false;
    }
  }
  if (handled) e.preventDefault();
});
// Clicking inside a YouTube iframe moves keyboard focus into it, where the
// shortcuts can't see the keys: pull focus back right away.
window.addEventListener("blur", () => {
  setTimeout(() => {
    if (document.activeElement && document.activeElement.tagName === "IFRAME") $("#focus-sink").focus({ preventScroll: true });
  }, 60);
});

load();
