# Sound Clash: Search & Link Previews

How the site presents itself to search engines and to link-preview bots (WhatsApp, iMessage, Slack, Discord, X). Read this before adding a public page or changing a page's title or description.

---

## 1. Canonical host

**`https://www.soundclash.org`** is the one address. Every canonical link, `og:url`, sitemap entry and JSON-LD `url` uses it.

The apex `soundclash.org` is not usable as a canonical: it is a Namecheap URL Redirect that answers **HTTP only** (301 to `https://www.soundclash.org`, dropping the path) and has no HTTPS listener, so `https://soundclash.org` does not load. See [`tech-stack.md`](tech-stack.md) §5.

## 2. One source: `frontend/src/seo/pages.json`

Every public page's head lives in one file:

| Field | Meaning |
|---|---|
| `origin` | `https://www.soundclash.org` |
| `siteName` | `Sound Clash`, the tab title on pages that are not listed |
| `pages[].path` | The route, as declared in `App.tsx` |
| `pages[].file` | Where the build writes that page's HTML (`/` → `index.html`, `/manager/create` → `manager/create.html`) |
| `pages[].inSitemap` | Listed in `sitemap.xml` |
| `pages[].title`, `description` | `<title>` and `meta name="description"` |
| `pages[].ogTitle`, `ogDescription` | Optional share-card text; defaults to `title` / `description` |

Today the listed pages are `/`, `/how-to-play`, `/join`, `/manager/create` and `/display`. Only `/` and `/how-to-play` are in the sitemap: the other three are entry screens with a form, useful to land on from a search for the brand but not content worth submitting.

Two readers use it, so a title can never differ between the first load and a later in-app navigation:

- **The build.** `npm run build` (and `build:preview`) ends with `node scripts/prerender-heads.mjs`. It takes the built `dist/index.html` and writes one copy per page with that page's `<title>`, description, `link rel="canonical"`, `og:url`/`og:title`/`og:description` and `twitter:title`/`twitter:description`, plus `dist/sitemap.xml`. Cloudflare Pages serves `dist/how-to-play.html` at `/how-to-play` and prefers a static file over the `/* /index.html 200` catch-all in `_redirects`, so crawlers that do not run JavaScript (every link-preview bot, and many crawlers besides Google's) read the right head. Every replaced tag must match the template exactly once; if an edit to `index.html` breaks a pattern, the build fails instead of shipping a stale head.
- **The app.** `src/lib/routeHead.ts` (mounted as `<RouteHead />` in `App.tsx`) applies the same tags on every client-side navigation. An unlisted path (`/team/ABCDEF`, `/manager/game/…`, `/admin/songs`) gets the brand as its tab title and the home page's description and canonical, which is what the fallback `index.html` serves those URLs.

`frontend/index.html` itself carries the `/` entry's values, so `vite dev` shows the right head; keep it in step when the home text changes.

## 3. What tells crawlers what

| Mechanism | Where | What it does |
|---|---|---|
| `robots.txt` | `frontend/public/robots.txt` | Allows everything and points at the sitemap. Per-game pages are deliberately **not** disallowed: a crawler has to fetch a page to see its `X-Robots-Tag`. |
| `sitemap.xml` | generated into `dist/` by the build | The `inSitemap` pages, absolute `www` URLs, nothing else. There is no `public/sitemap.xml`. |
| `X-Robots-Tag: noindex, nofollow` | `frontend/public/_headers` | `/team/*`, `/manager/game/*`, `/admin/*`, `/join/*`, `/display/*`: one-off, code-specific URLs that must never be search results. The bare `/join`, `/display` and `/manager/create` stay indexable. |
| `X-Robots-Tag: noindex` on `https://:project.pages.dev/*` | `frontend/public/_headers` | Keeps `sound-clash.pages.dev`, the production alias (an identical copy of the site), out of search. Matches only the pages.dev host. |
| `/html/* → / 301` | `frontend/public/_redirects` | A previous owner of the domain left `/html/en/welcome/` in search indexes. It sits above the catch-all because rules match top-down. |
| JSON-LD `WebSite` | inline in `frontend/index.html` | Gives Google the site name ("Sound Clash", alternates "SoundClash" and "Sound Clash game") to show above results instead of the bare domain. |
| Visually hidden "Sound Clash:" in the Home H1 | `src/pages/HomePage.tsx` | The page's one heading names the site for crawlers and screen readers; nothing changes visually. |
| `X-Robots-Tag: noindex` on the API | `backend/app/middleware/cors.py` | Every FastAPI response, including the Swagger UI at `api.soundclash.org/docs` (titled "Sound Clash API"), stays out of search. |

## 4. Adding a public page

1. Add the route in `frontend/src/App.tsx`.
2. Add an entry to `frontend/src/seo/pages.json`: `path`, `file` (the path without its leading slash, plus `.html`), `inSitemap`, a `title` containing "Sound Clash", and a 100–170 character `description`.

Nothing else. The build writes the HTML file and the sitemap line, the runtime hook picks the entry up, and `src/lib/routeHead.test.ts` checks the entry against the route list and those rules. If the page is per-game or private instead, leave it out of `pages.json` and add an `X-Robots-Tag` rule to `_headers`.

## 5. Checking a deploy

After the Cloudflare deploy for the merge commit is green (use `curl -sI` for status lines; `curl -w "%{http_code}"` prints `000` on the maintainer's Windows machine):

```bash
# Each public page has its own title and canonical
curl -s https://www.soundclash.org/how-to-play | grep -o '<title>[^<]*'
curl -s https://www.soundclash.org/how-to-play | grep -o '<link rel="canonical"[^>]*>'

# Per-game pages still get the SPA, and are marked noindex
curl -s https://www.soundclash.org/join/ABCDEF | grep -o '<title>[^<]*'
curl -sI https://www.soundclash.org/team/ABCDEF | grep -i x-robots

# The entry pages are indexable (no X-Robots-Tag line expected)
curl -sI https://www.soundclash.org/join | grep -i x-robots

# robots.txt and the sitemap are real files, not index.html
curl -sI https://www.soundclash.org/robots.txt | grep -i content-type
curl -s https://www.soundclash.org/sitemap.xml

# The legacy path redirects home
curl -sI https://www.soundclash.org/html/en/welcome/ | grep -iE '^(HTTP|location)'

# The API is noindex
curl -sI https://api.soundclash.org/health | grep -i x-robots
```

If the first fetch shows the previous deploy's asset hashes, add `?cb=$(date +%s)` to the URL: the Cloudflare edge can serve the old HTML for a short while after a deploy.

## 6. Owner tasks (outside the repo)

- **Google Search Console:** add a **Domain** property for `soundclash.org`, verified with the TXT record it gives you, added in Namecheap's Advanced DNS. A Domain property covers `www`, the apex and `api` at once.
- **Submit the sitemap** there: `https://www.soundclash.org/sitemap.xml`.
- **Bing Webmaster Tools:** import the site from Search Console (one click; it also feeds DuckDuckGo and Yahoo).
- **Fix the HTTPS apex:** `https://soundclash.org` has no listener, so an HTTPS link to the bare domain fails. The Namecheap redirect cannot serve HTTPS; the usual fix is to move DNS to Cloudflare and add a redirect rule on the proxied apex to `https://www.soundclash.org`, keeping the path.
