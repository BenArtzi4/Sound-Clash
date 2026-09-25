// Pure, side-effect-free builders for the end-of-game setlist: the YouTube
// "play all" links, the plain-text list (for chat apps and playlist
// converters), and the downloadable keepsake page. No DOM and no network here --
// the Setlist component owns the song lookup, the font fetch and the download;
// these functions are unit-tested directly.

export interface ExportSong {
  round_number: number;
  title: string;
  artist: string;
  youtube_id: string;
  release_year: number | null;
  is_soundtrack: boolean;
  // Name of the team that claimed the title / the artist (null = nobody). A
  // soundtrack round's single "+15" claims both for the same team.
  title_by: string | null;
  artist_by: string | null;
}

export interface ExportTeam {
  name: string;
  score: number;
}

export interface ExportMeta {
  // Pre-formatted (formatGameDate) so the builder stays pure and
  // timezone-stable in tests.
  dateLabel: string;
  // Caller sorts, highest score first.
  teams: ExportTeam[];
}

// Display fonts to embed in the keepsake file, as data: URIs. Either may be
// missing (the fetch failed); the page then falls back to system faces.
export interface ExportFonts {
  anton?: string;
  secularOne?: string;
}

// YouTube's anonymous-playlist endpoint (watch_videos?video_ids=...) builds a
// temporary playlist from a comma-separated id list. It is undocumented and
// silently keeps only the first 50 ids, so longer games are split into parts.
export const YT_PLAYLIST_MAX = 50;

export interface PlaylistPart {
  url: string;
  // 1-based song positions this part covers, inclusive.
  from: number;
  to: number;
}

export function buildPlaylistParts(youtubeIds: string[]): PlaylistPart[] {
  const parts: PlaylistPart[] = [];
  for (let start = 0; start < youtubeIds.length; start += YT_PLAYLIST_MAX) {
    const chunk = youtubeIds.slice(start, start + YT_PLAYLIST_MAX);
    parts.push({
      url: `https://www.youtube.com/watch_videos?video_ids=${chunk.map(encodeURIComponent).join(",")}`,
      from: start + 1,
      to: start + chunk.length,
    });
  }
  return parts;
}

export function playlistPartLabel(part: PlaylistPart, partCount: number): string {
  return partCount === 1 ? "Play all on YouTube" : `Play songs ${part.from}–${part.to}`;
}

export function watchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
}

// Soundtrack rows store the film/show as the artist, and a theme often has the
// show's own name as its title ("Sherlock" by "Sherlock") -- showing both reads
// like a typo.
export function showArtist(song: ExportSong): boolean {
  const artist = song.artist.trim();
  return artist !== "" && artist.toLowerCase() !== song.title.trim().toLowerCase();
}

export interface CreditPart {
  label: string | null; // null = one team got the whole thing
  team: string;
}

export function creditParts(song: ExportSong): CreditPart[] {
  const { title_by: t, artist_by: a } = song;
  if (t !== null && t === a) return [{ label: null, team: t }];
  const parts: CreditPart[] = [];
  if (t !== null) parts.push({ label: "Song", team: t });
  if (a !== null) parts.push({ label: "Artist", team: a });
  return parts;
}

// "Got it: Alpha" / "Song: Alpha · Artist: Bravo" / "Nobody got it".
export function creditFor(song: ExportSong): string {
  const parts = creditParts(song);
  if (parts.length === 0) return "Nobody got it";
  return parts.map((p) => `${p.label ?? "Got it"}: ${p.team}`).join(" · ");
}

// One "Artist - Title" line per song: the shape TuneMyMusic, Soundiiz and
// Spotlistr parse, and still readable pasted into a group chat. No header or
// numbering -- a converter would try to match those as songs too.
export function buildSongsText(songs: ExportSong[]): string {
  return songs.map((s) => (showArtist(s) ? `${s.artist} - ${s.title}` : s.title)).join("\n");
}

export interface RankedTeam extends ExportTeam {
  rank: number;
}

