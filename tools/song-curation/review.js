/* Sound Clash — song curation review page (vanilla JS, no build step).
 *
 * Data: window.CANDIDATES (+ optional window.BATCH = {id, title}) from a
 * candidates.js file, loaded with a <script> tag so the page also works from
 * file://:
 *   review.html                -> candidates.js next to the page
 *   review.html?batch=<name>   -> batches/<name>/candidates.js
 *
 * Persistence, two layers:
 *   1. localStorage, one key per batch (BATCH.id, else a hash of the ids), so
 *      batches never collide and a reload never loses anything.
 *   2. When the page is served by review_server.py, every change is also
 *      queued (in localStorage) and sent to <batch>/decisions.json; failed
 *      sends retry every few seconds and are replayed on the next page load.
 *
 * Decisions are keyed by the candidate's ORIGINAL youtube_id. A swapped-in
 * alternative video is stored separately (rec.video) and is what gets
 * exported.
 */
"use strict";

// The 11 genre slugs the importer accepts (backend/app/services/csv_import.py).
const GENRES = [
  ["rock", "Rock"],
  ["pop", "Pop"],
  ["hip-hop", "Hip-Hop"],
  ["electronic", "Electronic"],
  ["soundtracks", "Soundtracks"],
  ["israeli-pop", "Israeli Pop"],
  ["israeli-cover", "Israeli Cover"],
  ["israeli-rock-pop", "Israeli Rock-Pop"],
  ["israeli-rap-hip-hop", "Israeli Rap"],
  ["mizrahit", "Mizrahit"],
  ["israeli-soundtracks", "Israeli Soundtracks"],
];
const VALID_SLUGS = new Set(GENRES.map(([slug]) => slug));
const GENRE_LABEL = Object.fromEntries(GENRES);
const CSV_HEADER = ["title", "artist", "youtube_id", "start_time", "genres", "release_year"];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const STATE_PLAYING = 1;
const STATE_BUFFERING = 3;
const STATE_ENDED = 0;

const $ = (sel, root = document) => root.querySelector(sel);
const el = {
  topbar: $("#topbar"),
  batchName: $("#batch-name"),
  pbOk: $("#pb-ok"),
  pbBad: $("#pb-bad"),
  progressText: $("#progress-text"),
  savePill: $("#save-pill"),
  menuBtn: $("#btn-menu"),
  menuPop: $("#menu-pop"),
  search: $("#search"),
  filters: $("#filters"),
  sort: $("#sort"),
  queueCount: $("#queue-count"),
  allDone: $("#all-done"),
  queueList: $("#queue-list"),
  stage: $("#stage"),
  head: $("#song-head"),
  playerBox: $("#player-box"),
  playerMsg: $("#player-msg"),
  playerAlert: $("#player-alert"),
  timeline: $("#timeline"),
  tlPath: $("#tl-path"),
  tlPlayed: $("#tl-played"),
  tlStart: $("#tl-start"),
  tlHook: $("#tl-hook"),
  tlPlayhead: $("#tl-playhead"),
  tlHover: $("#tl-hover"),
  tlLabelL: $("#tl-label-l"),
  tlLabelR: $("#tl-label-r"),
  controls: $("#controls"),
  btnPlay: $("#btn-play"),
  startInput: $("#start-input"),
  startReset: $("#start-reset"),
  btnHook: $("#btn-hook"),
  hookTime: $("#hook-time"),
  clock: $("#clock"),
  btnApprove: $("#btn-approve"),
  btnReject: $("#btn-reject"),
  alts: $("#alts"),
  details: $("#details"),
  empty: $("#empty"),
  help: $("#help"),
  toasts: $("#toasts"),
  importFile: $("#import-file"),
  focusSink: $("#focus-sink"),
};

/* ===================================================================
 * small helpers
 * =================================================================== */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
/** "1:23" -> 83, "83" -> 83, "1:02:03" -> 3723; NaN when not a time. */
function parseTime(str) {
  const s = String(str).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /^(?:(\d+):)?(\d{1,3}):(\d{1,2})$/.exec(s);
  if (!m) return NaN;
  return (parseInt(m[1] || "0", 10) * 3600) + parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}
function fmtViews(n) {
  if (!Number.isFinite(n)) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}
function hashIds(ids) {
  let h = 0x811c9dc5;
  const s = ids.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
const LS = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); return true; } catch { return false; }
  },
  del(k) {
    try { localStorage.removeItem(k); } catch { /* storage blocked */ }
  },
};
function toast(msg, kind = "", ms = 2200) {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = msg;
  el.toasts.appendChild(t);
  while (el.toasts.children.length > 4) el.toasts.firstChild.remove();
  setTimeout(() => t.remove(), ms);
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function thumbUrl(vid) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(vid)}/mqdefault.jpg`;
}
function watchUrl(vid, t) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}${t ? `&t=${Math.floor(t)}s` : ""}`;
}

/* ===================================================================
 * data
 * =================================================================== */
const params = new URLSearchParams(location.search);
const BATCH_PARAM = (() => {
  const b = params.get("batch");
  return b && /^[A-Za-z0-9._-]+$/.test(b) && b !== "." && b !== ".." ? b : null;
})();
const CANDIDATES_SRC = BATCH_PARAM ? `batches/${BATCH_PARAM}/candidates.js` : "candidates.js";

let cands = [];
const byKey = new Map();
let KEY = "";
let BATCH_LABEL = "";

function normalize(raw) {
  const seen = new Map();
  const out = [];
  raw.forEach((c, i) => {
    if (!c || typeof c.youtube_id !== "string") return;
    const n = (seen.get(c.youtube_id) || 0) + 1;
    seen.set(c.youtube_id, n);
    let genres = c.genres;
    if (typeof genres === "string") genres = genres.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    out.push({
      ...c,
      _key: n > 1 ? `${c.youtube_id}~${n}` : c.youtube_id,
      _i: i,
      title: c.title ?? "",
      artist: c.artist ?? "",
      genres: Array.isArray(genres) ? genres : [],
      alternatives: Array.isArray(c.alternatives) ? c.alternatives.filter((a) => a && typeof a.youtube_id === "string") : [],
      flags: Array.isArray(c.flags) ? c.flags.filter((f) => f && f.text) : [],
    });
  });
  return out;
}

/* ---- decision store (localStorage) ---- */
let doc = { decisions: {}, errors: {}, reset_at: 0 };
let storageWarned = false;

function loadLocal() {
  const raw = LS.get(KEY);
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    doc = { decisions: d.decisions || {}, errors: d.errors || {}, reset_at: d.reset_at || 0 };
  } catch {
    /* corrupt entry: start clean, the server copy (if any) still merges in */
  }
}
function saveLocal() {
  const ok = LS.set(KEY, JSON.stringify({ v: 2, batch: KEY, ...doc }));
  if (!ok && !storageWarned) {
    storageWarned = true;
    toast("<b>Browser storage is blocked.</b> Use ⋯ → Export decisions before closing this tab.", "bad", 8000);
  }
}
/** One-time import from the previous review tool's store (song-curation:v1). */
function importLegacyStore() {
  if (Object.keys(doc.decisions).length) return;
  let old;
  try {
    old = JSON.parse(LS.get("song-curation:v1") || "null");
  } catch {
    return;
  }
  if (!old || typeof old !== "object") return;
  let n = 0;
  const at = Date.now();
  for (const c of cands) {
    const o = old[c.youtube_id];
    if (!o) continue;
    const r = { at };
    if (o.decision === "approved" || o.decision === "rejected") r.status = o.decision;
    if (typeof o.title === "string") r.title = o.title;
    if (typeof o.artist === "string") r.artist = o.artist;
    if (Number.isFinite(o.start_time)) r.start_time = o.start_time;
    if (Array.isArray(o.genres)) r.genres = o.genres;
    doc.decisions[c._key] = r;
    n++;
  }
  if (n) {
    saveLocal();
    setTimeout(() => toast(`Imported ${n} decision(s) from the previous review tool.`, "ok", 5000), 400);
  }
}

const EMPTY = Object.freeze({});
const rec = (c) => doc.decisions[c._key] || EMPTY;
const statusOf = (c) => rec(c).status || null;
const origStart = (c) => (Number.isFinite(c.start_time) ? Math.max(0, Math.round(c.start_time)) : 0);
const origGenres = (c) => c.genres.filter((s) => VALID_SLUGS.has(s));
const origYear = (c) => (Number.isFinite(c.release_year) ? c.release_year : null);
function effTitle(c) {
  const r = rec(c);
  return r.title !== undefined ? r.title : c.title;
}
function effArtist(c) {
  const r = rec(c);
  return r.artist !== undefined ? r.artist : c.artist;
}
function effYear(c) {
  const r = rec(c);
  return "release_year" in r ? r.release_year : origYear(c);
}
function effGenres(c) {
  const r = rec(c);
  return (r.genres || c.genres).filter((s) => VALID_SLUGS.has(s));
}
function effStart(c) {
  const r = rec(c);
  return Number.isFinite(r.start_time) ? r.start_time : origStart(c);
}
function effVideo(c) {
  return rec(c).video || c.youtube_id;
}
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Apply a change to a candidate's record, persist it locally and queue it for the server. */
function update(c, fn) {
  const r = { ...(doc.decisions[c._key] || {}) };
  fn(r);
  // An override equal to the proposed value is no override: drop it, so
  // "edited" markers and resets stay honest.
  if (r.title !== undefined && r.title === c.title) delete r.title;
  if (r.artist !== undefined && r.artist === c.artist) delete r.artist;
  if ("release_year" in r && r.release_year === origYear(c)) delete r.release_year;
  if (r.genres && sameSet(r.genres, origGenres(c))) delete r.genres;
  if (r.start_time !== undefined && r.start_time === origStart(c)) delete r.start_time;
  if (r.video !== undefined && r.video === c.youtube_id) delete r.video;
  if (!r.status) delete r.status;
  r.at = Date.now();
  doc.decisions[c._key] = r;
  saveLocal();
  Sync.push(c._key, r);
}

