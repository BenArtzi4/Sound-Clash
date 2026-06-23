// Pure, side-effect-free builders for the end-of-game "export songs played"
// feature. No DOM and no network here -- the SongExport component owns the batch
// fetch and the blob download; these functions are unit-tested directly.

export interface ExportSong {
  round_number: number;
  title: string;
  artist: string;
  youtube_id: string;
}

export interface ExportTeam {
  name: string;
  score: number;
}

export interface ExportMeta {
  gameCode: string;
  // Pre-formatted, human-readable timestamp (the component formats
  // game.started_at) so this builder stays pure and timezone-stable in tests.
  dateLabel: string;
  // Caller sorts however it likes (we render in the given order).
  teams: ExportTeam[];
}

// YouTube's anonymous-playlist endpoint (watch_videos?video_ids=...) builds an
// ad-hoc playlist from a comma-separated id list. It is undocumented and caps at
// ~50 ids, so we truncate; the UI surfaces a note and treats the HTML file as the
// reliable export.
export const YT_PLAYLIST_MAX = 50;

export function buildYouTubePlaylistUrl(youtubeIds: string[]): string {
  const ids = youtubeIds.slice(0, YT_PLAYLIST_MAX);
  return `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
}

export function isPlaylistTruncated(count: number): boolean {
  return count > YT_PLAYLIST_MAX;
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

// A self-contained HTML document (openable offline) listing the played songs in
// order, each linking to its YouTube watch page, plus the final scoreboard. Every
// interpolated field is HTML-escaped: catalog/team text is operator/player
// entered but ends up in a file a browser renders.
export function buildSongsHtml(meta: ExportMeta, songs: ExportSong[]): string {
  const title = `Sound Clash — Game ${meta.gameCode}`;

  const teamSection = meta.teams.length
    ? `  <ul class="teams">\n${meta.teams
        .map((t) => `    <li>${escapeHtml(t.name)} — ${t.score}</li>`)
        .join("\n")}\n  </ul>`
    : `  <p>No teams played.</p>`;

  const songSection = songs.length
    ? `  <ol class="songs">\n${songs
        .map((s) => {
          const url = `https://www.youtube.com/watch?v=${encodeURIComponent(s.youtube_id)}`;
          const label = s.artist
            ? `${escapeHtml(s.title)} — ${escapeHtml(s.artist)}`
            : escapeHtml(s.title);
          return `    <li><a href="${escapeHtml(url)}">${label}</a></li>`;
        })
        .join("\n")}\n  </ol>`
    : `  <p>No songs played.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  h2 { margin-top: 1.5rem; }
  .meta { color: #555; margin-top: 0; }
  ol, ul { padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  a { color: #1a5fb4; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">${escapeHtml(meta.dateLabel)} · ${plural(songs.length, "song")} · ${plural(
    meta.teams.length,
    "team",
  )}</p>
  <h2>Final scores</h2>
${teamSection}
  <h2>Songs played</h2>
${songSection}
</body>
</html>
`;
}
