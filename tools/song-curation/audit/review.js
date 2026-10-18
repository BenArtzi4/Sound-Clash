/* Catalog audit review page.
 *
 * Loads items.json (proposals) and decisions.json from server.py, renders one
 * card per proposal, and saves every decision back to the server, which writes
 * decisions.json in the audit's batch folder (localStorage only queues clicks
 * the server hasn't confirmed yet).
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

let ITEMS = [];
let DEC = {};
let tab = "all";
let statusFilter = "pending";
let query = "";
let highOnly = false;
let focusIdx = -1;
const players = {}; // key -> YT.Player
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
const mmss = (s) => (s == null ? "?" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const statusOf = (id) => (DEC[id] && DEC[id].status) || "pending";
const sameVal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function sortedGenres(g) { return [...(g || [])].sort(); }

/* ---------- data ---------- */
async function load() {
  const [items, dec] = await Promise.all([
    fetch("/api/items").then((r) => r.json()),
    fetch("/api/decisions").then((r) => r.json()),
  ]);
  ITEMS = items.items || [];
  if (Array.isArray(items.genres) && items.genres.length) GENRES = items.genres;
  // one queue per audit: item ids repeat across audits ("style-3408cf1d")
  if (items.batch) PENDING_KEY = `catalog-audit-pending:${items.batch}`;
  DEC = dec || {};
  // replay anything that never reached the server (e.g. it was down)
  for (const [id, decision] of Object.entries(readPending())) {
    if (decision === null) delete DEC[id]; else DEC[id] = decision;
  }
  if (Object.keys(readPending()).length) trySync();
  ITEMS.sort((a, b) => (b.severity || 0) - (a.severity || 0) || (maxPlays(b) - maxPlays(a)));
  renderTabs();
  render();
}
const maxPlays = (it) => Math.max(0, ...(it.songs || []).map((s) => s.plays || 0));

/* Every decision is first written to a browser-side queue (localStorage), then
 * sent to the server. If the server is down the queue keeps it, retries every
 * 5 s, and is replayed on the next page load, so a click is never lost. */
let PENDING_KEY = "catalog-audit-pending:v1";
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

let saveTimer = null;
let retryTimer = null;
async function trySync() {
  const st = $("#saveState");
  try {
    await flushPending();
    clearTimeout(saveTimer);
    clearTimeout(retryTimer);
    st.textContent = "saved ✓";
    st.className = "saveState";
    saveTimer = setTimeout(() => { st.textContent = ""; }, 1500);
  } catch (e) {
    const n = Object.keys(readPending()).length;
    st.textContent = `Server not reachable — ${n} decision(s) kept in this browser, retrying…`;
    st.className = "saveState err";
    clearTimeout(retryTimer);
    retryTimer = setTimeout(trySync, 5000);
  }
}
async function saveDecision(id, decision) {
  if (decision === null) delete DEC[id]; else DEC[id] = decision;
  const p = readPending();
  p[id] = decision;
  writePending(p);
  $("#saveState").textContent = "saving…";
  $("#saveState").className = "saveState";
  await trySync();
  renderTabs();
  updateProgress();
}