/* ---- per-video player errors ---- */
const ENV_ERRORS = new Set([152, 153]);
// YouTube refuses some label-owned videos (error 150, "auth") when the page's
// origin is a bare IP such as http://127.0.0.1:8760, while the very same page
// on http://localhost:8760 plays them. Errors seen there say nothing about the
// video, so they are shown but never recorded.
const IP_HOST = /^(\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\])$/i.test(location.hostname);
const IP_BLOCKED = new Set([101, 150]);
const isPageProblem = (code) => (ENV_ERRORS.has(code) && location.protocol === "file:") || (IP_HOST && IP_BLOCKED.has(code));
function errText(code) {
  switch (code) {
    case 2: return "Invalid video id";
    case 5: return "The HTML5 player could not play this video";
    case 100: return "Video removed or private";
    case 101:
    case 150: return "Won't play embedded (embedding disabled, or the video is gone)";
    case 152:
    case 153: return "YouTube refused to embed the player on this page";
    default: return "Player error";
  }
}
const errorOf = (vid) => doc.errors[vid] || null;
function recordError(vid, code) {
  const e = { code, at: Date.now() };
  doc.errors[vid] = e;
  saveLocal();
  Sync.pushError(vid, e);
}
function clearError(vid) {
  if (!doc.errors[vid]) return;
  delete doc.errors[vid];
  saveLocal();
  Sync.pushError(vid, null);
}

/* ---- flags / derived info ---- */
function videoMeta(c, vid) {
  if (vid === c.youtube_id) {
    return {
      id: vid,
      original: true,
      title: c.oembed_title || "",
      channel: c.channel || c.oembed_author || "",
      badge: c.channel_badge || "",
      views: viewsOf(c),
      length: Number.isFinite(c.length) ? c.length : null,
      upload: c.upload_date || "",
      heat: Array.isArray(c.heat) ? c.heat : null,
      hook: Number.isFinite(c.suggested_start) ? c.suggested_start : null,
      why: "",
    };
  }
  const a = c.alternatives.find((x) => x.youtube_id === vid) || {};
  return {
    id: vid,
    original: false,
    title: a.yt_title || a.title || "",
    channel: a.channel || "",
    badge: a.channel_badge || "",
    views: Number.isFinite(a.views) ? a.views : null,
    length: Number.isFinite(a.length) ? a.length : null,
    upload: a.upload_date || "",
    heat: Array.isArray(a.heat) ? a.heat : null,
    hook: Number.isFinite(a.suggested_start) ? a.suggested_start : null,
    why: a.why || "",
  };
}
function viewsOf(c) {
  if (Number.isFinite(c.views)) return c.views;
  const m = /([\d.]+)\s*([KMB])?\s*views/i.exec(c.notes || "");
  if (!m) return null;
  return parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1);
}
const LEGACY_STATUS = {
  "check-title": "YouTube's title doesn't clearly match the proposed title — check it.",
  "check-artist": "YouTube's title/channel doesn't clearly name the proposed artist — check it.",
  mismatch: "YouTube's title and channel don't match the proposal — possibly the wrong video.",
  duplicate: "Already in the catalog.",
};
/** All flags for a candidate: batch flags, legacy verify.py status, live checks. */
function flagsOf(c) {
  const out = c.flags.map((f) => ({ level: f.level === "warn" ? "warn" : f.level === "error" ? "error" : "info", text: f.text }));
  if (c.valid === false) out.push({ level: "warn", text: "oEmbed check failed — the id may be dead, private or not embeddable." });
  if (LEGACY_STATUS[c.match_status]) out.push({ level: "warn", text: LEGACY_STATUS[c.match_status] });
  const err = errorOf(effVideo(c));
  if (err && !ENV_ERRORS.has(err.code)) out.push({ level: "error", text: `${errText(err.code)} (YouTube error ${err.code}) — this video will not play in the game.` });
  if (effGenres(c).length === 0) out.push({ level: "error", text: "No genre selected — the importer rejects a row without one." });
  return out;
}
function isFlagged(c) {
  return c.confidence === "low" || flagsOf(c).some((f) => f.level !== "info");
}

/* ===================================================================
 * view state
 * =================================================================== */
const S = {
  filter: "all",
  query: "",
  sort: "batch",
  list: [],
  cur: null,
  preview: null, // a video id being auditioned that is not (yet) in use
  undo: [],
};
const activeVid = () => (S.preview ? S.preview : S.cur ? effVideo(S.cur) : null);

function matchesQuery(c, q) {
  if (!q) return true;
  const r = c.request || {};
  const hay = [
    effTitle(c), effArtist(c), c.oembed_title, c.channel, c.oembed_author, effGenres(c).join(" "),
    r.line, r.title, r.artist, c.notes, c.youtube_id, effYear(c),
  ].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
function inFilter(c, f) {
  const st = statusOf(c);
  if (f === "pending") return !st;
  if (f === "approved") return st === "approved";
  if (f === "rejected") return st === "rejected";
  if (f === "flagged") return isFlagged(c);
  return true;
}
function computeList() {
  const q = S.query.trim().toLowerCase();
  const list = cands.filter((c) => inFilter(c, S.filter) && matchesQuery(c, q));
  const by = {
    flagged: (a, b) => isFlagged(b) - isFlagged(a) || a._i - b._i,
    "views-desc": (a, b) => (viewsOf(b) ?? -1) - (viewsOf(a) ?? -1) || a._i - b._i,
    "views-asc": (a, b) => (viewsOf(a) ?? Infinity) - (viewsOf(b) ?? Infinity) || a._i - b._i,
    title: (a, b) => effTitle(a).localeCompare(effTitle(b)) || a._i - b._i,
  }[S.sort];
  if (by) list.sort(by);
  return list;
}

/* ===================================================================
 * queue
 * =================================================================== */
function rowHtml(c) {
  const st = statusOf(c);
  const vid = effVideo(c);
  const icons = [];
  const err = errorOf(vid);
  if (err && !ENV_ERRORS.has(err.code)) icons.push(`<span class="err" title="${esc(errText(err.code))}">⚠</span>`);
  else if (isFlagged(c)) icons.push('<span title="Flagged — see the warnings">⚑</span>');
  if (rec(c).video) icons.push('<span class="swap" title="Using a different video">⇄</span>');
  const cls = ["q-row", st ? `is-${st}` : "", c === S.cur ? "is-current" : ""].filter(Boolean).join(" ");
  return `<li class="${cls}" data-key="${esc(c._key)}">
    <span class="q-idx">${c._i + 1}</span>
    <img class="q-thumb" src="${esc(thumbUrl(vid))}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" />
    <div class="q-text">
      <div class="q-title" dir="auto">${esc(effTitle(c)) || "<i>untitled</i>"}</div>
      <div class="q-artist"><span dir="auto">${esc(effArtist(c))}</span>${icons.length ? `<span class="q-icons">${icons.join(" ")}</span>` : ""}</div>
    </div>
    <span class="q-status" title="${st || "pending"}"></span>
  </li>`;
}
function renderQueue() {
  S.list = computeList();
  el.queueList.innerHTML = S.list.length
    ? S.list.map(rowHtml).join("")
    : `<li class="q-empty">No songs match${S.query ? ` “${esc(S.query)}”` : ""} in <b>${esc(S.filter)}</b>.</li>`;
  el.queueCount.textContent = `${S.list.length} shown`;
  scrollCurrentIntoView();
}
function updateRow(c) {
  const li = el.queueList.querySelector(`[data-key="${CSS.escape(c._key)}"]`);
  if (li) li.outerHTML = rowHtml(c);
}
function markCurrentRow() {
  el.queueList.querySelectorAll(".q-row.is-current").forEach((li) => li.classList.remove("is-current"));
  if (!S.cur) return;
  const li = el.queueList.querySelector(`[data-key="${CSS.escape(S.cur._key)}"]`);
  if (li) li.classList.add("is-current");
  scrollCurrentIntoView();
}
function scrollCurrentIntoView() {
  if (!S.cur) return;
  const li = el.queueList.querySelector(`[data-key="${CSS.escape(S.cur._key)}"]`);
  if (!li) return;
  const box = el.queueList.getBoundingClientRect();
  const r = li.getBoundingClientRect();
  if (r.top < box.top + 4 || r.bottom > box.bottom - 4) {
    el.queueList.scrollTop += r.top - box.top - box.height / 2 + r.height / 2;
  }
}
function renderProgress() {
  let ok = 0;
  let bad = 0;
  let flagged = 0;
  for (const c of cands) {
    const st = statusOf(c);
    if (st === "approved") ok++;
    else if (st === "rejected") bad++;
    if (isFlagged(c)) flagged++;
  }
  const total = cands.length;
  const pending = total - ok - bad;
  el.pbOk.style.width = `${total ? (ok / total) * 100 : 0}%`;
  el.pbBad.style.width = `${total ? (bad / total) * 100 : 0}%`;
  el.progressText.innerHTML = `<b>${ok + bad}</b>/${total} reviewed · <span class="ok">${ok} ✓</span> · <span class="bad">${bad} ✕</span> · ${pending} left`;
  const counts = { all: total, pending, approved: ok, rejected: bad, flagged };
  el.filters.querySelectorAll("button").forEach((b) => {
    b.querySelector("b").textContent = counts[b.dataset.filter];
  });
  el.allDone.hidden = !(total && pending === 0);
  if (!el.allDone.hidden) el.allDone.textContent = `All ${total} songs reviewed — ${ok} approved. Export the CSV when you're ready.`;
  document.title = `${pending ? `(${pending}) ` : "✓ "}Song review · ${BATCH_LABEL}`;
}

/* ===================================================================
 * stage: head, timeline, controls
 * =================================================================== */
function renderHead() {
  const c = S.cur;
  if (!c) {
    el.head.innerHTML = "";
    return;
  }
  const pos = S.list.indexOf(c);
  const posHtml = pos >= 0 ? `${pos + 1}<span>/${S.list.length}</span>` : `#${c._i + 1}`;
  if (S.preview) {
    const m = videoMeta(c, S.preview);
    el.head.innerHTML = `<div class="sh-pos">${posHtml}</div>
      <div class="preview-line">
        <span class="pl-text">Previewing another upload: <b dir="auto">${esc(m.title || S.preview)}</b> · ${esc(m.channel)}</span>
        <button type="button" class="btn btn-approve" style="height:30px;padding:0 12px;font-size:13px" data-use="${esc(S.preview)}">Use this video</button>
        <button type="button" class="btn" style="height:30px" data-preview-back>Back</button>
      </div>`;
    return;
  }
  const st = statusOf(c);
  const year = effYear(c);
  const genres = effGenres(c);
  el.head.innerHTML = `<div class="sh-pos">${posHtml}</div>
    <div class="sh-main"><span class="sh-title" dir="auto">${esc(effTitle(c)) || "<i>untitled</i>"}</span><span class="sh-sep">—</span><span class="sh-artist" dir="auto">${esc(effArtist(c))}</span></div>
    <div class="sh-tags">
      ${year ? `<span class="tag">${year}</span>` : ""}
      ${genres.length ? genres.map((g) => `<span class="tag genre">${esc(GENRE_LABEL[g])}</span>`).join("") : '<span class="tag warn">no genre</span>'}
      <span class="status-pill ${st || ""}">${st || "pending"}</span>
    </div>`;
}

function duration() {
  if (YTP.duration > 0 && YTP.vid === activeVid()) return YTP.duration;
  const c = S.cur;
  if (!c) return 0;
  const m = videoMeta(c, activeVid());
  if (m.length) return m.length;
  if (m.heat && m.heat.length) return Math.max(...m.heat.map((p) => p[0] || 0)) + 1;
  return 0;
}
function heatPath(heat, dur) {
  const pts = heat
    .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([s, v]) => [clamp(s / dur, 0, 1) * 1000, 100 - clamp(v, 0, 1) * 90])
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return "";
  let d = `M0,100 L0,${pts[0][1].toFixed(1)}`;
  for (const [x, y] of pts) d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
  return `${d} L1000,${pts[pts.length - 1][1].toFixed(1)} L1000,100 Z`;
}
function placeMark(node, t, dur) {
  const p = dur > 0 ? clamp(t / dur, 0, 1) * 100 : 0;
  node.style.left = `${p}%`;
  node.classList.toggle("flip", p > 88);
}
function renderTimeline() {
  const c = S.cur;
  if (!c) return;
  const m = videoMeta(c, activeVid());
  const dur = duration();
  const heat = m.heat && m.heat.length > 2 ? m.heat : null;
  el.timeline.classList.toggle("no-heat", !heat);
  el.tlPath.setAttribute("d", heat && dur > 0 ? heatPath(heat, dur) : "");
  el.tlStart.hidden = !(dur > 0);
  placeMark(el.tlStart, effStart(c), dur);
  el.tlStart.querySelector("b").textContent = `S ${fmtTime(effStart(c))}`;
  el.tlHook.hidden = !(m.hook !== null && dur > 0);
  if (!el.tlHook.hidden) placeMark(el.tlHook, m.hook, dur);
  el.tlLabelL.textContent = "";
  el.tlLabelR.textContent = `${heat ? "most replayed · " : ""}${dur > 0 ? fmtTime(dur) : ""}`;
  el.timeline.dataset.dur = String(dur);
}
function renderControls() {
  const c = S.cur;
  if (!c) return;
  const start = effStart(c);
  if (document.activeElement !== el.startInput) el.startInput.value = fmtTime(start);
  el.startInput.classList.toggle("edited", start !== origStart(c));
  el.startInput.classList.remove("bad");
  el.startReset.hidden = start === origStart(c);
  el.startReset.title = `Back to the proposed start (${fmtTime(origStart(c))})`;
  const m = videoMeta(c, activeVid());
  el.btnHook.hidden = m.hook === null;
  if (m.hook !== null) el.hookTime.textContent = fmtTime(m.hook);
  const st = statusOf(c);
  el.btnApprove.classList.toggle("is-on", st === "approved");
  el.btnReject.classList.toggle("is-on", st === "rejected");
  el.btnApprove.setAttribute("aria-pressed", String(st === "approved"));
  el.btnReject.setAttribute("aria-pressed", String(st === "rejected"));
}