// Dense rank over an already-sorted list: tied teams share a place and the next
// place is +1 (game-rules.md §4, matches EndScreen).
export function denseRanks(teams: ExportTeam[]): RankedTeam[] {
  let rank = 0;
  let prev: number | null = null;
  return teams.map((t) => {
    if (t.score !== prev) {
      rank += 1;
      prev = t.score;
    }
    return { ...t, rank };
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "25 Sep 2026" in the device's time zone. Built by hand rather than with
// toLocaleDateString so the English UI never picks up the browser's locale or
// an ICU-specific abbreviation.
export function formatGameDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function exportFileName(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `sound-clash-setlist-${date.getFullYear()}-${mm}-${dd}.html`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// The app's equaliser mark, inlined so the file needs nothing external.
const MARK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 15v-6M9.5 19V5M14 17V7M18.5 15v-6"/></svg>';
const PLAY_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

// Same unicode-range split the app's fonts.css uses: Anton has no Hebrew, so a
// Hebrew run falls through to Secular One.
const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const HEBREW_RANGE = "U+0307-0308, U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F";

function fontFaces(fonts: ExportFonts): string {
  const faces: string[] = [];
  if (fonts.anton) {
    faces.push(
      `@font-face { font-family: "Anton"; font-weight: 400; src: url("${fonts.anton}") format("woff2"); unicode-range: ${LATIN_RANGE}; }`,
    );
  }
  if (fonts.secularOne) {
    faces.push(
      `@font-face { font-family: "Secular One"; font-weight: 400; src: url("${fonts.secularOne}") format("woff2"); unicode-range: ${HEBREW_RANGE}; }`,
    );
  }
  return faces.join("\n");
}

// Colours are the app's tokens (styles.css :root), copied literally: the file is
// opened on its own, long after the game, with no stylesheet to inherit from.
const STYLES = `
:root {
  --bg: #14120e; --surface: #1d1a14; --surface-2: #26221a;
  --border: rgba(233, 228, 217, 0.14); --border-strong: rgba(233, 228, 217, 0.42);
  --text: #ffffff; --muted: #b4a88f; --dim: rgba(255, 255, 255, 0.55);
  --accent: #ff7a00; --bone: #e9e4d9;
  --display: "Anton", "Secular One", Impact, "Arial Narrow Bold", sans-serif;
  --ui: system-ui, -apple-system, "Segoe UI", Roboto, "Heebo", sans-serif;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text); font-family: var(--ui);
  line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
main { max-width: 44rem; margin: 0 auto; padding: 40px 16px 56px; }
a { color: inherit; }
.brand {
  display: inline-flex; align-items: center; gap: 0.45em; margin: 0;
  font-family: var(--display); font-size: 1.15rem; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--bone); text-decoration: none;
}
.brand svg { width: 1.15em; height: 1.15em; color: var(--accent); }
h1, h2 { font-family: var(--display); font-weight: 400; text-transform: uppercase; color: var(--bone); letter-spacing: 0.02em; }
h1 { margin: 24px 0 6px; font-size: clamp(2.75rem, 12vw, 4.5rem); line-height: 1; }
h2 { margin: 44px 0 14px; font-size: 1.75rem; line-height: 1.1; }
.meta { margin: 0; color: var(--muted); font-weight: 500; }
.winner {
  margin-top: 28px; padding: 20px 22px; background: var(--surface);
  border: 1px solid var(--accent); border-radius: 24px; box-shadow: inset 0 3px 0 var(--accent);
}
.winner-label { margin: 0 0 6px; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); }
.winner-names { margin: 0; font-family: var(--display); font-size: clamp(1.75rem, 8vw, 2.5rem); line-height: 1.1; color: var(--text); overflow-wrap: anywhere; }
.winner-score { margin: 6px 0 0; font-family: var(--display); font-size: 1.4rem; color: var(--bone); }
.winner-score small, .score small { font-family: var(--ui); font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; color: var(--muted); }
ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.team, .song {
  display: grid; align-items: center; gap: 12px; padding: 12px 14px;
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
}
.team { grid-template-columns: 36px 1fr auto; }
.team[data-rank="1"] { box-shadow: inset 3px 0 0 var(--accent); }
.rank {
  width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--display); color: var(--bone); background: var(--surface-2); border: 2px solid var(--border);
}
.team[data-rank="1"] .rank { border-color: var(--accent); }
.team[data-rank="2"] .rank, .team[data-rank="3"] .rank { border-color: var(--bone); }
.name { font-weight: 600; text-align: left; overflow-wrap: anywhere; }
.score { font-family: var(--display); font-size: 1.3rem; color: var(--bone); font-variant-numeric: tabular-nums; }
.play-all { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
.btn {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 18px;
  border-radius: 8px; border: 1px solid var(--accent); color: var(--accent);
  font-weight: 600; text-decoration: none;
}
.btn svg { width: 1em; height: 1em; }
.song { grid-template-columns: 34px 1fr 32px; text-decoration: none; color: inherit; }
.song:hover { border-color: var(--border-strong); }
.num { font-family: var(--display); font-size: 1.2rem; color: var(--muted); text-align: center; font-variant-numeric: tabular-nums; }
.song-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.title-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
.song-title { font-weight: 700; overflow-wrap: anywhere; }
.song-sub { color: var(--muted); font-size: 0.92rem; overflow-wrap: anywhere; }
.credit { font-size: 0.85rem; color: var(--bone); }
.credit.none { color: var(--dim); }
.tag {
  display: inline-block; padding: 1px 8px;
  border: 1px solid rgba(255, 122, 0, 0.5); border-radius: 999px;
  font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent);
}
.play {
  width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--border); color: var(--accent);
}
.play svg { width: 14px; height: 14px; margin-left: 2px; }
.empty { color: var(--muted); }
footer { margin-top: 48px; text-align: center; color: var(--muted); font-size: 0.9rem; }
footer a { color: var(--accent); }
`;

function teamsSection(teams: ExportTeam[]): string {
  if (teams.length === 0) return `  <p class="empty">No teams played.</p>`;
  const ranked = denseRanks(teams);
  const winners = ranked.filter((t) => t.rank === 1);
  const winnerBlock = `  <section class="winner">
    <p class="winner-label">${winners.length > 1 ? "Winners" : "Winner"}</p>
    <p class="winner-names">${winners.map((t) => `<bdi>${escapeHtml(t.name)}</bdi>`).join(" &amp; ")}</p>
    <p class="winner-score">${winners[0]!.score} <small>PTS</small></p>
  </section>`;
  const rows = ranked
    .map(
      (t) =>
        `      <li class="team" data-rank="${t.rank}"><span class="rank">${t.rank}</span><span class="name" dir="auto">${escapeHtml(t.name)}</span><span class="score">${t.score}</span></li>`,
    )
    .join("\n");
  return `${winnerBlock}
  <h2>Leaderboard</h2>
    <ol>
${rows}
    </ol>`;
}

function creditHtml(song: ExportSong): string {
  const parts = creditParts(song);
  if (parts.length === 0) return `<span class="credit none">Nobody got it</span>`;
  const text = parts
    .map((p) => `${p.label ?? "Got it"}: <bdi>${escapeHtml(p.team)}</bdi>`)
    .join(" · ");
  return `<span class="credit">${text}</span>`;
}

function songsSection(songs: ExportSong[]): string {
  if (songs.length === 0) return `  <p class="empty">No songs were played.</p>`;
  const parts = buildPlaylistParts(songs.map((s) => s.youtube_id));
  const playAll = parts
    .map(
      (p) =>
        `<a class="btn" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${PLAY_SVG}${playlistPartLabel(p, parts.length)}</a>`,
    )
    .join("");
  const rows = songs
    .map((s, i) => {
      const sub = [
        showArtist(s) ? `<span class="song-artist" dir="auto">${escapeHtml(s.artist)}</span>` : "",
        s.release_year !== null ? String(s.release_year) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const tag = s.is_soundtrack ? `<span class="tag">Soundtrack</span>` : "";
      return `      <li><a class="song" href="${escapeHtml(watchUrl(s.youtube_id))}" target="_blank" rel="noopener">
        <span class="num">${i + 1}</span>
        <span class="song-main"><span class="title-line"><span class="song-title" dir="auto">${escapeHtml(s.title)}</span>${tag}</span>${sub ? `<span class="song-sub">${sub}</span>` : ""}${creditHtml(s)}</span>
        <span class="play">${PLAY_SVG}</span>
      </a></li>`;
    })
    .join("\n");
  return `  <div class="play-all">${playAll}</div>
    <ol>
${rows}
    </ol>`;
}

// The keepsake page: a self-contained, offline-openable document in the game's
// own look -- winner, leaderboard, and the full setlist with who got each song.
// Every interpolated field is HTML-escaped: catalog and team text is
// operator/player entered but ends up in a file a browser renders.
export function buildSongsHtml(
  meta: ExportMeta,
  songs: ExportSong[],
  fonts: ExportFonts = {},
): string {
  const title = `Sound Clash · ${meta.dateLabel}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>
${fontFaces(fonts)}${STYLES}</style>
</head>
<body>
<main>
  <a class="brand" href="https://www.soundclash.org/">${MARK_SVG}Sound Clash</a>
  <h1>Final results</h1>
  <p class="meta">${escapeHtml(meta.dateLabel)} · ${plural(songs.length, "song")} · ${plural(meta.teams.length, "team")}</p>
${teamsSection(meta.teams)}
  <h2>Setlist</h2>
${songsSection(songs)}
  <footer>Played on <a href="https://www.soundclash.org/">Sound Clash</a> — the music trivia buzzer game.</footer>
</main>
</body>
</html>
`;
}
