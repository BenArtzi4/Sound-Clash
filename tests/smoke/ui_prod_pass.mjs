#!/usr/bin/env node
// Sound Clash UI-redesign post-merge prod pass. Scripts the checks in
// docs/planning/ui-redesign/06-validation-plan.md §2.4 (deploy verification)
// and §8 (the visual/behaviour pass) so they run the same way after every
// redesign merge (Tasks 1-11) instead of being re-derived each session.
//
// Usage (from the repo root, with the Claude Code Bash sandbox DISABLED —
// everything here is prod egress):
//   node tests/smoke/ui_prod_pass.mjs all      # deploy → setup → run → end (the normal pass)
//   node tests/smoke/ui_prod_pass.mjs deploy   # §2.4 only: chunk hashes, CSS markers, font caching
//   node tests/smoke/ui_prod_pass.mjs setup    # create the throwaway game, write <out>/game.json
//   node tests/smoke/ui_prod_pass.mjs run      # §8 screenshots + probes for the game in <out>/game.json
//   node tests/smoke/ui_prod_pass.mjs end      # end that game (also runs automatically after `all`)
//
// Options:
//   --site <url>      default https://www.soundclash.org   (use www. — the apex host is flaky from here)
//   --api <url>       default https://api.soundclash.org
//   --out <dir>       default tests/smoke/.prod-pass       (git-ignored; screenshots, game.json, report.json)
//   --genres <slugs>  default israeli-pop,mizrahit,israeli-rock-pop — Israeli-only so the draw is Hebrew (§8 step 12)
//   --teams <n>       default 4 (≤ 5 keeps the Display's "+N more teams" hint absent, §8 step 10)
//
// Needs Playwright's chromium, borrowed from tests/e2e (`cd tests/e2e && npm install && npx playwright install chromium`
// once). No other dependency. Exit code 0 when every HARD gate passes, 1 otherwise; SOFT findings (the
// emoji sweep, reduced-motion counts, missing dir="auto") are printed and expected to stay non-zero until
// the task that owns them lands — see the README in this folder.
//
// Why a headless browser and not Claude-in-Chrome for the whole pass: Chrome cannot emulate 390 px or
// prefers-reduced-motion, its window resize is unreliable, and the manager console autoplays YouTube
// audio in the user's browser. The user's Chrome is still the right tool for eyeballing screenshots.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

// ---------- args ----------
const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith("--")) ?? "all";
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const SITE = opt("site", "https://www.soundclash.org").replace(/\/$/, "");
const API = opt("api", "https://api.soundclash.org").replace(/\/$/, "");
const OUT = resolve(REPO, opt("out", "tests/smoke/.prod-pass"));
const GENRES = opt("genres", "israeli-pop,mizrahit,israeli-rock-pop").split(",");
const TEAMS = Number(opt("teams", "4"));
mkdirSync(OUT, { recursive: true });

const GAME_FILE = join(OUT, "game.json");
const REPORT_FILE = join(OUT, "report.json");
const STATIC_ROUTES = ["/", "/join", "/manager/create", "/how-to-play"];
const ALLOWED_ANIMATED = new Set(["transform", "opacity", "filter", "clipPath", "clip-path", "visibility"]);
const CONSOLE_PATTERN = /error|CSP|Refused|violat/i;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2605}]/gu;

const hard = []; // [name, ok, detail]
const soft = []; // [name, detail]
const gate = (name, ok, detail = "") => hard.push([name, !!ok, detail]);
const note = (name, detail) => soft.push([name, detail]);

// ---------- http helpers ----------
async function json(url, init = {}) {
  const r = await fetch(url, init);
  const body = await r.text();
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url} -> ${r.status} ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function bundleInfo() {
  const html = await fetch(`${SITE}/?cb=${Date.now()}`).then((r) => r.text());
  const css = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.css/)?.[0];
  const js = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  if (!css || !js) throw new Error("could not find index-*.css / index-*.js in the deployed index.html");
  return { html, css, js };
}

async function supabaseClient() {
  const { js } = await bundleInfo();
  const bundle = await fetch(SITE + js).then((r) => r.text());
  const url = bundle.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0];
  const anon = bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  if (!url || !anon) throw new Error("could not read the Supabase URL / anon key out of the bundle");
  const headers = { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" };
  return {
    url,
    get: (path) => json(`${url}/rest/v1/${path}`, { headers }),
    rpc: (fn, args) => json(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) }),
  };
}