/* ===================================================================
 * details panel
 * =================================================================== */
function renderDetails() {
  const c = S.cur;
  if (!c) {
    el.details.innerHTML = "";
    return;
  }
  const r = rec(c);
  const vid = effVideo(c);
  const m = videoMeta(c, vid);
  const flags = flagsOf(c);
  const genres = new Set(effGenres(c));
  const genresEdited = !!r.genres;
  const year = effYear(c);
  const req = c.request && typeof c.request === "object" ? c.request : null;
  const field = (name, label, value, orig, edited, extra = "") => `
    <div class="field">
      <label for="f-${name}">${label}${edited ? `<span class="orig" title="${esc(orig)}" dir="auto">was: ${esc(orig) || "—"}</span>` : ""}</label>
      <div class="field-input">
        <input id="f-${name}" name="${name}" value="${esc(value)}" dir="auto" autocomplete="off" spellcheck="false" class="${edited ? "edited" : ""}" ${extra} />
        ${edited ? `<button type="button" class="btn-reset" data-reset="${name}" title="Back to: ${esc(orig) || "—"}">↺</button>` : ""}
      </div>
    </div>`;
  const badge = m.badge === "artist" ? '<span class="badge-artist" title="Official Artist Channel">♪ ARTIST</span>' : m.badge === "verified" ? '<span class="badge-verified" title="Verified channel">✓ VERIFIED</span>' : "";
  const facts = [
    m.views !== null ? `${fmtViews(m.views)} views` : "",
    m.upload ? `uploaded ${esc(m.upload)}` : "",
    m.length ? fmtTime(m.length) : "",
  ].filter(Boolean).join(" · ");
  const confidence = c.confidence ? `<span class="conf ${esc(c.confidence)}">${esc(c.confidence)}</span>` : "";
  const reqDiffers = req && ((req.title && req.title.trim().toLowerCase() !== effTitle(c).trim().toLowerCase()) || (req.artist && req.artist.trim().toLowerCase() !== effArtist(c).trim().toLowerCase()));
  el.details.innerHTML = `
    ${flags.length ? `<div class="panel"><h3>Check</h3><div class="flags">${flags.map((f) => `<div class="flag ${f.level}" dir="auto">${esc(f.text)}</div>`).join("")}</div></div>` : ""}
    <div class="panel" id="edit-panel">
      <h3>Song</h3>
      ${field("title", "Title", effTitle(c), c.title, r.title !== undefined)}
      ${field("artist", "Artist", effArtist(c), c.artist, r.artist !== undefined)}
      <div class="field-year">
        ${field("release_year", "Year", year ?? "", origYear(c) ?? "", "release_year" in r, 'inputmode="numeric" maxlength="4" placeholder="unknown"')}
      </div>
      <div class="field">
        <span class="label">Genres ${genresEdited ? `<span class="orig">was: ${esc(origGenres(c).map((g) => GENRE_LABEL[g]).join(", ") || "none")}</span><button type="button" class="btn-reset" data-reset="genres" title="Back to the proposed genres">↺</button>` : ""}</span>
      </div>
      <div class="chips ${genres.size ? "" : "empty"}" id="genre-chips">
        ${GENRES.map(([slug, label]) => `<button type="button" class="chip ${genres.has(slug) ? "on" : ""}" data-genre="${slug}" aria-pressed="${genres.has(slug)}">${esc(label)}</button>`).join("")}
      </div>
    </div>
    <div class="panel">
      <h3>On YouTube ${YTP.played.has(vid) ? '<span class="played-ok">▶ played here OK</span>' : ""}</h3>
      <dl class="kv">
        <dt>Title</dt><dd class="yt-title" dir="auto">${esc(m.title) || '<span class="muted">—</span>'}</dd>
        <dt>Channel</dt><dd dir="auto">${esc(m.channel) || '<span class="muted">—</span>'}${badge}</dd>
        ${facts ? `<dt>Facts</dt><dd>${facts}</dd>` : ""}
        <dt>Video</dt><dd><a href="${esc(watchUrl(vid, effStart(c)))}" target="_blank" rel="noreferrer">${esc(vid)} ↗</a>${vid !== c.youtube_id ? ' <span class="muted small">(swapped from ' + esc(c.youtube_id) + ")</span>" : ""}</dd>
      </dl>
    </div>
    ${req || c.notes || confidence || c.group || c.source ? `<div class="panel">
      <h3>Research</h3>
      ${req ? `<div class="request-line" dir="auto"><span class="muted small">Asked for:</span> ${esc(typeof req.line === "string" && req.line ? req.line : [req.title, req.artist].filter(Boolean).join(" — "))}${typeof req.line === "number" ? ` <span class="muted small">(line ${req.line})</span>` : ""}${reqDiffers ? '<br><span class="small" style="color:var(--warning)">differs from the current title/artist</span>' : ""}</div>` : ""}
      <dl class="kv">
        ${c.notes ? `<dt>Notes</dt><dd dir="auto">${esc(c.notes)}</dd>` : ""}
        ${confidence ? `<dt>Confidence</dt><dd>${confidence}</dd>` : ""}
        ${c.group || c.source ? `<dt>Source</dt><dd class="small muted" dir="auto">${esc([c.group, c.source].filter(Boolean).join(" · "))}${c.source_url ? ` <a href="${esc(c.source_url)}" target="_blank" rel="noreferrer">↗</a>` : ""}</dd>` : ""}
      </dl>
    </div>` : ""}`;
}

