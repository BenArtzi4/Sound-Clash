# Sound Clash: Search, AI Answers & Link Previews

How the site presents itself to search engines, AI answer engines (ChatGPT search, Perplexity, Claude, Copilot) and link-preview bots (WhatsApp, iMessage, Slack, Discord, X). Read this before adding a public page or changing a page's title, description or words.

---

## 1. Canonical host

**`https://www.soundclash.org`** is the one address. Every canonical link, `og:url`, sitemap entry, JSON-LD `url` and `llms.txt` link uses it.

The apex `soundclash.org` 301s to `https://www.soundclash.org` with the path kept (a Cloudflare redirect rule, since DNS moved to Cloudflare on 2026-09-25). `sound-clash.pages.dev` is an identical copy kept out of search by `X-Robots-Tag` (§4).

## 2. One source: `frontend/src/seo/pages.json`

Every public page's head lives in one file:

| Field | Meaning |
|---|---|
| `origin` | `https://www.soundclash.org` |
| `siteName` | `Sound Clash`, the tab title on pages that are not listed |
| `pages[].path` | The route |
| `pages[].file` | Where the build writes that page's HTML (`/` → `index.html`, `/manager/create` → `manager/create.html`) |
| `pages[].inSitemap` | Listed in `sitemap.xml` |
| `pages[].title`, `description` | `<title>` and `meta name="description"` |
| `pages[].ogTitle`, `ogDescription` | Optional share-card text; defaults to `title` / `description` |
| `pages[].updated` | The date the page's words last changed: the sitemap's `lastmod`. Bump it when you edit the text, not on every deploy |
| `pages[].prerender` | The build writes the page's body into its HTML (§3) |
| `pages[].module` | For a prerendered page that is a lazy chunk: its source file, whose stylesheet the HTML links |
| `pages[].landing` | A search landing page: routed to `LandingPage`, words in `src/seo/landing/` |
| `pages[].nav` | Its link text in the footer of the content pages (`SiteFooter`); unlisted if absent |

The content pages are `/`, `/how-to-play` and the six landing pages (§5); all eight are prerendered and in the sitemap. `/join`, `/manager/create` and `/display` are entry screens with a form: they get their own head but no body and are not in the sitemap.

Readers of the file:

- **The build** (§3) writes each page's HTML, the sitemap, `llms.txt` and `llms-full.txt` from it.
- **The app.** `src/lib/routeHead.ts` (mounted as `<RouteHead />` in `App.tsx`) applies the same head tags on every client-side navigation, so a title never differs between the first load and a later in-app tap. An unlisted path (`/team/ABCDEF`, `/manager/game/…`, `/admin/songs`) gets the brand as its tab title and the home page's description and canonical.
- **`App.tsx`** routes every `landing` entry to `LandingPage`; **`SiteFooter`** links every `nav` entry.

`frontend/index.html` itself carries the `/` entry's values, so `vite dev` shows the right head; keep it in step when the home text changes.

## 3. The build: prerendered pages

The app is a single-page app, and until October 2026 every URL was served the same `index.html` with an empty `<div id="root">`. Google runs JavaScript and eventually saw the page; Bing only partly, and the AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot) and every link-preview bot never do, so to them the site had no words at all. `npm run build` (and `build:preview`) now runs:

1. `vite build`: the client bundle, plus `dist/.vite/manifest.json`.
2. `node scripts/check-bundle.mjs`.
3. `vite build --ssr src/entry-server.tsx`: a Node bundle of the same app into `dist-ssr/`.
4. `node scripts/prerender.mjs`, which for every `pages.json` entry copies the built `index.html` and:
   - replaces the title, description, canonical and og/twitter tags (each pattern must match the template exactly once, or the build fails);
   - adds the page's JSON-LD (`src/seo/structuredData.ts`);
   - for `prerender` pages, writes the markup `render(path)` returns into `<div id="root" data-prerendered="/path">`, and for a lazy page links its chunk's stylesheet and module preload (from the manifest) so the markup paints styled before any script runs.

   It also writes `dist/spa-shell.html` (the untouched shell: empty root, the home page's head), `dist/404.html` (the same shell plus `meta robots noindex`), `sitemap.xml`, `llms.txt` and `llms-full.txt`, and finally deletes `dist/.vite` and `dist-ssr`.

`render()` (`src/entry-server.tsx`) renders App's own route tree (`AppRoutes`) under a `StaticRouter` with React's `prerender`, which waits for lazy pages to load instead of writing their loading spinner. In the browser, `main.tsx` checks `data-prerendered` against the current path: a match is **hydrated** (React adopts the server's DOM, so nothing repaints and Home's intro animation is not restarted); anything else is cleared and rendered fresh.

Rules that keep hydration working:

- The server tree and the client tree are one tree (`AppRoutes`). A wrapper that adds a DOM node on one side only makes React throw the server markup away. `src/entry-server.test.tsx` hydrates every prerendered page in jsdom and fails if React replaces the server's H1 or reports a hydration error.
- A prerendered page must not read `window`, `localStorage` or the time while rendering (effects are fine: they run only in the browser). `HomePage`'s `introPending` is the one deliberate exception, guarded for the server.
- No `useId` in prerendered pages unless both trees are proven to match.
- Inline `style` attributes in the prerendered HTML need `style-src-attr 'unsafe-inline'` in the CSP (`_headers`; see `security-rls.md` §7).

### Routing on Cloudflare Pages (`frontend/public/_redirects`)

A static file always wins, so `/`, `/how-to-play`, every landing page, `/join`, `/manager/create` and `/display` are served their own HTML. The per-game and admin screens (`/join/*`, `/team/*`, `/manager/game/*`, `/display/*`, `/admin/*`) are rewritten to `/spa-shell`, whose root is empty: a player scanning a QR code must never see the home page's markup flash first. **There is no `/*` catch-all**: any other URL gets `404.html` with a real 404 status (the app on it still sends the visitor home), so a typo or an old backlink is never a "soft 404" to Google, and `/llms.txt` can never be answered with HTML. `src/lib/redirects.test.ts` fails if a route in `App.tsx` is served by neither a file nor a rewrite. **A new client-side route with a URL parameter needs its line in `_redirects`.**

`npm run dev` and the e2e suite use Vite's dev server, which skips all of this. To check the real routing locally, build and run Cloudflare's emulator (no install; it is the same `wrangler` CI deploys with): `npx wrangler@4 pages dev dist --port 8788 --compatibility-date=2026-05-01`.

## 4. What tells crawlers what

| Mechanism | Where | What it does |
|---|---|---|
| Prerendered body | build (§3) | The real words of every content page in the HTML |
| `robots.txt` | `frontend/public/robots.txt` | Allows every crawler, AI search crawlers included, and points at the sitemap and `llms.txt`. Per-game pages are deliberately **not** disallowed: a crawler has to fetch a page to see its `X-Robots-Tag` |
| `sitemap.xml` | generated into `dist/` | The `inSitemap` pages with their `lastmod` (`updated`) |
| `llms.txt`, `llms-full.txt` | generated by `src/seo/llms.ts` | The [llmstxt.org](https://llmstxt.org) index (summary, key facts, links) and the full text of Home and every landing page, built from the same strings the pages render and the scoring constants in `lib/scoring.ts`. Few AI crawlers fetch it yet (Google ignores it); it is cheap and cannot drift |
| JSON-LD `WebSite` | inline in `frontend/index.html` | The site name ("Sound Clash", alternates "SoundClash" and "Sound Clash game") Google shows above results |
| JSON-LD per page | `src/seo/structuredData.ts` | Home: `Organization`, `WebApplication`+`VideoGame` (free, multiplayer, browser), `FAQPage`. Landing pages: `FAQPage`. No ratings or reviews: we have none, and Google's app star snippet needs real ones. FAQ rich results left Google in 2026; the blocks stay for engines that read them |
| `X-Robots-Tag: noindex, nofollow` | `frontend/public/_headers` | `/team/*`, `/manager/game/*`, `/admin/*`, `/join/*`, `/display/*`, `/spa-shell`: one-off, code-specific URLs that must never be search results. The bare `/join`, `/display` and `/manager/create` stay indexable |
| `meta robots noindex` + 404 status | `dist/404.html` | Unknown URLs |
| `X-Robots-Tag: noindex` on `https://:project.pages.dev/*` | `frontend/public/_headers` | Keeps `sound-clash.pages.dev` out of search; matches only the pages.dev host |
| `/html/* → / 301` | `frontend/public/_redirects` | A previous owner of the domain (a reggae sound-system archive) left `/html/en/welcome/` in search indexes |
| Visually hidden "Sound Clash:" in the Home H1 | `src/pages/HomePage.tsx` | The page's one heading names the site |
| Footer links | `src/components/SiteFooter.tsx` | Every content page links every other one with descriptive text |
| `X-Robots-Tag: noindex` on the API | `backend/app/middleware/cors.py` | Every FastAPI response, including the Swagger UI at `api.soundclash.org/docs` |

## 5. What each page is written for

Researched 2026-10-29 (SERP checks, competitor pages). The bare query "guess the song" belongs to app stores and daily puzzles (SongPop, Bandle, Heardle clones) and is out of reach for a young site; the winnable searches are the ones that match what Sound Clash is: a host-led game for a group in one room.

| Page | Primary phrase | Also written for |
|---|---|---|
| `/` | guess the song party game | music trivia party game, guess-the-song game, music quiz you play together |
| `/guess-the-song-with-friends` | guess the song with friends | guess the song multiplayer, … online with friends, group guess the song game |
| `/music-trivia-buzzer-game` | music trivia buzzer game | buzz-in music quiz, phone buzzer game, music quiz on TV, quiz buzzer app |
| `/music-trivia-night` | how to host a music trivia night | music quiz for a party, family music quiz, office team-building music game |
| `/soundtrack-quiz` | movie soundtrack quiz | guess the movie by the song, TV theme song quiz, Disney songs quiz |
| `/kahoot-music-quiz-alternative` | Kahoot music quiz alternative | Kahoot-style music game, music quiz with a room code |
| `/hitster-alternative` | Hitster alternative | free Hitster alternative online, music party game without cards |

The two comparison pages describe the other product only by facts its maker publishes, say when it is the better choice, and say Sound Clash is not affiliated with it (`landingContent.test.ts` checks the last part).

Not built, on purpose for now: a Hebrew page. The Hebrew searches (נחש את השיר, משחק נחש את השיר) were the least contested in the research, and the maintainer decided against a Hebrew page on 2026-09-25; revisit if that changes.

## 6. Adding a public page

**A landing page:**

1. Write its words in `frontend/src/seo/landing/<slug>.ts` (copy an existing one; plain strings only) and add it to `LANDING_CONTENT` in `src/seo/landingContent.ts`.
2. Add a `pages.json` entry: `path`, `file`, `inSitemap: true`, `title` (primary phrase first, ending "| Sound Clash", at most 62 characters), a 100–170 character `description`, `updated`, `prerender: true`, `module: "src/pages/LandingPage.tsx"`, `landing: true` and a `nav` label.
3. Add a row to §5.

Nothing else: the route, the footer link, the HTML file, the sitemap line, the JSON-LD and the `llms*.txt` text follow. The tests check the content rules: one entry per page, at least three sections, four FAQs and 500 words, no unbacked claims ("the best", ratings, awards), no em dashes, only the game's real point values, and every fact true of the live game (`docs/game-rules.md`).

**Any other page:** add the route in `App.tsx` and an entry in `pages.json` (`prerender` only if its render reads no browser state). If the page is per-game or private instead, leave it out of `pages.json`, add a `_redirects` rewrite to `/spa-shell` and an `X-Robots-Tag` rule to `_headers`.

## 7. Checking a deploy

After the Cloudflare deploy for the merge commit is green (use `curl -sI` for status lines; `curl -w "%{http_code}"` prints `000` on the maintainer's Windows machine):

```bash
B=https://www.soundclash.org
# Content pages carry their words, title and canonical in the raw HTML
curl -s $B/ | grep -o 'data-prerendered="[^"]*"'
curl -s $B/music-trivia-night | grep -o '<h1[^>]*>[^<]*'
curl -s $B/how-to-play | grep -o '<link rel="canonical"[^>]*>'

# Per-game pages get the empty shell, are noindex, and still load the app
curl -s $B/join/ABCDEF | grep -c 'data-prerendered'      # 0
curl -sI $B/team/ABCDEF | grep -iE '^(HTTP|x-robots)'

# Unknown URLs are a real 404; the legacy path still redirects home
curl -sI $B/no-such-page | head -1                       # 404
curl -sI $B/html/en/welcome/ | grep -iE '^(HTTP|location)'

# Machine-readable files are files, not the app
curl -sI $B/llms.txt | grep -i content-type               # text/plain
curl -s $B/sitemap.xml
curl -s $B/robots.txt
```

Then load `/`, `/how-to-play` and one landing page in a browser with the console open: no hydration warnings, no CSP errors. If the first fetch shows the previous deploy's asset hashes, add `?cb=$(date +%s)`: the Cloudflare edge can serve the old HTML for a short while after a deploy. Paste a landing page URL into Google's Rich Results Test once to confirm the JSON-LD parses.

## 8. Owner tasks and growth (outside the repo)

Done 2026-09-25: Search Console Domain property (TXT record in Cloudflare; never delete it), sitemap submitted, Bing Webmaster imported from Search Console.

After each release that adds pages:

- **Search Console → Sitemaps:** resubmit `https://www.soundclash.org/sitemap.xml`; **URL Inspection → Request indexing** for each new page (a few a day).
- **Bing Webmaster:** confirm the sitemap shows the new URL count (Bing also feeds Copilot, DuckDuckGo and Yahoo).

One-time Cloudflare settings (dashboard, not in the repo):

- **AI Crawl Control / bot policies** (Security settings): zones created after 2026-09-15 default to blocking AI *training* and *agent* bots on pages with ads; the site has no ads, but check that AI *search* and *agent* crawlers are allowed, and choose the training setting deliberately.
- **Crawler Hints** (Caching → Configuration): free; pings IndexNow (Bing, Yandex, Seznam, Naver) when pages change, so new pages are found in days, not weeks.

Getting found beyond our own pages (links from elsewhere matter more than anything on-page for a new site):

| Where | Fit | Notes |
|---|---|---|
| Product Hunt | One-day spike, a lasting link | Launch as "Sound Clash – guess-the-song party game"; another "Soundclash" (a music league) is already listed |
| AlternativeTo | Steady discovery | "Suggest new application", then list it as an alternative to SongPop, Heardle, SongTrivia, Hitster, Kahoot! |
| Show HN | Developers, one day | Lead with the engineering story: a Postgres buzzer race, under 200 ms on free hosting |
| Reddit | r/playmygame, r/SideProject, r/IndieDev | Read each sidebar's self-promotion rules first |
| Listicles | "music guessing games online", "games like SongPop" | Ask the authors of onlineparty.games, weekend.com, partyroomgames.com and gamenightcentral.net to consider it |
| Israeli press | mako, ynet, Geektime | A Hebrew-and-English guess-the-song game made in Israel; mako has covered a similar Hebrew song game |
| Own channels | Instagram / LinkedIn videos, the GitHub README | Link `https://www.soundclash.org/` and the matching guide page |

Poor fits: CrazyGames and Poki (they need their SDK and hosted builds), itch.io (prefers uploaded games over links).

**Measuring it:** Search Console → Performance → Queries, filtered to each page, monthly. Expect the long-tail pages to show impressions within weeks and clicks within two to three months; "guess the song party game" and the brand queries first.
