// Bundle guard — runs straight after `vite build` (see package.json "build").
//
// `@formkit/auto-animate` is the redesign's one approved dependency and it is
// approved for the Display chunk ONLY (README decision 7): the player and host
// consoles are the latency-critical screens and must not pay for a TV-board
// nicety. Import it from any module those routes reach and Rolldown hoists it
// into the shared entry chunk — invisible in review, caught here.
//
// Attribution comes from each chunk's SOURCEMAP, not from grepping the minified
// code: the bundler strips every literal occurrence of the package name, so a
// text match would report "absent" for a chunk that in fact carries the whole
// library. A chunk without a sourcemap is a hard failure rather than a silent
// pass. The one code-level check left is `startViewTransition`, a DOM property
// access that survives minification intact.
//
// `startViewTransition` is banned from the two latency-critical route chunks. A
// running view transition suspends pointer hit-testing document-wide for its
// duration (03-library-evaluation.md 2.2), so it must never wrap a buzz, a
// scoring click, or a Realtime update. Both pages navigate — the console's
// terminal states link home — but only through the shared hook in
// `index-*.js`; the string appearing INSIDE either page chunk means the hook
// was inlined there, i.e. that page became its only caller, which is exactly
// the change that deserves a second look.
import { readdirSync, readFileSync, existsSync } from "node:fs";

const dir = "dist/assets";
const BANNED = ["framer-motion", "lenis", "gsap"];
const SCOPED = "@formkit/auto-animate";
const SCOPED_CHUNK = "DisplayPage-";
const NO_VIEW_TRANSITION_CHUNKS = ["TeamGameplayPage-", "ManagerConsolePage-"];

const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error(`check-bundle: no .js emitted in ${dir} — did the build run?`);
  process.exit(1);
}

let failed = false;
const carriers = [];

for (const f of files) {
  const mapPath = `${dir}/${f}.map`;
  if (!existsSync(mapPath)) {
    // The bundler's own runtime shim is generated, not compiled from any
    // module, so it ships without a map. Every other map-less chunk is a
    // failure: without a map this guard cannot see what is inside it.
    if (f.startsWith("rolldown-runtime-")) continue;
    console.error(`check-bundle: ${f} has no sourcemap — cannot attribute its modules`);
    failed = true;
    continue;
  }
  const modules = JSON.parse(readFileSync(mapPath, "utf8")).sources ?? [];

  for (const b of BANNED) {
    if (modules.some((m) => m?.includes(`node_modules/${b}/`))) {
      console.error(`check-bundle: ${f} contains banned dependency "${b}"`);
      failed = true;
    }
  }

  if (modules.some((m) => m?.includes(`node_modules/${SCOPED}/`))) {
    carriers.push(f);
    if (!f.startsWith(SCOPED_CHUNK)) {
      console.error(
        `check-bundle: ${f} contains "${SCOPED}" (allowed only in ${SCOPED_CHUNK}*.js)`,
      );
      failed = true;
    }
  }

  if (
    NO_VIEW_TRANSITION_CHUNKS.some((p) => f.startsWith(p)) &&
    readFileSync(`${dir}/${f}`, "utf8").includes("startViewTransition")
  ) {
    console.error(
      `check-bundle: ${f} calls startViewTransition (banned on the buzz and scoring screens)`,
    );
    failed = true;
  }
}

if (!carriers.some((f) => f.startsWith(SCOPED_CHUNK))) {
  console.error(
    `check-bundle: no ${SCOPED_CHUNK}*.js carries "${SCOPED}" — the board reorder would be dead`,
  );
  failed = true;
}

if (!failed) {
  console.log(
    `check-bundle: ${files.length} chunks scanned; "${SCOPED}" only in ${carriers.join(", ")}`,
  );
}
process.exit(failed ? 1 : 0);