/** Refresh everything that shows the current song's values (not the inputs being typed in). */
function refreshCurrentViews({ details = false } = {}) {
  const c = S.cur;
  if (!c) return;
  renderHead();
  renderControls();
  renderTimeline();
  updateRow(c);
  markCurrentRow();
  renderProgress();
  if (details) renderDetails();
}

/* ===================================================================
 * alternatives
 * =================================================================== */
function renderAlts() {
  const c = S.cur;
  if (!c || !c.alternatives.length) {
    el.alts.hidden = true;
    el.alts.innerHTML = "";
    return;
  }
  const inUse = effVideo(c);
  const vids = [c.youtube_id, ...c.alternatives.map((a) => a.youtube_id).filter((v) => v !== c.youtube_id)];
  const tile = (vid) => {
    const m = videoMeta(c, vid);
    const err = errorOf(vid);
    const using = vid === inUse;
    const previewing = vid === S.preview;
    const meta = [m.channel, m.views !== null ? `${fmtViews(m.views)} views` : "", m.upload ? m.upload.slice(0, 4) : ""].filter(Boolean).map(esc).join(" · ");
    return `<div class="alt ${using ? "in-use" : ""} ${previewing ? "previewing" : ""}">
      <button type="button" class="alt-thumb" data-preview="${esc(vid)}" title="Preview this upload">
        <img src="${esc(thumbUrl(vid))}" loading="lazy" alt="" onerror="this.style.visibility='hidden'" />
        ${using ? '<span class="alt-badge">In use</span>' : m.original ? '<span class="alt-badge orig">Proposed</span>' : ""}
        ${m.length ? `<span class="alt-len">${fmtTime(m.length)}</span>` : ""}
      </button>
      <div class="alt-title" dir="auto">${esc(m.title || vid)}</div>
      <div class="alt-meta" dir="auto">${meta}${m.badge ? ` · ${m.badge === "artist" ? "♪ artist" : "✓ verified"}` : ""}</div>
      ${m.why ? `<div class="alt-why" dir="auto">${esc(m.why)}</div>` : ""}
      ${err && !ENV_ERRORS.has(err.code) ? `<div class="alt-why" style="color:var(--negative-text)">⚠ ${esc(errText(err.code))}</div>` : ""}
      <div class="alt-actions">
        ${using ? `<button type="button" class="btn" data-preview="${esc(vid)}">▶ Play</button>` : `<button type="button" class="btn" data-preview="${esc(vid)}">▶ Preview</button><button type="button" class="btn btn-use" data-use="${esc(vid)}">${m.original ? "Switch back" : "Use this video"}</button>`}
      </div>
    </div>`;
  };
  el.alts.hidden = false;
  el.alts.innerHTML = `<div class="alts-head"><h3>Other uploads of this song</h3><span>${c.alternatives.length} alternative${c.alternatives.length === 1 ? "" : "s"} · preview one, then “Use this video” to export it instead</span></div>
    <div class="alt-row">${vids.map(tile).join("")}</div>`;
}
function previewVideo(vid) {
  const c = S.cur;
  if (!c) return;
  if (vid === effVideo(c)) {
    S.preview = null;
    loadInPlayer(vid, effStart(c), true);
  } else {
    S.preview = vid;
    const m = videoMeta(c, vid);
    loadInPlayer(vid, m.hook ?? effStart(c), true);
  }
  renderHead();
  renderControls();
  renderTimeline();
  renderAlts();
  layout();
}
function useVideo(vid) {
  const c = S.cur;
  if (!c) return;
  const wasStartEdited = rec(c).start_time !== undefined;
  update(c, (r) => {
    r.video = vid;
  });
  const playing = YTP.vid === vid;
  S.preview = null;
  if (!playing) loadInPlayer(vid, effStart(c), true);
  refreshCurrentViews({ details: true });
  renderAlts();
  layout();
  const m = videoMeta(c, vid);
  toast(
    vid === c.youtube_id
      ? "Back to the proposed video."
      : `Using <b>${esc(m.channel || vid)}</b>'s upload.${wasStartEdited ? "" : " Check the start time — it was picked for the other video."}`,
    "ok",
    3500,
  );
}

/* ===================================================================
 * YouTube player — embedded exactly like the game's YouTubePlayer.tsx
 * (youtube-nocookie host, enablejsapi + origin, rel=0, playsinline, hl=en;
 * the iframe is created first and YT.Player attaches after its load event).
 * Deliberate differences: controls=1 and the player keyboard left on, so
 * the reviewer can scrub inside the player. Neither affects embeddability.
 * =================================================================== */
const YTP = { player: null, ready: false, vid: null, want: null, iframe: null, duration: 0, state: -1, played: new Set() };

function initPlayer() {
  const q = new URLSearchParams({ enablejsapi: "1", modestbranding: "1", rel: "0", controls: "1", playsinline: "1", hl: "en" });
  if (/^https?:$/.test(location.protocol)) q.set("origin", location.origin);
  const iframe = document.createElement("iframe");
  iframe.src = `https://www.youtube-nocookie.com/embed/?${q}`;
  iframe.title = "YouTube player";
  iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
  el.playerBox.prepend(iframe);
  YTP.iframe = iframe;

  const apiReady = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = () => {
        el.playerMsg.textContent = "Could not load the YouTube player API — check the network connection.";
      };
      document.head.appendChild(s);
    }
  });
  const frameLoaded = new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));
  Promise.all([apiReady, frameLoaded]).then(() => {
    YTP.player = new window.YT.Player(iframe, {
      events: {
        onReady: () => {
          YTP.ready = true;
          el.playerMsg.hidden = true;
          if (YTP.want) {
            const w = YTP.want;
            YTP.want = null;
            loadInPlayer(w.vid, w.start, w.play);
          }
        },
        onError: (e) => onPlayerError(e.data),
        onStateChange: (e) => onPlayerState(e.data),
      },
    });
  });
}

function loadInPlayer(vid, start, play) {
  YTP.vid = vid;
  YTP.duration = 0;
  hideAlert();
  if (!YTP.ready) {
    YTP.want = { vid, start, play };
    return;
  }
  const known = errorOf(vid);
  if (known) showAlert(known.code, vid, true);
  YTP.req = { vid, start: Math.max(0, start || 0), play, at: Date.now(), tries: 0 };
  issueLoad();
}
function issueLoad() {
  const q = YTP.req;
  const opts = { videoId: q.vid, startSeconds: q.start };
  if (q.play) YTP.player.loadVideoById(opts);
  else YTP.player.cueVideoById(opts);
}
/** The IFrame API can drop a load issued while a previous cue/load is still
 * settling (e.g. clicking a song right after the player becomes ready).
 * If the player still holds another video a moment later, ask again. */
