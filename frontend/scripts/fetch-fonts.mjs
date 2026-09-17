// frontend/scripts/fetch-fonts.mjs
// Usage: node scripts/fetch-fonts.mjs   (from frontend/)
import { mkdir, writeFile } from "node:fs/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const FAMILIES = [
  { css: "Anton", subset: "latin", out: "anton-latin.woff2" },
  { css: "Instrument+Sans:wght@400..700", subset: "latin", out: "instrument-sans-latin.woff2" },
  { css: "Secular+One", subset: "hebrew", out: "secular-one-hebrew.woff2" },
  { css: "Heebo:wght@400..900", subset: "hebrew", out: "heebo-hebrew.woff2" },
];

await mkdir("public/fonts", { recursive: true });
for (const f of FAMILIES) {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${f.css}&display=swap`, {
    headers: { "User-Agent": UA },
  }).then((r) => r.text());
  // Blocks look like: /* hebrew */ @font-face { ... src: url(https://fonts.gstatic.com/...woff2) format('woff2'); unicode-range: U+0590-05FF, ... }
  const block = css.split("/* ").find((b) => b.startsWith(`${f.subset} */`));
  if (!block) throw new Error(`no ${f.subset} block for ${f.css}`);
  const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  const range = block.match(/unicode-range:\s*([^;]+);/)?.[1];
  if (!url || !range) throw new Error(`could not parse ${f.css}`);
  const bytes = new Uint8Array(await fetch(url).then((r) => r.arrayBuffer()));
  await writeFile(`public/fonts/${f.out}`, bytes);
  console.log(`${f.out}\t${bytes.length} bytes\tunicode-range: ${range}`);
}