// ---------- §2.4 deploy verification ----------
async function verifyDeploy() {
  const { html, css, js } = await bundleInfo();
  console.log(`[deploy] index.html -> ${css}  ${js}`);
  const theme = html.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
  const scheme = html.match(/<meta name="color-scheme" content="([^"]+)"/)?.[1];
  gate("deploy: theme-color #14120e / color-scheme dark", theme === "#14120e" && scheme === "dark", `${theme} / ${scheme}`);
  const cssBody = await fetch(SITE + css).then((r) => r.text());
  for (const marker of ["--accent:#ff7a00", "--bg:#14120e", "Anton", "Instrument Sans", "color-scheme:dark"]) {
    gate(`deploy: css contains ${marker}`, cssBody.includes(marker));
  }
  for (const banned of ["bg-drift", "#f8fafc"]) gate(`deploy: css free of ${banned}`, !cssBody.includes(banned));
  const font = await fetch(`${SITE}/fonts/anton-latin.woff2`, { method: "HEAD" });
  const cc = font.headers.get("cache-control") ?? "";
  gate("deploy: /fonts/anton-latin.woff2 200 + immutable", font.status === 200 && cc.includes("immutable"), `${font.status} ${cc}`);
  return { css, js };
}

// ---------- §8 step 1: throwaway game ----------
async function setup() {
  const sb = await supabaseClient();
  const genres = await sb.get("genres?select=id,slug");
  const ids = genres.filter((g) => GENRES.includes(g.slug)).map((g) => g.id);
  if (ids.length !== GENRES.length) throw new Error(`genre slugs not all found; have ${genres.map((g) => g.slug).join(",")}`);

  const created = await json(`${API}/games`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected_genres: ids }) });
  const code = created.game_code;
  const token = created.manager_token;
  const mgr = { "Content-Type": "application/json", "X-Manager-Token": token };

  const teams = [];
  for (let i = 0; i < TEAMS; i++) {
    teams.push(await json(`${API}/games/${code}/teams`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Team ${String.fromCharCode(65 + i)}` }) }));
  }
  // distinct scores, descending; the bonus endpoint rejects > 50 points per call
  for (let i = 0; i < teams.length; i++) {
    await json(`${API}/games/${code}/bonus`, { method: "POST", headers: mgr, body: JSON.stringify({ team_id: teams[i].id, points: Math.max(5, 50 - i * 10) }) });
  }
  const sel = await sb.rpc("select_next_song", { p_game_code: code, p_manager_token: token });
  const round = Array.isArray(sel) ? sel[0] : sel;
  await sb.rpc("buzz_in", { p_game_code: code, p_team_id: teams[0].id });
  // Mark the title correct so the Display's reveal row shows the (Hebrew) title — §8 step 12.
  await sb.rpc("award_attempt", { p_game_code: code, p_round_id: round.round_id, p_correct_title: true, p_correct_artist: false, p_wrong: false, p_manager_token: token });

  const game = { site: SITE, api: API, code, managerToken: token, team: { id: teams[0].id, name: teams[0].name }, teams: teams.map((t) => ({ id: t.id, name: t.name })), round };
  writeFileSync(GAME_FILE, JSON.stringify(game, null, 1));
  console.log(`[setup] game ${code}: ${teams.length} teams, round ${round.round_number} "${round.song_title}" — ${round.song_artist}; wrote ${GAME_FILE}`);
  return game;
}

async function end(game) {
  const r = await json(`${game.api ?? API}/games/${game.code}/end`, { method: "POST", headers: { "Content-Type": "application/json", "X-Manager-Token": game.managerToken } });
  console.log(`[end] game ${game.code}: ${r.status} ${r.ended_at ?? ""}`);
}

// ---------- §8 steps 2-12 ----------
const pageProbe = () => {
  const cs = (el) => getComputedStyle(el);
  const h1 = document.querySelector("h1");
  const anims = document.getAnimations().map((a) => {
    const t = a.effect?.target;
    const timing = a.effect.getComputedTiming();
    return {
      name: a.animationName ?? a.constructor.name,
      target: t ? `${t.tagName.toLowerCase()}.${String(t.className || "").slice(0, 28)}` : "?",
      props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k).filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p))))],
      playState: a.playState,
      durationMs: timing.duration,
    };
  });
  const text = document.body.innerText;
  return {
    h1: h1 ? h1.textContent.trim().slice(0, 40) : null,
    h1Font: h1 ? cs(h1).fontFamily.split(",")[0] : null,
    bodyFont: cs(document.body).fontFamily.split(",")[0],
    bodyBg: cs(document.body).backgroundColor,
    anton: document.fonts.check('400 1em "Anton"'),
    instrument: document.fonts.check('1em "Instrument Sans"'),
    hOverflow: document.documentElement.scrollWidth > innerWidth,
    emoji: [...new Set(text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}\u{2605}]/gu) ?? [])],
    animations: anims,
    csp: window.__csp ?? [],
  };
};

async function run(game) {
  const require = createRequire(join(REPO, "tests", "e2e", "package.json"));
  const { chromium } = require("playwright");
  const CODE = game.code;
  const GAME_ROUTES = [`/display/${CODE}`, `/team/${CODE}`, `/manager/game/${CODE}`];
  const report = { site: SITE, code: CODE, console: {}, fonts: [], pages: {}, reducedMotion: {}, display: null, managerFit: null, routeTransition: null };

  const seed = `(() => { try {
    localStorage.setItem('game:${CODE}:manager-token', ${JSON.stringify(game.managerToken)});
    localStorage.setItem('game:${CODE}:team', ${JSON.stringify(JSON.stringify(game.team))});
    window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.blockedURI + ' ' + e.violatedDirective));
  } catch {} })();`;

  const browser = await chromium.launch();
  const newCtx = async (opts) => {
    const ctx = await browser.newContext({ deviceScaleFactor: 1, ...opts });
    await ctx.addInitScript(seed);
    return ctx;
  };
  const wire = (page, key) => {
    report.console[key] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || CONSOLE_PATTERN.test(m.text())) report.console[key].push(`[${m.type()}] ${m.text().slice(0, 160)}`);
    });
    page.on("pageerror", (e) => report.console[key].push(`[pageerror] ${e.message.slice(0, 160)}`));
    page.on("response", (r) => {
      if (r.url().includes("/fonts/")) report.fonts.push({ url: r.url().replace(SITE, ""), status: r.status(), cacheControl: r.headers()["cache-control"] ?? null });
    });
  };
  const settle = async (page, route) => {
    if (route.startsWith("/manager/game")) await page.waitForSelector("[data-testid=score-title], [data-testid=start-round]", { timeout: 45000 }).catch(() => {});
    if (route.startsWith("/display")) await page.waitForSelector("li[data-team-id]", { timeout: 20000 }).catch(() => {});
    if (route.startsWith("/team")) await page.waitForSelector("[data-testid=buzz]", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };
  const slugOf = (r) => (r === "/" ? "home" : r.slice(1).replaceAll("/", "-"));

  try {
    // step 2 (+3-7): desktop screenshots + probes at 1280x800 and 1920x1080
    for (const [w, h] of [[1280, 800], [1920, 1080]]) {
      const ctx = await newCtx({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      wire(page, `desktop${w}`);
      for (const r of [...STATIC_ROUTES, ...GAME_ROUTES]) {
        await page.goto(SITE + r, { waitUntil: "load" });
        await settle(page, r);
        await page.screenshot({ path: join(OUT, `${slugOf(r)}-${w}.jpeg`), type: "jpeg", quality: 80 });
        report.pages[`${r} @${w}`] = await page.evaluate(pageProbe);
      }
      if (w === 1280) {
        // step 11: route transition click-through.
        //
        // Wait for the URL, not just an <h1>: since Task 10 a link click routes
        // through useViewTransitionNavigate, which awaits the chunk preload and
        // then commits inside startViewTransition — so `location` lags the click
        // by tens of ms, and every page here has an <h1> already, which makes
        // waitForSelector("h1") resolve instantly on the OLD page. Swallowing the
        // timeout keeps a genuinely dropped click reporting as a red gate below
        // (the path simply never changes) rather than as a thrown exception that
        // would lose the rest of the run's output.
        const arrive = async (path) => {
          await page.waitForURL((u) => new URL(u).pathname === path, { timeout: 5000 }).catch(() => {});
          await page.waitForSelector("h1");
        };
        await page.goto(SITE + "/", { waitUntil: "load" });
        await page.click('a[href="/manager/create"]');
        await arrive("/manager/create");
        const afterClick = await page.evaluate(() => ({ path: location.pathname, scrollY, hasContent: document.body.innerText.length > 50 }));
        await page.goBack();
        await arrive("/");
        const afterBack = await page.evaluate(() => ({ path: location.pathname, scrollY }));
        await page.click('a[href="/join"]');
        await arrive("/join");
        const join = await page.evaluate(() => ({ path: location.pathname, hasContent: document.body.innerText.length > 50 }));
        report.routeTransition = { afterClick, afterBack, join };
      }
      await ctx.close();
    }

    // step 10 + 12: display fit at 1920x1080 and the Hebrew reveal row
    {
      const ctx = await newCtx({ viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      wire(page, "display1920");
      await page.goto(`${SITE}/display/${CODE}`, { waitUntil: "load" });
      await settle(page, "/display");
      report.display = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("li[data-team-id]")];
        const reveal = [...document.querySelectorAll("[data-testid^=display-reveal]")].map((el) => ({
          testid: el.dataset.testid,
          text: el.textContent.trim().slice(0, 60),
          dirAttr: el.getAttribute("dir"),
          clipped: el.scrollWidth > el.clientWidth + 1,
          hebrew: /[֐-׿]/.test(el.textContent),
        }));
        const timer = document.querySelector("[role=timer]");
        return {
          scrollH: document.documentElement.scrollHeight, innerH: innerHeight,
          rows: rows.length, rowSpans: rows.map((r) => r.children.length),
          moreTeams: document.querySelectorAll("[data-testid=more-teams]").length,
          timer: timer ? timer.textContent.trim() : null,
          reveal,
        };
      });
      await page.screenshot({ path: join(OUT, "display-1920-fit.jpeg"), type: "jpeg", quality: 80 });
      await ctx.close();
    }

    // step 9: manager console fit at 390x844
    {
      const ctx = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      wire(page, "manager390");
      await page.goto(`${SITE}/manager/game/${CODE}`, { waitUntil: "load" });
      const rendered = await page.waitForSelector("[data-testid=score-title]", { timeout: 45000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(1500);
      report.managerFit = await page.evaluate(() => {
        const ids = ["score-title", "score-artist", "score-wrong", "score-bonus", "continue-round", "start-round", "end-game"];
        const bottoms = {};
        for (const id of ids) {
          const el = document.querySelector(`[data-testid=${id}]`);
          bottoms[id] = el ? Math.round(el.getBoundingClientRect().bottom) : "absent";
        }
        return { innerH: innerHeight, scrollH: document.documentElement.scrollHeight, bottoms };
      });
      report.managerFit.rendered = rendered;
      await page.screenshot({ path: join(OUT, "manager-390.jpeg"), type: "jpeg", quality: 80 });
      await ctx.close();
    }

    // step 8: reduced motion on every route
    {
      const ctx = await newCtx({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      wire(page, "reducedMotion");
      for (const r of [...STATIC_ROUTES, ...GAME_ROUTES]) {
        await page.goto(SITE + r, { waitUntil: "load" });
        await settle(page, r);
        report.reducedMotion[r] = await page.evaluate(() =>
          document.getAnimations().map((a) => ({ name: a.animationName ?? a.constructor.name, playState: a.playState, durationMs: a.effect.getComputedTiming().duration })),
        );
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  // ---------- gates ----------
  for (const [k, v] of Object.entries(report.console)) gate(`console clean (${k})`, v.length === 0, v.slice(0, 3).join(" | "));
  const csp = Object.values(report.pages).flatMap((p) => p.csp);
  gate("no CSP violations", csp.length === 0, csp.slice(0, 3).join(" | "));
  const fontFails = Object.entries(report.pages).filter(([, p]) => !p.instrument || !p.bodyFont.includes("Instrument Sans") || (p.h1 && !p.anton)).map(([k]) => k);
  gate("fonts: Instrument Sans everywhere, Anton wherever an h1 exists", fontFails.length === 0, fontFails.join(", "));
  const badAnim = Object.entries(report.pages).flatMap(([k, p]) => p.animations.flatMap((a) => a.props.filter((x) => !ALLOWED_ANIMATED.has(x)).map((x) => `${k}: ${a.target} animates ${x}`)));
  gate("animations only transform/opacity/filter/clip-path/visibility", badAnim.length === 0, badAnim.slice(0, 3).join(" | "));
  const overflow = Object.entries(report.pages).filter(([, p]) => p.hOverflow).map(([k]) => k);
  gate("no horizontal overflow", overflow.length === 0, overflow.join(", "));
  const fontResp = [...new Map(report.fonts.map((f) => [f.url, f])).values()];
  gate("fonts served 200 + immutable from /fonts/*", fontResp.length > 0 && fontResp.every((f) => f.status === 200 && (f.cacheControl ?? "").includes("immutable")), fontResp.map((f) => `${f.url} ${f.status}`).join(", "));
  const d = report.display;
  const expectRows = Math.min(game.teams.length, 5);
  gate("display 1920x1080 fits without scroll", d.scrollH <= d.innerH, `${d.scrollH} vs ${d.innerH}`);
  gate(`display shows ${expectRows} rows x 3 spans`, d.rows === expectRows && d.rowSpans.every((n) => n === 3), `${d.rows} rows, spans ${d.rowSpans.join("/")}`);
  gate("display: +N more teams hint absent with <= 5 teams", game.teams.length > 5 || d.moreTeams === 0);
  if (d.timer !== null) gate("display timer text is seconds only", /^\d{1,2}s$/.test(d.timer), d.timer);
  const title = d.reveal.find((r) => r.testid === "display-reveal-title");
  gate("display reveal row: Hebrew title present and not clipped", !!title && title.hebrew && !title.clipped, title ? title.text : "no title reveal row");
  const m = report.managerFit;
  gate("manager 390x844: score buttons rendered", m.rendered);
  gate("manager 390x844: every action button above the fold", Object.values(m.bottoms).every((b) => b === "absent" || b <= m.innerH), JSON.stringify(m.bottoms));
  gate("manager 390x844: no vertical scroll", m.scrollH <= m.innerH, `${m.scrollH} vs ${m.innerH}`);
  const rt = report.routeTransition;
  gate("route transitions: Home -> Host -> back -> Join", rt.afterClick.path === "/manager/create" && rt.afterClick.hasContent && rt.afterClick.scrollY === 0 && rt.afterBack.path === "/" && rt.join.path === "/join" && rt.join.hasContent, JSON.stringify(rt));
  const rmRunning = Object.entries(report.reducedMotion).flatMap(([r, list]) => list.filter((a) => a.playState === "running" && a.durationMs > 1).map((a) => `${r}: ${a.name}`));
  gate("reduced motion: nothing running longer than 1 ms", rmRunning.length === 0, rmRunning.slice(0, 3).join(" | "));

  // ---------- soft findings (owned by later tasks) ----------
  for (const [k, p] of Object.entries(report.pages)) if (p.emoji.length && k.endsWith("@1280")) note(`emoji on ${k.replace(" @1280", "")} (Task 2)`, p.emoji.join(" "));
  for (const [r, list] of Object.entries(report.reducedMotion)) if (list.length) note(`reduced motion: ${list.length} finished/zero-length animation(s) still listed on ${r} (Task 4)`, [...new Set(list.map((a) => a.name))].join(", "));
  if (title && !title.dirAttr) note("display reveal row has no dir attribute yet (Task 9)", title.text);

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
  return report;
}

// ---------- main ----------
function printSummary() {
  console.log("\nHARD GATES");
  for (const [name, ok, detail] of hard) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  -- ${detail}` : ""}`);
  if (soft.length) {
    console.log("\nSOFT FINDINGS (expected until the named task lands)");
    for (const [name, detail] of soft) console.log(`  note  ${name}: ${detail}`);
  }
  const failed = hard.filter(([, ok]) => !ok).length;
  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}  ${hard.length - failed}/${hard.length} hard gates green; screenshots + report.json in ${OUT}`);
  return failed === 0;
}

const readGame = () => JSON.parse(readFileSync(GAME_FILE, "utf8"));
let ok = true;
try {
  if (cmd === "deploy") await verifyDeploy();
  else if (cmd === "setup") await setup();
  else if (cmd === "run") await run(readGame());
  else if (cmd === "end") await end(readGame());
  else if (cmd === "all") {
    await verifyDeploy();
    const game = await setup();
    try {
      await run(game);
    } finally {
      await end(game);
    }
  } else throw new Error(`unknown command ${cmd}; use all | deploy | setup | run | end`);
  if (cmd !== "setup" && cmd !== "end") ok = printSummary();
} catch (e) {
  console.error(`[ui_prod_pass] ${e.message}`);
  ok = false;
}
process.exit(ok ? 0 : 1);