function reconcileLoad() {
  const q = YTP.req;
  if (!q || q.vid !== YTP.vid || Date.now() - q.at < 1200 || q.tries >= 3 || errorOf(q.vid)) return;
  q.tries++;
  q.at = Date.now();
  issueLoad();
}
/** Same race, other symptom: the right video arrives but stays cued. */
function reconcilePlay(state) {
  const q = YTP.req;
  if (!q || !q.play || q.started || q.vid !== YTP.vid) return;
  if (state === STATE_PLAYING) {
    q.started = true;
    return;
  }
  if ((state === 5 || state === -1) && Date.now() - q.at > 1000 && (q.kicks || 0) < 2) {
    q.kicks = (q.kicks || 0) + 1;
    q.at = Date.now();
    playerCall((p) => p.playVideo());
  }
}
function onPlayerState(state) {
  YTP.state = state;
  if (state === STATE_PLAYING && YTP.vid) {
    const first = !YTP.played.has(YTP.vid);
    YTP.played.add(YTP.vid);
    if (errorOf(YTP.vid)) {
      clearError(YTP.vid); // it plays now: the old error was transient
      if (S.cur) refreshCurrentViews({ details: true });
      renderAlts();
    } else if (first && S.cur && YTP.vid === effVideo(S.cur)) {
      const h = el.details.querySelector(".panel h3");
      if (h) renderDetailsKeepFocus();
    }
    hideAlert();
  }
  updatePlayButton();
}
function onPlayerError(code) {
  const vid = YTP.vid;
  if (!vid) return;
  showAlert(code, vid, false);
  if (isPageProblem(code)) return; // the page's address is the problem, not the video
  recordError(vid, code);
  if (S.cur) {
    refreshCurrentViews();
    renderDetailsKeepFocus();
    renderAlts();
  }
}
function showAlert(code, vid, remembered) {
  const c = S.cur;
  const env = isPageProblem(code);
  const alts = c ? [c.youtube_id, ...c.alternatives.map((a) => a.youtube_id)].filter((v) => v !== vid && !errorOf(v)) : [];
  const alt = alts.length ? videoMeta(c, alts[0]) : null;
  const local = new URL(location.href);
  local.hostname = "localhost";
  const envText = IP_HOST
    ? `YouTube blocks some videos on an IP address — open <a href="${esc(local.href)}">${esc(local.host)}</a> instead (not recorded as a video problem).`
    : "Pages opened as a file can't embed YouTube reliably: run <code>review_server.py</code> and open the page from it.";
  el.playerAlert.innerHTML = `<span>⚠ <b>${esc(errText(code))}</b> (YouTube error ${code})${remembered ? " — seen last time, retrying…" : ""}.
      ${env ? envText : "This video will not play in the game."}</span>
    ${!env && alt ? `<button type="button" class="btn" data-preview="${esc(alt.id)}">▶ Try ${esc(alt.channel || "the other upload")}</button>` : ""}
    <a class="btn" href="${esc(watchUrl(vid))}" target="_blank" rel="noreferrer">Open on YouTube ↗</a>`;
  el.playerAlert.hidden = false;
}
function hideAlert() {
  el.playerAlert.hidden = true;
}
function playerCall(fn, fallback) {
  try {
    return fn(YTP.player);
  } catch {
    return fallback;
  }
}
/** Make sure the player holds the video we think is active. */
function ensureLoaded(start, play = true) {
  const vid = activeVid();
  if (!vid) return false;
  if (YTP.vid !== vid || !YTP.ready) {
    loadInPlayer(vid, start, play);
    return false;
  }
  return true;
}
function seek(t, play = true) {
  if (!S.cur) return;
  if (!ensureLoaded(t, play)) return;
  const d = duration();
  t = clamp(t, 0, d > 1 ? d - 0.5 : Math.max(t, 0));
  playerCall((p) => {
    p.seekTo(t, true);
    const st = p.getPlayerState();
    if (play && st !== STATE_PLAYING && st !== STATE_BUFFERING) p.playVideo();
  });
}
function seekBy(delta) {
  const t = playerCall((p) => p.getCurrentTime(), 0) || 0;
  seek(t + delta, YTP.state === STATE_PLAYING || YTP.state === STATE_BUFFERING);
}
function togglePlay() {
  if (!S.cur) return;
  if (!ensureLoaded(effStart(S.cur), true)) return;
  const st = playerCall((p) => p.getPlayerState(), -1);
  if (st === STATE_PLAYING || st === STATE_BUFFERING) {
    if (YTP.req) YTP.req.started = true; // the reviewer paused: no auto-play nudges
    playerCall((p) => p.pauseVideo());
  } else if (st === STATE_ENDED) seek(effStart(S.cur));
  else playerCall((p) => p.playVideo());
}
function playFromStart() {
  if (S.cur) seek(effStart(S.cur), true);
}
function jumpTenth(n) {
  const d = duration();
  if (d > 0) seek((d * n) / 10, true);
}
function updatePlayButton() {
  const playing = YTP.state === STATE_PLAYING || YTP.state === STATE_BUFFERING;
  el.btnPlay.textContent = playing ? "❚❚" : "▶";
}

/* live clock + playhead */
function tick() {
  if (!YTP.ready || !S.cur || YTP.vid !== activeVid()) return;
  const data = playerCall((p) => (p.getVideoData ? p.getVideoData() : null), null);
  if (data && data.video_id && data.video_id !== YTP.vid) {
    reconcileLoad(); // still showing the previous video: don't report its clock
    return;
  }
  reconcilePlay(playerCall((p) => p.getPlayerState(), -1));
  const t = playerCall((p) => p.getCurrentTime(), 0) || 0;
  const d = playerCall((p) => p.getDuration(), 0) || 0;
  if (d > 0 && Math.abs(d - YTP.duration) > 0.5) {
    YTP.duration = d;
    renderTimeline();
  }
  const dur = duration();
  const pct = dur > 0 ? clamp(t / dur, 0, 1) * 100 : 0;
  el.tlPlayhead.style.left = `${pct}%`;
  el.tlPlayed.style.width = `${pct}%`;
  el.clock.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
}

/* ===================================================================
 * actions
 * =================================================================== */
function select(c, { play = true } = {}) {
  if (!c) return;
  S.cur = c;
  S.preview = null;
  LS.set(`${KEY}:cursor`, c._key);
  renderHead();
  renderControls();
  renderDetails();
  renderAlts();
  markCurrentRow();
  loadInPlayer(effVideo(c), effStart(c), play);
  renderTimeline();
  el.clock.textContent = `${fmtTime(effStart(c))} / ${fmtTime(duration())}`;
  el.tlPlayhead.style.left = "0%";
  el.tlPlayed.style.width = "0%";
  layout();
}
function move(step) {
  if (!S.list.length) return;
  let i = S.list.indexOf(S.cur);
  if (i < 0) i = step > 0 ? -1 : S.list.length;
  const j = i + step;
  if (j < 0 || j >= S.list.length) {
    toast(step > 0 ? "End of the list." : "Start of the list.", "", 1200);
    return;
  }
  select(S.list[j]);
}
/** After a decision: the next pending song in the current view (wrapping),
 * else (in a non-pending view) simply the next song in the view. */
function pickNext(c, view) {
  const i = view.indexOf(c);
  const order = i >= 0 ? [...view.slice(i + 1), ...view.slice(0, i)] : view;
  const pending = order.find((x) => x !== c && !statusOf(x));
  if (pending) return pending;
  if (S.filter !== "all" && S.filter !== "pending" && i >= 0 && i + 1 < view.length) return view[i + 1];
  if (S.filter !== "all") return cands.find((x) => x !== c && !statusOf(x)) || null;
  return null;
}
function decide(status) {
  const c = S.cur;
  if (!c) return;
  const prev = statusOf(c);
  const view = S.list.slice();
  update(c, (r) => {
    r.status = status;
  });
  if (prev !== status) S.undo.push({ key: c._key, prev });
  if (S.undo.length > 300) S.undo.shift();
  const label = `<b dir="auto">${esc(effTitle(c))}</b>`;
  if (status === "approved") {
    const err = errorOf(effVideo(c));
    if (effGenres(c).length === 0) toast(`Approved ${label} without a genre — pick one before exporting.`, "warn", 4000);
    else if (err) toast(`Approved ${label}, but its video failed to play (${err.code}).`, "warn", 4000);
    else toast(`✓ Approved ${label}`, "ok", 1400);
  } else {
    toast(`✕ Rejected ${label}`, "bad", 1400);
  }
  const next = pickNext(c, view);
  renderQueue();
  renderProgress();
  if (next) {
    select(next);
  } else {
    refreshCurrentViews();
    if (!cands.some((x) => !statusOf(x))) toast(`All ${cands.length} songs reviewed 🎉 — export the CSV when you're ready.`, "ok", 5000);
  }
}
function undo() {
  const c = S.cur;
  const last = S.undo[S.undo.length - 1];
  // On a decided song that isn't the last decision: just put it back to pending.
  if (c && statusOf(c) && (!last || last.key !== c._key)) {
    S.undo.push({ key: c._key, prev: statusOf(c) });
    update(c, (r) => {
      r.status = null;
    });
    toast(`<b dir="auto">${esc(effTitle(c))}</b> is pending again.`, "", 1800);
    renderQueue();
    refreshCurrentViews();
    return;
  }
  const u = S.undo.pop();
  if (!u) {
    toast("Nothing to undo.", "", 1200);
    return;
  }
  const t = byKey.get(u.key);
  if (!t) return;
  update(t, (r) => {
    r.status = u.prev || null;
  });
  toast(`Undone — <b dir="auto">${esc(effTitle(t))}</b> is ${u.prev || "pending"} again.`, "", 2200);
  renderQueue();
  renderProgress();
  if (t === S.cur) refreshCurrentViews();
  else select(t);
}
function setStart(t, { audition = true, quiet = false } = {}) {
  const c = S.cur;
  if (!c || !Number.isFinite(t)) return;
  const d = duration();
  t = Math.max(0, Math.round(t));
  if (d > 2 && t > d - 1) t = Math.floor(d - 1);
  update(c, (r) => {
    r.start_time = t;
  });
  renderControls();
  renderTimeline();
  updateRow(c);
  markCurrentRow();
  if (!quiet) toast(`Start = <b>${fmtTime(t)}</b>`, "", 1100);
  if (audition) seek(t, true);
}
function setStartNow() {
  if (!S.cur || !YTP.ready || YTP.vid !== activeVid()) return;
  const t = Math.floor(playerCall((p) => p.getCurrentTime(), 0) || 0);
  setStart(t, { audition: false });
}
function nudge(delta) {
  if (S.cur) setStart(effStart(S.cur) + delta, { audition: true, quiet: true });
}
function useHook() {
  const c = S.cur;
  if (!c) return;
  const m = videoMeta(c, activeVid());
  if (m.hook === null) {
    toast("No hook data for this video.", "", 1400);
    return;
  }
  setStart(m.hook, { audition: true });
}
function focusField(name) {
  const input = el.details.querySelector(`[name="${name}"]`);
  if (!input) return;
  input.scrollIntoView({ block: "nearest", behavior: "smooth" });
  input.focus();
  input.select();
}

/* ===================================================================
 * detail edits
 * =================================================================== */
