// Plays every listed video in the game's own embed setup (index.html mirrors
// frontend/src/components/YouTubePlayer.tsx) in headless Chromium, from its
// stored start time. Pass = PLAYING with currentTime past the start.
//
// usage: node tools/song-curation/playtest/playtest.mjs <songs.json> [--port 8762]
//   songs.json: [{"id": "<youtube id>", "start": 12, "title": "optional label"}, ...]
//   (written by audit/validate.py and requests/gen_upload.py)
// Writes <songs>.results.json next to the input; exits 1 if any video fails.
// Needs Playwright from tests/e2e (cd tests/e2e && npm ci && npx playwright install chromium)
// and the network: run it with the sandbox disabled.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(HERE, "../../../tests/e2e/package.json"));
const { chromium } = require("playwright");

const input = process.argv[2];
if (!input) {
  console.log("usage: node playtest.mjs <songs.json> [--port 8762]");
  process.exit(2);
}
const portArg = process.argv.indexOf("--port");
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 8762;
const songs = JSON.parse(readFileSync(input, "utf-8"));
const outFile = input.replace(/\.json$/, "") + ".results.json";

// serve index.html on both loopback addresses: YouTube needs a real http
// origin, and some label videos refuse 127.0.0.1, so the page is opened as localhost
const page = readFileSync(resolve(HERE, "index.html"));
const handler = (req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
};
const servers = ["127.0.0.1", "::1"].map((host) => {
  const s = createServer(handler);
  s.on("error", () => {}); // no IPv6 loopback: the IPv4 one is enough
  s.listen(PORT, host);
  return s;
});

let browser = null;
const results = [];
const finish = (code) => {
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  const fails = results.filter((r) => !r.ok);
  for (const f of fails) console.log(`FAILED ${f.id} start=${f.start} ${f.title || ""} (${f.why})`);
  console.log(`DONE played=${results.length - fails.length}/${songs.length} fail=${fails.length} -> ${outFile}`);
  servers.forEach((s) => s.close());
  process.exit(code ?? (fails.length || results.length < songs.length ? 1 : 0));
};
// a watchdog inside the script: an outer `timeout` would kill node before cleanup
const watchdog = setTimeout(async () => {
  console.log("WATCHDOG: giving up");
  if (browser) await browser.close().catch(() => {});
  finish(1);
}, (songs.length * 60 + 90) * 1000);

try {
  browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const tab = await browser.newPage();
  await tab.goto(`http://localhost:${PORT}/index.html`);
  await tab.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  for (const [i, s] of songs.entries()) {
    let r = await tab.evaluate(([id, st]) => window.tryPlay(id, st), [s.id, s.start || 0]);
    if (!r.ok) r = await tab.evaluate(([id, st]) => window.tryPlay(id, st), [s.id, s.start || 0]); // one retry
    results.push({ ...s, ...r });
    console.log(`[${i + 1}/${songs.length}] ${r.ok ? "PLAY" : "FAIL " + r.why}  ${s.id}`);
  }
} catch (e) {
  console.log("HARNESS ERROR", e.message);
} finally {
  clearTimeout(watchdog);
  if (browser) await browser.close().catch(() => {});
  finish();
}