/* ---------- filtering ---------- */
function matches(it) {
  if (highOnly && (it.severity || 0) < 3) return false;
  const st = statusOf(it.id);
  if (statusFilter !== "all" && st !== statusFilter) return false;
  if (query) {
    const hay = [it.summary, ...(it.evidence || []), ...(it.songs || []).flatMap((s) => [s.title, s.artist]),
      JSON.stringify(it.proposal || {}), (DEC[it.id] && DEC[it.id].note) || ""].join(" ").toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}
function inTab(it) {
  if (tab === "all") return it.kind !== "style";
  return it.kind === tab;
}

/* ---------- top bar ---------- */
function renderTabs() {
  const nav = $("#tabs");
  const count = (pred) => ITEMS.filter(pred);
  const mk = (key, label, list) => {
    const pending = list.filter((i) => statusOf(i.id) === "pending").length;
    return `<button data-tab="${key}" class="${tab === key ? "on" : ""}">${esc(label)}<span class="n">${pending}/${list.length}</span></button>`;
  };
  let html = mk("all", "All issues", count((i) => i.kind !== "style"));
  for (const k of Object.keys(KINDS)) {
    const list = count((i) => i.kind === k);
    if (list.length) html += mk(k, KINDS[k], list);
  }
  html += `<button data-tab="summary" class="${tab === "summary" ? "on" : ""}">Summary of approved</button>`;
  nav.innerHTML = html;
  updateProgress();
}
function updateProgress() {
  const a = ITEMS.filter((i) => statusOf(i.id) === "approved").length;
  const r = ITEMS.filter((i) => statusOf(i.id) === "rejected").length;
  $("#progress").textContent = `${ITEMS.length} items · ${a} approved · ${r} rejected · ${ITEMS.length - a - r} to review`;
}

/* ---------- render ---------- */
function render() {
  stopAllPlayers();
  const list = $("#list");
  focusIdx = -1;
  if (tab === "summary") { list.innerHTML = renderSummary(); return; }
  const items = ITEMS.filter((i) => inTab(i) && matches(i));
  if (!items.length) { list.innerHTML = $("#emptyTpl").innerHTML; return; }
  if (tab === "style") { list.innerHTML = renderStyleTable(items); wireStyle(items); return; }
  const CAP = 60;
  list.innerHTML = items.slice(0, CAP).map(renderCard).join("") +
    (items.length > CAP ? `<p class="empty">Showing the first ${CAP} of ${items.length}. Decide these and the next ones appear.</p>` : "");
  items.slice(0, CAP).forEach(wireCard);
}

function songBox(s, key, extraClass = "", extraHtml = "") {
  const yt = s.yt || {};
  const flags = [];
  if (yt.status && yt.status !== "OK") flags.push(`<span class="badge bad">${esc(yt.status)} ${esc(yt.reason || "")}</span>`);
  if (yt.embed === false) flags.push(`<span class="badge bad">embed off</span>`);
  if (yt.il === false) flags.push(`<span class="badge bad">blocked in IL</span>`);
  return `<div class="song ${extraClass}" data-song="${esc(s.id)}">
    ${extraHtml}
    <div class="player" data-key="${esc(key)}" data-vid="${esc(s.youtube_id)}" data-start="${s.start_time || 0}"
         style="background-image:url(https://i.ytimg.com/vi/${esc(s.youtube_id)}/mqdefault.jpg)"><span class="play">▶</span></div>
    <div class="name" dir="auto">${esc(s.title)} — ${esc(s.artist)}</div>
    <div class="meta">${esc((s.genres || []).join(", ") || "no genre")} · ${s.release_year ?? "no year"} · start ${mmss(s.start_time)} · played ${s.plays || 0}×</div>
    <div class="meta" dir="auto">YouTube: <b>${esc(yt.title || "?")}</b></div>
    <div class="meta" dir="auto">${esc(yt.channel || "?")}${yt.badge ? `<span class="badge">${esc(yt.badge)}</span>` : ""} · ${human(yt.views)} views · ${mmss(yt.length)} · ${esc((yt.upload || "").slice(0, 10))} ${flags.join(" ")}</div>
    <div class="meta"><a href="https://www.youtube.com/watch?v=${esc(s.youtube_id)}" target="_blank" rel="noopener">open on YouTube</a></div>
  </div>`;
}

function candRow(it, c, idx, selectedId, isCurrent) {
  const key = `${it.id}:c${idx}`;
  const curLen = ((it.songs[0] || {}).yt || {}).length;
  const d = !isCurrent && c.length && curLen ? c.length - curLen : 0;
  const lenHint = Math.abs(d) >= 8
    ? ` · <b>${d > 0 ? "+" : "−"}${Math.abs(d)}s vs current</b>${d > 0 ? " (intro/outro? re-check the start)" : ""}`
    : "";
  return `<label class="cand ${c.youtube_id === selectedId ? "sel" : ""} ${isCurrent ? "current" : ""}">
    <input type="radio" name="cand-${esc(it.id)}" value="${esc(c.youtube_id)}" ${c.youtube_id === selectedId ? "checked" : ""}>
    <div class="player" data-key="${esc(key)}" data-vid="${esc(c.youtube_id)}" data-start="${c.start_time ?? 0}"
         style="background-image:url(https://i.ytimg.com/vi/${esc(c.youtube_id)}/mqdefault.jpg)"><span class="play">▶</span></div>
    <div>
      <div class="name" dir="auto">${isCurrent ? "<b>Keep current video</b> — " : ""}${esc(c.title || "")}</div>
      <div class="meta" dir="auto">${esc(c.channel || "?")}${c.badge ? `<span class="badge">${esc(c.badge)}</span>` : ""} · <b>${human(c.views)}</b> views · ${mmss(c.length)}${lenHint} · ${esc((c.upload || "").slice(0, 10))}</div>
      ${c.note ?`<div class="meta" dir="auto">${esc(c.note)}</div>` : ""}
      <div class="meta"><a href="https://www.youtube.com/watch?v=${esc(c.youtube_id)}" target="_blank" rel="noopener">open on YouTube</a></div>
    </div>
  </label>`;
}

/* The values the card currently shows (draft or saved decision over proposal). */
function draftFields(it) {
  const s = it.songs[0];
  const p = (it.proposal && it.proposal.fields) || {};
  const d = (DEC[it.id] && DEC[it.id].fields) || null;
  const base = { title: s.title, artist: s.artist, youtube_id: s.youtube_id, start_time: s.start_time,
    release_year: s.release_year, genres: sortedGenres(s.genres) };
  return Object.assign({}, base, p, d || {});
}

function fieldEditor(it) {
  const s = it.songs[0];
  const v = draftFields(it);
  const p = (it.proposal && it.proposal.fields) || {};
  const show = new Set(Object.keys(p));
  if (["name", "metadata", "duplicate", "maybe_dup"].includes(it.kind)) ["title", "artist", "release_year", "genres"].forEach((f) => show.add(f));
  if (it.candidates && it.candidates.length) { show.add("start_time"); }
  show.delete("youtube_id");
  const rows = [];
  const cur = { title: s.title, artist: s.artist, release_year: s.release_year, start_time: s.start_time, genres: sortedGenres(s.genres) };
  for (const f of ["title", "artist", "release_year", "start_time", "genres"]) {
    if (!show.has(f)) continue;
    const changed = !sameVal(f === "genres" ? sortedGenres(v[f]) : v[f], cur[f]);
    let editor;
    if (f === "genres") {
      editor = `<div class="genres">${GENRES.map((g) => `<label><input type="checkbox" data-f="genres" value="${g}" ${(v.genres || []).includes(g) ? "checked" : ""}>${g}</label>`).join("")}</div>`;
    } else if (f === "start_time") {
      editor = `<div class="startRow"><input type="number" min="0" data-f="start_time" value="${v.start_time ?? 0}" class="${changed ? "changed" : ""}">
        <button type="button" class="small" data-act="grabStart">⏱ use playing time</button><span class="meta">seconds — check it on the chosen video</span></div>`;
    } else if (f === "release_year") {
      editor = `<input type="number" min="1900" max="2100" data-f="release_year" value="${v.release_year ?? ""}" class="${changed ? "changed" : ""}">`;
    } else {
      editor = `<input type="text" dir="auto" data-f="${f}" value="${esc(v[f])}" class="${changed ? "changed" : ""}">`;
    }
    const curTxt = f === "genres" ? (cur.genres || []).join(", ") : (f === "start_time" ? mmss(cur[f]) : cur[f] ?? "—");
    rows.push(`<div class="lbl">${f.replace("_", " ")}</div><div class="cur ${changed ? "changed" : ""}" dir="auto">${esc(curTxt)}</div><div>${editor}</div>`);
  }
  return rows.length ? `<div class="fields">${rows.join("")}</div>` : "";
}

function renderCard(it) {
  const st = statusOf(it.id);
  const dec = DEC[it.id] || {};
  const p = it.proposal || {};
  let body = "";
  if (it.kind === "duplicate" || it.kind === "maybe_dup") {
    const keep = dec.keep || p.keep;
    body = `<div class="songs">${it.songs.map((s, i) => songBox(s, `${it.id}:s${i}`, s.id === keep ? "keep" : (keep ? "drop" : ""),
      `<label class="meta"><input type="radio" name="keep-${esc(it.id)}" value="${esc(s.id)}" ${s.id === keep ? "checked" : ""}> <b>keep this one</b>${s.id === keep ? "" : (keep ? " — <span class='del'>will be deleted</span>" : "")}</label>`)).join("")}
      </div><div class="meta" style="margin-top:8px">Genres / names below apply to the song you keep.</div>${keptEditor(it, keep)}`;
  } else {
    const s = it.songs[0];
    body = `<div class="songs">${songBox(s, `${it.id}:s0`)}</div>`;
    if (p.action === "delete") body += `<p class="del">Proposed: delete this song from the catalog.</p>`;
    if (it.candidates && it.candidates.length) {
      const v = draftFields(it);
      const curCand = { youtube_id: s.youtube_id, title: (s.yt || {}).title, channel: (s.yt || {}).channel, badge: (s.yt || {}).badge,
        views: (s.yt || {}).views, length: (s.yt || {}).length, upload: (s.yt || {}).upload, start_time: s.start_time };
      body += `<div class="cands">${candRow(it, curCand, "cur", v.youtube_id, true)}${it.candidates.map((c, i) => candRow(it, c, i, v.youtube_id, false)).join("")}</div>`;
    }
    body += fieldEditor(it);
  }
  return `<article class="card ${st}" id="card-${esc(it.id)}" data-id="${esc(it.id)}">
    <div class="cardHead">
      <span class="kind sev${it.severity || 1}">${esc(KINDS[it.kind] || it.kind)} · ${SEV[it.severity || 1]}</span>
      <span class="summary" dir="auto">${esc(it.summary)}</span>
      ${it.confidence ? `<span class="conf">confidence: ${esc(it.confidence)}</span>` : ""}
      <span class="by">${esc(it.by || "")}</span>
    </div>
    ${(it.evidence || []).length ? `<ul class="evidence">${it.evidence.map((e) => `<li dir="auto">${linkify(e)}</li>`).join("")}</ul>` : ""}
    ${body}
    <div class="actions">
      <button class="btn approve" data-act="approve">✓ Approve</button>
      <button class="btn reject" data-act="reject">✗ Reject</button>
      ${st !== "pending" ? `<button class="btn undo" data-act="undo">Undo</button>` : ""}
      <span class="state ${st}">${st === "pending" ? "" : st}</span>
      <input class="note" type="text" dir="auto" placeholder="Note (optional)" value="${esc(dec.note || "")}">
    </div>
  </article>`;
}

function keptEditor(it, keepId) {
  const s = it.songs.find((x) => x.id === keepId) || it.songs[0];
  const fake = Object.assign({}, it, { songs: [s] });
  return fieldEditor(fake);
}

/* Read the card's editors into a decision.fields object (only changed values). */
function collect(it, card) {
  const dec = DEC[it.id] || {};
  let s = it.songs[0];
  let keep = null;
  if (it.kind === "duplicate" || it.kind === "maybe_dup") {
    const r = card.querySelector(`input[name="keep-${CSS.escape(it.id)}"]:checked`);
    keep = r ? r.value : (it.proposal || {}).keep;
    s = it.songs.find((x) => x.id === keep) || s;
  }
  const fields = {};
  card.querySelectorAll("[data-f]").forEach((el) => {
    const f = el.dataset.f;
    if (f === "genres") return;
    let val = el.value;
    if (f === "release_year") val = val === "" ? null : Number(val);
    if (f === "start_time") val = Number(val || 0);
    const cur = s[f] ?? null;
    if (!sameVal(val, cur)) fields[f] = val;
  });
  const gBoxes = card.querySelectorAll('[data-f="genres"]');
  if (gBoxes.length) {
    const g = [...gBoxes].filter((b) => b.checked).map((b) => b.value).sort();
    if (!sameVal(g, sortedGenres(s.genres))) fields.genres = g;
  }
  const cand = card.querySelector(`input[name="cand-${CSS.escape(it.id)}"]:checked`);
  if (cand && cand.value !== s.youtube_id) fields.youtube_id = cand.value;
  const note = card.querySelector(".note").value.trim();
  return { status: dec.status || "pending", fields, keep, note };
}

function wireCard(it) {
  const card = document.getElementById(`card-${it.id}`);
  if (!card) return;
  card.addEventListener("click", (e) => {
    const pl = e.target.closest(".player");
    if (pl && !pl.dataset.live) { e.preventDefault(); startPlayer(pl); return; }
    const act = e.target.closest("[data-act]");
    if (!act) return;
    const a = act.dataset.act;
    if (a === "grabStart") { grabStart(it, card); return; }
    if (a === "undo") { saveDecision(it.id, null).then(() => rerenderCard(it)); return; }
    const d = collect(it, card);
    d.status = a === "approve" ? "approved" : "rejected";
    if (d.status === "approved" && (it.kind === "duplicate" || it.kind === "maybe_dup") && !d.keep) {
      alertInline(card, "Pick which one to keep first."); return;
    }
    saveDecision(it.id, d).then(() => advance(card, it));
  });
  card.addEventListener("change", (e) => {
    if (e.target.name && e.target.name.startsWith("keep-")) {
      // A different copy is now kept: its editors must start from ITS values
      // (plus the card's proposal), never from the previously shown copy.
      const prev = DEC[it.id] || {};
      DEC[it.id] = { status: prev.status || "pending", fields: Object.assign({}, (it.proposal || {}).fields || {}),
        keep: e.target.value, note: prev.note || "" };
      saveDecision(it.id, DEC[it.id]).then(() => rerenderCard(it));
      return;
    }
    if (e.target.name && e.target.name.startsWith("cand-")) {
      const d = collect(it, card);
      if (e.target.name.startsWith("cand-")) {
        const c = (it.candidates || []).find((x) => x.youtube_id === e.target.value);
        if (c && c.start_time != null) d.fields.start_time = c.start_time;
      }
      DEC[it.id] = Object.assign({}, DEC[it.id] || {}, d);
      saveDecision(it.id, DEC[it.id]).then(() => rerenderCard(it));
      return;
    }
    if (e.target.matches("[data-f], .note")) {
      const d = collect(it, card);
      saveDecision(it.id, d);
      if (e.target.matches("input[data-f]:not([type=checkbox])")) e.target.classList.add("changed");
    }
  });
}

function alertInline(card, msg) {
  const s = card.querySelector(".state");
  s.textContent = msg;
  s.className = "state rejected";
}

function rerenderCard(it) {
  const old = document.getElementById(`card-${it.id}`);
  if (!old) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = renderCard(it);
  old.replaceWith(tmp.firstElementChild);
  wireCard(it);
}

function advance(card, it) {
  if (statusFilter === "pending") {
    const next = card.nextElementSibling;
    card.remove();
    if (next && next.classList.contains("card")) { setFocus(next); }
    if (!$("#list .card")) render();
  } else {
    rerenderCard(it);
  }
}

/* ---------- players ---------- */
function startPlayer(el) {
  if (!ytReady || !window.YT) { window.open(`https://www.youtube.com/watch?v=${el.dataset.vid}&t=${el.dataset.start}s`, "_blank"); return; }
  el.dataset.live = "1";
  el.innerHTML = "<div></div>";
  const key = el.dataset.key;
  players[key] = new YT.Player(el.firstElementChild, {
    videoId: el.dataset.vid,
    host: "https://www.youtube-nocookie.com",
    playerVars: { start: Number(el.dataset.start) || 0, autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
    events: {
      onStateChange: (ev) => {
        if (ev.data === YT.PlayerState.PLAYING) {
          for (const [k, p] of Object.entries(players)) if (k !== key && p.pauseVideo) try { p.pauseVideo(); } catch (_) { /* gone */ }
        }
      },
    },
  });
}
function stopAllPlayers() {
  for (const k of Object.keys(players)) { try { players[k].destroy(); } catch (_) { /* gone */ } delete players[k]; }
}
function grabStart(it, card) {
  const sel = card.querySelector(`input[name="cand-${CSS.escape(it.id)}"]:checked`);
  const vid = sel ? sel.value : it.songs[0].youtube_id;
  const pl = [...card.querySelectorAll(".player")].find((p) => p.dataset.vid === vid && players[p.dataset.key]);
  const input = card.querySelector('[data-f="start_time"]');
  if (!pl) { input.focus(); alertInline(card, "Play the chosen video first, pause at the right spot, then click ⏱."); return; }
  input.value = Math.floor(players[pl.dataset.key].getCurrentTime());
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/* ---------- style table ---------- */
function renderStyleTable(items) {
  const rows = items.map((it) => {
    const s = it.songs[0];
    const v = draftFields(it);
    const p = (it.proposal || {}).fields || {};
    const cells = Object.keys(p).filter((f) => f !== "genres").map((f) =>
      `<div><span class="rule">${f}</span> <span class="old" dir="auto">${esc(s[f])}</span> → <input type="text" dir="auto" data-f="${f}" value="${esc(v[f])}" style="min-width:220px"></div>`).join("");
    const st = statusOf(it.id);
    return `<tr class="${st}" data-id="${esc(it.id)}">
      <td dir="auto">${esc(s.title)} — ${esc(s.artist)}</td>
      <td>${cells}</td>
      <td class="rule" dir="auto">${esc(it.summary)}</td>
      <td style="white-space:nowrap"><button class="small" data-act="approve">✓</button> <button class="small" data-act="reject">✗</button> <span class="state ${st}">${st === "pending" ? "" : st}</span></td>
    </tr>`;
  }).join("");
  return `<div class="styleBar"><b>${items.length}</b> style fixes shown.
      <button class="btn approve" id="styleAll">✓ Approve all shown</button>
      <button class="btn reject" id="styleNone">✗ Reject all shown</button>
      <span class="meta">You can edit the new value before approving.</span></div>
    <table class="style"><thead><tr><th>Song</th><th>Change</th><th>Rule</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}
function styleDecision(it, tr, status) {
  const s = it.songs[0];
  const fields = {};
  tr.querySelectorAll("[data-f]").forEach((el) => { if (el.value !== s[el.dataset.f]) fields[el.dataset.f] = el.value; });
  return { status, fields, keep: null, note: "" };
}
function wireStyle(items) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  $("#list").querySelectorAll("tr[data-id]").forEach((tr) => {
    const it = byId[tr.dataset.id];
    tr.addEventListener("click", (e) => {
      const a = e.target.closest("[data-act]");
      if (!a) return;
      saveDecision(it.id, styleDecision(it, tr, a.dataset.act === "approve" ? "approved" : "rejected")).then(() => {
        tr.className = statusOf(it.id);
        tr.querySelector(".state").textContent = statusOf(it.id);
      });
    });
  });
  const bulk = async (status) => {
    for (const tr of $("#list").querySelectorAll("tr[data-id]")) {
      const it = byId[tr.dataset.id];
      DEC[it.id] = styleDecision(it, tr, status);
    }
    // one POST per row keeps the server simple; it is local and fast
    for (const tr of $("#list").querySelectorAll("tr[data-id]")) await saveDecision(tr.dataset.id, DEC[tr.dataset.id]);
    render();
  };
  $("#styleAll").onclick = () => bulk("approved");
  $("#styleNone").onclick = () => bulk("rejected");
}

/* ---------- summary of approved changes ---------- */
function plan() {
  const songs = {}; // song id -> {song, set:{f:[{val,item}]}, del:[item]}
  const touch = (s) => (songs[s.id] = songs[s.id] || { song: s, set: {}, del: [] });
  for (const it of ITEMS) {
    const d = DEC[it.id];
    if (!d || d.status !== "approved") continue;
    const p = it.proposal || {};
    if (it.kind === "duplicate" || it.kind === "maybe_dup") {
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
      const cur = f === "genres" ? sortedGenres(s.genres) : s[f];
      if (sameVal(f === "genres" ? sortedGenres(val) : val, cur)) continue;
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
      return `<tr><td dir="auto">${esc(s.title)} — ${esc(s.artist)}<div class="meta">${esc(s.youtube_id)}</div></td><td class="del">DELETE${extra}</td></tr>`;
    }
    const parts = Object.entries(x.set).map(([f, vals]) => {
      const uniq = [...new Set(vals.map((v) => JSON.stringify(v.val)))];
      const conflict = uniq.length > 1 ? ` <span class="conflict">CONFLICT: ${uniq.map(esc).join(" vs ")}</span>` : "";
      const nv = vals[vals.length - 1].val;
      const cur = s[f];
      return `<div><span class="rule">${f}</span> <span class="old" dir="auto">${esc(Array.isArray(cur) ? cur.join(", ") : cur)}</span> → <span class="new" dir="auto">${esc(Array.isArray(nv) ? nv.join(", ") : nv)}</span>${conflict}</div>`;
    }).join("");
    return `<tr><td dir="auto">${esc(s.title)} — ${esc(s.artist)}<div class="meta">${esc(s.youtube_id)}</div></td><td>${parts}</td></tr>`;
  };
  return `<div class="sumBox">
    <h2>What will change when you tell Claude to apply</h2>
    <p><b>${ups.length}</b> songs updated · <b class="del">${dels.length}</b> songs deleted. Nothing is applied until you say so in the chat.</p>
    <table><thead><tr><th>Song (current)</th><th>Change</th></tr></thead><tbody>${dels.map(row).join("")}${ups.map(row).join("")}</tbody></table>
  </div>`;
}

/* ---------- keyboard ---------- */
function setFocus(card) {
  document.querySelectorAll(".card.focus").forEach((c) => c.classList.remove("focus"));
  if (!card) return;
  card.classList.add("focus");
  card.scrollIntoView({ block: "start", behavior: "smooth" });
}
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  const cards = [...document.querySelectorAll(".card")];
  if (!cards.length) return;
  let cur = cards.findIndex((c) => c.classList.contains("focus"));
  if (e.key === "j") { setFocus(cards[Math.min(cards.length - 1, cur + 1)]); e.preventDefault(); }
  else if (e.key === "k") { setFocus(cards[Math.max(0, cur - 1)]); e.preventDefault(); }
  else if ((e.key === "a" || e.key === "r") && cur >= 0) {
    cards[cur].querySelector(e.key === "a" ? "[data-act=approve]" : "[data-act=reject]").click();
    e.preventDefault();
  } else if (e.key === " " && cur >= 0) {
    const pl = cards[cur].querySelector(".player:not([data-live])");
    if (pl) startPlayer(pl);
    else {
      const live = cards[cur].querySelector(".player[data-live]");
      const p = live && players[live.dataset.key];
      if (p && p.getPlayerState) (p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo());
    }
    e.preventDefault();
  }
});

/* ---------- wiring ---------- */
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  tab = b.dataset.tab;
  renderTabs();
  render();
});
$("#statusSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-status]");
  if (!b) return;
  statusFilter = b.dataset.status;
  document.querySelectorAll("#statusSeg button").forEach((x) => x.classList.toggle("on", x === b));
  render();
});
let qTimer = null;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { query = e.target.value.trim().toLowerCase(); render(); }, 250);
});
$("#highOnly").addEventListener("change", (e) => { highOnly = e.target.checked; render(); });

load();