function renderDetailsKeepFocus() {
  const a = document.activeElement;
  const name = a && el.details.contains(a) ? a.getAttribute("name") : null;
  const sel = name && a.selectionStart !== undefined ? [a.selectionStart, a.selectionEnd] : null;
  renderDetails();
  if (name) {
    const n = el.details.querySelector(`[name="${name}"]`);
    if (n) {
      n.focus();
      if (sel) n.setSelectionRange(sel[0], sel[1]);
    }
  }
}
function syncFieldMarks(input, edited, orig) {
  input.classList.toggle("edited", edited);
  const wrap = input.closest(".field");
  const hasReset = !!wrap.querySelector(".btn-reset");
  if (edited !== hasReset) renderDetailsKeepFocus();
  else if (edited) {
    const o = wrap.querySelector(".orig");
    if (o) o.textContent = `was: ${orig || "—"}`;
  }
}
el.details.addEventListener("input", (e) => {
  const c = S.cur;
  const t = e.target;
  if (!c || t.tagName !== "INPUT") return;
  if (t.name === "title" || t.name === "artist") {
    const v = t.value;
    update(c, (r) => {
      r[t.name] = v;
    });
    syncFieldMarks(t, rec(c)[t.name] !== undefined, c[t.name]);
    renderHead();
    updateRow(c);
    markCurrentRow();
  } else if (t.name === "release_year") {
    const s = t.value.trim();
    const ok = s === "" || (/^\d{4}$/.test(s) && +s >= 1900 && +s <= 2100);
    t.classList.toggle("bad", !ok);
    if (!ok) return;
    update(c, (r) => {
      r.release_year = s === "" ? null : +s;
    });
    syncFieldMarks(t, "release_year" in rec(c), String(origYear(c) ?? ""));
    renderHead();
  }
});
el.details.addEventListener("focusout", (e) => {
  const t = e.target;
  if (t.name === "release_year" && t.classList.contains("bad") && S.cur) {
    t.value = effYear(S.cur) ?? "";
    t.classList.remove("bad");
  }
});
el.details.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" && (e.key === "Enter" || e.key === "Escape")) {
    e.preventDefault();
    e.target.blur();
    el.focusSink.focus({ preventScroll: true });
  }
});
el.details.addEventListener("click", (e) => {
  const c = S.cur;
  if (!c) return;
  const chip = e.target.closest("[data-genre]");
  if (chip) {
    const slug = chip.dataset.genre;
    const g = new Set(effGenres(c));
    if (g.has(slug)) g.delete(slug);
    else g.add(slug);
    update(c, (r) => {
      r.genres = GENRES.map(([s]) => s).filter((s) => g.has(s));
    });
    renderDetailsKeepFocus();
    refreshCurrentViews();
    return;
  }
  const reset = e.target.closest("[data-reset]");
  if (reset) {
    const f = reset.dataset.reset;
    update(c, (r) => {
      delete r[f];
    });
    renderDetails();
    refreshCurrentViews();
  }
});

/* ===================================================================
 * export / import / reset
 * =================================================================== */
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv() {
  const approved = cands.filter((c) => statusOf(c) === "approved");
  if (!approved.length) {
    toast("Nothing approved yet.", "warn");
    return;
  }
  const problems = [];
  const lines = [CSV_HEADER.join(",")];
  for (const c of approved) {
    const title = effTitle(c).trim();
    const artist = effArtist(c).trim();
    const vid = effVideo(c);
    const genres = effGenres(c);
    const year = effYear(c);
    const name = `${title || "(no title)"} — ${artist || "(no artist)"}`;
    if (!genres.length) problems.push(`${name}: no genre`);
    if (!title) problems.push(`${name}: empty title`);
    if (!artist) problems.push(`${name}: empty artist`);
    if (!YT_ID.test(vid)) problems.push(`${name}: bad youtube_id ${vid}`);
    const err = errorOf(vid);
    if (err && !ENV_ERRORS.has(err.code)) problems.push(`${name}: video failed to play (error ${err.code})`);
    lines.push([title, artist, vid, effStart(c), genres.join(";"), year ?? ""].map(csvCell).join(","));
  }
  if (problems.length && !confirm(`${problems.length} problem(s) in the approved songs:\n\n${problems.slice(0, 30).join("\n")}${problems.length > 30 ? `\n…and ${problems.length - 30} more` : ""}\n\nRows without a genre, title or artist will be rejected by the importer.\nExport anyway?`)) return;
  const text = `﻿${lines.join("\r\n")}\r\n`;
  const name = `approved-songs-${(KEY_LABEL() || today()).replace(/[^A-Za-z0-9._-]/g, "_")}.csv`;
  download(name, text, "text/csv;charset=utf-8");
  toast(`Exported <b>${approved.length}</b> approved song(s) → ${esc(name)}`, "ok", 3500);
  if (Sync.on) {
    Sync.saveFile(name, text).then((path) => {
      if (path) toast(`Also saved to <code>${esc(path)}</code>`, "ok", 5000);
    });
  }
}
function KEY_LABEL() {
  return window.BATCH && window.BATCH.id ? String(window.BATCH.id) : Sync.batch || BATCH_PARAM || "";
}
function exportJson() {
  const out = {
    format: "song-review/v1",
    batch: KEY,
    batch_dir: Sync.batch || BATCH_PARAM || null,
    exported_at: new Date().toISOString(),
    reset_at: doc.reset_at || 0,
    decisions: doc.decisions,
    errors: doc.errors,
  };
  const name = `decisions-${(KEY_LABEL() || KEY).replace(/[^A-Za-z0-9._-]/g, "_")}-${today()}.json`;
  download(name, JSON.stringify(out, null, 1), "application/json");
  toast(`Saved a backup of ${Object.keys(doc.decisions).length} record(s) → ${esc(name)}`, "ok", 3000);
}
async function importJson(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast("That file isn't valid JSON.", "bad");
    return;
  }
  if (!data || data.format !== "song-review/v1" || typeof data.decisions !== "object") {
    toast("That file isn't a song-review decisions backup.", "bad");
    return;
  }
  if (data.batch && data.batch !== KEY && !confirm(`This backup is for batch “${data.batch}”, but the page shows “${KEY}”.\nImport only the songs both have in common?`)) return;
  let applied = 0;
  let older = 0;
  for (const [k, r] of Object.entries(data.decisions)) {
    const c = byKey.get(k);
    if (!c || !r || typeof r !== "object") continue;
    const mine = doc.decisions[k];
    if (mine && (mine.at || 0) >= (r.at || 0)) {
      older++;
      continue;
    }
    doc.decisions[k] = { ...r, at: Math.max(r.at || 0, doc.reset_at + 1) };
    Sync.push(k, doc.decisions[k]);
    applied++;
  }
  for (const [vid, e] of Object.entries(data.errors || {})) {
    if (e && !doc.errors[vid]) {
      doc.errors[vid] = e;
      Sync.pushError(vid, e);
    }
  }
  saveLocal();
  renderQueue();
  renderProgress();
  if (S.cur) select(S.cur, { play: false });
  toast(`Imported <b>${applied}</b> decision(s)${older ? ` · kept ${older} newer one(s) already here` : ""}.`, "ok", 4000);
}
function resetAll() {
  const n = Object.values(doc.decisions).filter((r) => r.status).length;
  if (!confirm(`Clear ALL decisions and edits for this batch (${n} decided)?${Sync.on ? "\n\nThe server keeps a backup copy of decisions.json." : "\n\nTip: Cancel and use ⋯ → Export decisions first if you might want them back."}`)) return;
  const at = Date.now();
  doc = { decisions: {}, errors: {}, reset_at: at };
  saveLocal();
  Sync.reset(at);
  S.undo = [];
  renderQueue();
  renderProgress();
  if (S.cur) select(S.cur, { play: false });
  toast("All decisions cleared.", "", 2000);
}

/* ===================================================================
 * server sync (only when served by review_server.py)
 * =================================================================== */
const Sync = {
  on: false,
  batch: null,
  file: "",
  foreign: false,
  note: "",
  state: "local",
  out: { changes: {}, errors: {}, reset: 0 },
  timer: 0,
  busy: false,
  lastOk: 0,
  lastError: "",
  outKey() {
    return `${KEY}:outbox:${Sync.batch}`;
  },
  loadOut() {
    try {
      const o = JSON.parse(LS.get(Sync.outKey()) || "null");
      if (o && typeof o === "object") Sync.out = { changes: o.changes || {}, errors: o.errors || {}, reset: o.reset || 0 };
    } catch {
      /* ignore */
    }
  },
  saveOut() {
    LS.set(Sync.outKey(), JSON.stringify(Sync.out));
  },
  pending() {
    return Object.keys(Sync.out.changes).length + Object.keys(Sync.out.errors).length + (Sync.out.reset ? 1 : 0);
  },
  push(key, r) {
    if (!Sync.on) return;
    Sync.out.changes[key] = r;
    Sync.saveOut();
    Sync.schedule(350);
  },
  pushError(vid, e) {
    if (!Sync.on) return;
    Sync.out.errors[vid] = e;
    Sync.saveOut();
    Sync.schedule(350);
  },
  reset(at) {
    if (!Sync.on) return;
    Sync.out = { changes: {}, errors: {}, reset: at };
    Sync.saveOut();
    Sync.schedule(0);
  },
  schedule(ms) {
    clearTimeout(Sync.timer);
    Sync.timer = setTimeout(Sync.flush, ms);
    if (Sync.state !== "error") Sync.state = "saving";
    Sync.pill();
  },
  api(path) {
    return `/api/${path}?batch=${encodeURIComponent(Sync.batch)}`;
  },
  async post(body) {
    const r = await fetch(Sync.api("decisions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 409) {
      const j = await r.json().catch(() => ({}));
      const err = new Error(j.error || "conflict");
      err.foreign = true;
      throw err;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  },
  async flush() {
    if (!Sync.on || Sync.busy) return;
    if (!Sync.pending()) {
      Sync.state = "ok";
      Sync.pill();
      return;
    }
    Sync.busy = true;
    const changes = { ...Sync.out.changes };
    const errors = { ...Sync.out.errors };
    const reset = Sync.out.reset;
    try {
      if (reset) {
        await Sync.post({ reset: true, at: reset });
        if (Sync.out.reset === reset) Sync.out.reset = 0;
      }
      const j = await Sync.post({ changes, errors });
      for (const k of Object.keys(changes)) if (Sync.out.changes[k] === changes[k]) delete Sync.out.changes[k];
      for (const k of Object.keys(errors)) if (Sync.out.errors[k] === errors[k]) delete Sync.out.errors[k];
      Sync.saveOut();
      if (j.stale && Object.keys(j.stale).length) adoptServerRecords(j.stale);
      Sync.state = "ok";
      Sync.lastOk = Date.now();
      Sync.lastError = "";
    } catch (e) {
      if (e.foreign) {
        Sync.goForeign(e.message);
      } else {
        Sync.state = "error";
        Sync.lastError = e.message || String(e);
      }
    } finally {
      Sync.busy = false;
      if (Sync.on && Sync.pending()) {
        clearTimeout(Sync.timer);
        Sync.timer = setTimeout(Sync.flush, Sync.state === "error" ? 4000 : 60);
      }
      Sync.pill();
    }
  },
  async saveFile(name, text) {
    try {
      const r = await fetch(`${Sync.api("save-file")}&name=${encodeURIComponent(name)}`, { method: "POST", body: text });
      if (!r.ok) return null;
      return (await r.json()).path || null;
    } catch {
      return null;
    }
  },
  goForeign(msg) {
    Sync.on = false;
    Sync.foreign = true;
    Sync.state = "local";
    Sync.note = msg;
    toast(`Not saving to the server: ${esc(msg)}. Decisions stay in this browser.`, "warn", 8000);
  },
  pill() {
    const p = el.savePill;
    const n = Sync.pending();
    const at = (ms) => (ms ? new Date(ms).toLocaleTimeString() : "never");
    if (!Sync.on) {
      p.className = "save-pill local";
      p.textContent = "Saved in this browser";
      p.title = Sync.foreign
        ? `The server is up but won't write here (${Sync.note}). Decisions live in this browser's storage only — use ⋯ → Export decisions to keep a copy.`
        : Sync.note ||
          "Not connected to review_server.py, so decisions live only in this browser's storage (this exact browser + address). Use ⋯ → Export decisions to move or back them up.";
      return;
    }
    if (Sync.state === "error") {
      p.className = "save-pill error";
      p.textContent = `Unsaved (${n}) — retrying`;
      p.title = `The server isn't answering (${Sync.lastError}). Everything is kept in this browser and will be sent automatically when the server is back — restart review_server.py. Last saved: ${at(Sync.lastOk)}.`;
    } else if (n || Sync.busy) {
      p.className = "save-pill saving";
      p.textContent = "Saving…";
      p.title = `Saving to ${Sync.file}`;
    } else {
      p.className = "save-pill ok";
      p.textContent = "Saved";
      p.title = `Saved to ${Sync.file} at ${at(Sync.lastOk)}`;
    }
  },
};

/** Adopt records the server says are newer than ours. */
function adoptServerRecords(stale) {
  let touched = false;
  for (const [k, r] of Object.entries(stale)) {
    if (Sync.out.changes[k]) continue;
    if (r) doc.decisions[k] = r;
    else delete doc.decisions[k];
    touched = true;
  }
  if (!touched) return;
  saveLocal();
  renderQueue();
  renderProgress();
  if (S.cur) refreshCurrentViews({ details: true });
}
/** Merge the server's copy with ours: newest record wins; ours-only goes up. */
function mergeServerDoc(sdoc) {
  const sres = sdoc.reset_at || 0;
  if (sres > (doc.reset_at || 0)) {
    for (const [k, r] of Object.entries(doc.decisions)) if ((r.at || 0) <= sres) delete doc.decisions[k];
    for (const [k, e] of Object.entries(doc.errors)) if ((e.at || 0) <= sres) delete doc.errors[k];
    for (const [k, r] of Object.entries(Sync.out.changes)) if ((r.at || 0) <= sres) delete Sync.out.changes[k];
    doc.reset_at = sres;
  }
  const sd = sdoc.decisions || {};
  for (const k of new Set([...Object.keys(doc.decisions), ...Object.keys(sd)])) {
    if (Sync.out.changes[k]) continue;
    const L = doc.decisions[k];
    const R = sd[k];
    if (R && (!L || (R.at || 0) >= (L.at || 0))) doc.decisions[k] = R;
    else if (L && (!R || (L.at || 0) > (R.at || 0))) Sync.out.changes[k] = L;
  }
  const se = sdoc.errors || {};
  for (const k of new Set([...Object.keys(doc.errors), ...Object.keys(se)])) {
    if (k in Sync.out.errors) continue;
    const L = doc.errors[k];
    const R = se[k];
    if (R && (!L || (R.at || 0) >= (L.at || 0))) doc.errors[k] = R;
    else if (L) Sync.out.errors[k] = L;
  }
  saveLocal();
  Sync.saveOut();
}
async function initServer(info) {
  Sync.batch = BATCH_PARAM || info.default_batch || null;
  if (!Sync.batch) {
    Sync.note = "review_server.py was started without a batch folder, so it can't save decisions. Restart it with the batch folder (or open ?batch=<name>).";
    Sync.pill();
    return;
  }
  Sync.loadOut();
  try {
    const r = await fetch(Sync.api("decisions"), { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const sdoc = await r.json();
    if (sdoc.foreign) {
      Sync.goForeign(`${sdoc.file} belongs to another tool`);
      Sync.pill();
      return;
    }
    Sync.on = true;
    Sync.file = sdoc.file || `batches/${Sync.batch}/decisions.json`;
    mergeServerDoc(sdoc);
    Sync.lastOk = Date.now();
    Sync.state = "ok";
  } catch (e) {
    // The page came from the server a moment ago, so keep trying: the outbox holds everything.
    Sync.on = true;
    Sync.file = `batches/${Sync.batch}/decisions.json`;
    Sync.state = "error";
    Sync.lastError = e.message || String(e);
  }
  Sync.pill();
  if (Sync.pending()) Sync.schedule(100);
}
async function pullServer() {
  if (!Sync.on || Sync.busy) return;
  try {
    const r = await fetch(Sync.api("decisions"), { cache: "no-store" });
    if (!r.ok) return;
    const before = JSON.stringify(doc.decisions);
    mergeServerDoc(await r.json());
    if (JSON.stringify(doc.decisions) !== before) {
      renderQueue();
      renderProgress();
      if (S.cur) refreshCurrentViews({ details: true });
    }
    if (Sync.pending()) Sync.schedule(100);
  } catch {
    /* next flush reports it */
  }
}

/* ===================================================================
 * layout: size the player to the screen
 * =================================================================== */
let layoutQueued = false;
function layout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    const root = document.documentElement;
    const vh = window.innerHeight;
    const stageW = el.stage.clientWidth;
    if (!stageW) return;
    if (window.innerWidth < 1000) {
      root.style.setProperty("--core-w", `${stageW}px`);
      return;
    }
    const floor = Math.min(stageW, 560);
    for (let i = 0; i < 3; i++) {
      const chrome = el.topbar.offsetHeight + el.head.offsetHeight + el.timeline.offsetHeight + el.controls.offsetHeight + 3 * 8 + 12 + 14;
      const maxH = Math.max(200, vh - chrome);
      const w = Math.round(Math.max(floor, Math.min(stageW, (maxH * 16) / 9)));
      root.style.setProperty("--core-w", `${w}px`);
    }
  });
}

/* ===================================================================
 * timeline pointer
 * =================================================================== */
function timeAt(clientX) {
  const r = el.timeline.getBoundingClientRect();
  const dur = Number(el.timeline.dataset.dur) || duration();
  const p = clamp((clientX - r.left) / r.width, 0, 1);
  return { t: p * dur, p, dur };
}
el.timeline.addEventListener("pointermove", (e) => {
  const { t, p, dur } = timeAt(e.clientX);
  if (!(dur > 0)) return;
  el.tlHover.hidden = false;
  el.tlHover.style.left = `${p * 100}%`;
  el.tlHover.dataset.t = e.shiftKey ? `set start ${fmtTime(t)}` : fmtTime(t);
  el.tlHover.classList.toggle("flip", p > 0.85);
});
el.timeline.addEventListener("pointerleave", () => {
  el.tlHover.hidden = true;
});
el.timeline.addEventListener("click", (e) => {
  const { t, dur } = timeAt(e.clientX);
  if (!(dur > 0) || !S.cur) return;
  if (e.shiftKey) setStart(t, { audition: true });
  else seek(t, true);
});

/* ===================================================================
 * keyboard + focus
 * =================================================================== */
function isTyping(t) {
  if (!t || !t.tagName) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range"].includes(t.type);
}
function openHelp() {
  el.help.hidden = false;
}
function closeHelp() {
  el.help.hidden = true;
}
function toggleTheater() {
  document.body.classList.toggle("theater");
  LS.set("song-review:theater", document.body.classList.contains("theater") ? "1" : "");
  layout();
  setTimeout(scrollCurrentIntoView, 50);
}
const NO_REPEAT = new Set(["KeyA", "KeyR", "KeyU", "KeyS", "KeyH", "KeyT", "KeyE"]);
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;
  if (e.key === "Escape") {
    if (!el.help.hidden) closeHelp();
    else if (!el.menuPop.hidden) closeMenu();
    else if (isTyping(e.target)) e.target.blur();
    return;
  }
  if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  const code = e.code;
  const isHelpKey = (code === "Slash" && e.shiftKey) || e.key === "?";
  if (!el.help.hidden) {
    if (isHelpKey) closeHelp();
    return;
  }
  if (e.repeat && NO_REPEAT.has(code)) {
    e.preventDefault();
    return;
  }
  let handled = true;
  if (isHelpKey) openHelp();
  else if (code === "Slash") {
    el.search.focus();
    el.search.select();
  } else if (code === "KeyT") toggleTheater();
  else if (!S.cur) handled = false;
  else {
    switch (code) {
      case "KeyA": decide("approved"); break;
      case "KeyR": decide("rejected"); break;
      case "KeyU": undo(); break;
      case "KeyJ":
      case "ArrowDown": move(1); break;
      case "KeyK":
      case "ArrowUp": move(-1); break;
      case "Space": togglePlay(); break;
      case "ArrowLeft": seekBy(e.shiftKey ? -1 : -5); break;
      case "ArrowRight": seekBy(e.shiftKey ? 1 : 5); break;
      case "KeyS": setStartNow(); break;
      case "KeyH": useHook(); break;
      case "KeyP": playFromStart(); break;
      case "BracketLeft": nudge(e.shiftKey ? -5 : -1); break;
      case "BracketRight": nudge(e.shiftKey ? 5 : 1); break;
      case "KeyE": focusField("title"); break;
      default: {
        const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
        if (m) jumpTenth(Number(m[1]));
        else handled = false;
      }
    }
  }
  if (handled) e.preventDefault();
});
// A focused button would also "click" on Space/Enter: give focus back to the page after mouse clicks.
document.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && e.detail > 0 && !b.closest(".modal")) b.blur();
});
// Clicking inside the YouTube iframe moves keyboard focus into it, where our
// shortcuts can't see the keys. Pull focus back as soon as that happens
// (scrubbing and clicks inside the player keep working).
window.addEventListener("blur", () => {
  setTimeout(() => {
    if (YTP.iframe && document.activeElement === YTP.iframe) el.focusSink.focus({ preventScroll: true });
  }, 60);
});

/* ===================================================================
 * wiring
 * =================================================================== */
function closeMenu() {
  el.menuPop.hidden = true;
  el.menuBtn.setAttribute("aria-expanded", "false");
}
function wire() {
  el.queueList.addEventListener("click", (e) => {
    const li = e.target.closest(".q-row");
    if (li) select(byKey.get(li.dataset.key));
  });
  el.filters.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S.filter = b.dataset.filter;
    el.filters.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    renderQueue();
    renderHead();
  });
  el.search.addEventListener("input", () => {
    S.query = el.search.value;
    renderQueue();
    renderHead();
  });
  el.search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (S.list.length && !S.list.includes(S.cur)) select(S.list[0]);
      el.search.blur();
    }
  });
  el.sort.addEventListener("change", () => {
    S.sort = el.sort.value;
    el.sort.blur();
    renderQueue();
    renderHead();
  });
  $("#btn-export").addEventListener("click", exportCsv);
  el.menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = el.menuPop.hidden;
    el.menuPop.hidden = !open;
    el.menuBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!el.menuPop.hidden && !e.target.closest(".menu")) closeMenu();
  });
  el.menuPop.addEventListener("click", (e) => {
    const b = e.target.closest("[data-menu]");
    if (!b) return;
    closeMenu();
    if (b.dataset.menu === "export-json") exportJson();
    else if (b.dataset.menu === "import-json") el.importFile.click();
    else if (b.dataset.menu === "reset") resetAll();
  });
  el.importFile.addEventListener("change", () => {
    const f = el.importFile.files && el.importFile.files[0];
    if (f) importJson(f);
    el.importFile.value = "";
  });
  $("#btn-theater").addEventListener("click", toggleTheater);
  $("#btn-help").addEventListener("click", openHelp);
  el.help.addEventListener("click", (e) => {
    if (e.target === el.help || e.target.closest("[data-close]")) closeHelp();
  });
  el.btnPlay.addEventListener("click", togglePlay);
  $("#btn-from-start").addEventListener("click", playFromStart);
  $("#btn-set-now").addEventListener("click", setStartNow);
  el.btnHook.addEventListener("click", useHook);
  el.controls.addEventListener("click", (e) => {
    const n = e.target.closest("[data-nudge]");
    if (n) nudge(Number(n.dataset.nudge));
  });
  el.startReset.addEventListener("click", () => {
    if (S.cur) setStart(origStart(S.cur), { audition: true });
  });
  el.startInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const t = parseTime(el.startInput.value);
      if (Number.isFinite(t)) {
        setStart(t, { audition: true });
        el.startInput.blur();
        el.focusSink.focus({ preventScroll: true });
      } else el.startInput.classList.add("bad");
    } else if (e.key === "Escape") {
      e.preventDefault();
      renderControls();
      el.startInput.blur();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const base = parseTime(el.startInput.value);
      const t = Math.max(0, (Number.isFinite(base) ? base : effStart(S.cur)) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
      el.startInput.value = fmtTime(t);
    }
  });
  el.startInput.addEventListener("focus", () => el.startInput.select());
  el.startInput.addEventListener("blur", () => {
    if (!S.cur) return;
    const t = parseTime(el.startInput.value);
    if (Number.isFinite(t) && t !== effStart(S.cur)) setStart(t, { audition: false });
    else renderControls();
  });
  $("#btn-approve").addEventListener("click", () => decide("approved"));
  $("#btn-reject").addEventListener("click", () => decide("rejected"));
  $("#btn-undo").addEventListener("click", undo);
  $("#btn-prev").addEventListener("click", () => move(-1));
  $("#btn-next").addEventListener("click", () => move(1));
  // preview / use buttons live in the head, the alternatives strip and the player alert
  document.addEventListener("click", (e) => {
    const use = e.target.closest("[data-use]");
    if (use) return useVideo(use.dataset.use);
    const pv = e.target.closest("[data-preview]");
    if (pv) return previewVideo(pv.dataset.preview);
    if (e.target.closest("[data-preview-back]")) {
      S.preview = null;
      const c = S.cur;
      if (c) loadInPlayer(effVideo(c), effStart(c), true);
      renderHead();
      renderControls();
      renderTimeline();
      renderAlts();
      layout();
    }
  });
  window.addEventListener("resize", layout);
  if (window.ResizeObserver) new ResizeObserver(layout).observe(el.stage);
  // another tab on the same batch
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue) return;
    loadLocal();
    renderQueue();
    renderProgress();
    if (S.cur) refreshCurrentViews({ details: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pullServer();
    else if (Sync.on && Sync.pending()) Sync.flush();
  });
  window.addEventListener("beforeunload", (e) => {
    if (Sync.on && Sync.pending()) {
      Sync.flush();
      e.preventDefault();
      e.returnValue = "";
    }
  });
  setInterval(tick, 200);
}

/* ===================================================================
 * boot
 * =================================================================== */
function loadCandidatesScript() {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = CANDIDATES_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
async function detectServer() {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("/api/info", { cache: "no-store", signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.app === "song-review" ? j : null;
  } catch {
    return null;
  }
}
function showEmpty(loaded) {
  document.body.classList.add("is-empty");
  el.empty.hidden = false;
  el.empty.innerHTML = `<h2>No songs to review</h2>
    <p>${loaded ? `<code>${esc(CANDIDATES_SRC)}</code> loaded, but it has no <code>window.CANDIDATES</code> rows.` : `Couldn't load <code>${esc(CANDIDATES_SRC)}</code>.`}</p>
    <p>Serve a batch with the review server (decisions are saved to the batch folder):</p>
    <pre>cd tools/song-curation
python review_server.py batches/&lt;batch&gt; --port 8760
# then open http://localhost:8760/</pre>
    <p>Or open <code>review.html?batch=&lt;folder under batches/&gt;</code>, or put a <code>candidates.js</code> next to <code>review.html</code>.</p>`;
}

/** Unsent server changes stored by this origin (never strand them with a redirect). */
function hasUnsentChanges() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.includes(":outbox:")) continue;
      const o = JSON.parse(localStorage.getItem(k) || "{}");
      if (Object.keys(o.changes || {}).length || Object.keys(o.errors || {}).length || o.reset) return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

async function boot() {
  if (IP_HOST && /^https?:$/.test(location.protocol)) {
    if (!hasUnsentChanges()) {
      const u = new URL(location.href);
      u.hostname = "localhost"; // see IP_HOST: YouTube blocks some videos on bare IPs
      location.replace(u.href);
      return;
    }
    setTimeout(() => toast(`Some videos won't play on an IP address — once this page says “Saved”, open <b>localhost:${esc(location.port)}</b> instead.`, "warn", 10000), 500);
  }
  initPlayer();
  const [loaded, info] = await Promise.all([loadCandidatesScript(), detectServer()]);
  cands = normalize(Array.isArray(window.CANDIDATES) ? window.CANDIDATES : []);
  if (!cands.length) {
    showEmpty(loaded);
    Sync.pill();
    return;
  }
  for (const c of cands) byKey.set(c._key, c);
  const B = window.BATCH && typeof window.BATCH === "object" ? window.BATCH : {};
  KEY = `song-review:v2:${B.id ? String(B.id) : `h${hashIds(cands.map((c) => c.youtube_id))}`}`;
  BATCH_LABEL = B.title || B.id || BATCH_PARAM || (info && info.default_batch) || "candidates.js";
  el.batchName.textContent = `${B.title && B.id ? `${B.title} · ${B.id}` : BATCH_LABEL} · ${cands.length} songs`;
  el.batchName.title = `Data: ${CANDIDATES_SRC}`;
  loadLocal();
  importLegacyStore();
  if (info) await initServer(info);
  else Sync.pill();
  if (location.protocol === "file:") {
    toast("Opened as a file: decisions save in this browser, but <b>YouTube won't play videos here</b> (error 153). Run <code>review_server.py</code> and open <b>http://localhost:8760/</b>.", "warn", 15000);
  }
  if (LS.get("song-review:theater") === "1") document.body.classList.add("theater");

  wire();
  renderQueue();
  renderProgress();
  const saved = byKey.get(LS.get(`${KEY}:cursor`) || "");
  select(saved || cands.find((c) => !statusOf(c)) || cands[0], { play: false });
  layout();
}
boot();
