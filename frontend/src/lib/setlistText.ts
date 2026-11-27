// Text rules for a host's pasted song list, so the create page can count the
// songs and spot pasted links as the host types, before it asks the server.
//
// They copy the server's reader, parse_setlist_text in
// backend/app/services/setlist_text.py (docs/api-contracts.md section 2.2a),
// so countSongLines gives the lines_total that POST /setlists/check answers
// for the same text. A rule changed there must change here too.

/** The site a pasted link points to. */
export type LinkSite = "spotify" | "youtube" | "other";

// Invisible characters a paste carries, removed first: the byte-order mark,
// the direction marks, embeddings, overrides and isolates, and lone
// surrogates (half of an emoji cut by the paste). Under the u flag the
// surrogate range matches only a lone surrogate, never half of a whole emoji.
const INVISIBLE = /[\ufeff\u200e\u200f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu;
// The line breaks of Python's str.splitlines().
// eslint-disable-next-line no-control-regex -- splitlines() breaks on U+001C-U+001E too
const LINE_BREAK = /\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/;
// Python's whitespace (str.strip and the \s of its regexes) is JavaScript's
// without U+FEFF (removed above) and with U+001C-U+001F and U+0085. All but
// U+001F break a line, so U+001F is read as a space.
const UNIT_SEPARATOR = "\u001f";
// A comment: "#" then a space, another "#" or nothing. "#1 ..." and "#Word"
// are song lines.
const COMMENT = /^#(?:\s|#|$)/;
// Leading numbering: at most 3 digits and ".", ")" or " - " ("50 Cent" and
// "1999 - Prince" stay whole), or a bullet: U+2022, or a star, hyphen, en dash
// or em dash before a space.
const NUMBERING =
  /^(?:\p{Nd}{1,3}(?:\.(?!\p{Nd})|\)|\s+[-\u2013\u2014]\s)|\u2022|[-*\u2013\u2014](?=\s))\s*/u;
// A trailing duration: "3:51", "(4:02)", "1:02:33"; not straight after a
// separator, so a song called "12:51" keeps its title.
const DURATION = /(?<![-\u2013\u2014\s])\s+[([]?\p{Nd}{1,2}:\p{Nd}{2}(?::\p{Nd}{2})?[)\]]?$/u;
// A link: a web address, or a Spotify URI ("spotify:track:...").
const LINK = /^(?:https?:\/\/|www\.|spotify:)\S+$/i;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

// A CSV or TSV export's header names a title column and an artist column.
// Apple Music's export names its title "Name"; "Artist URI(s)" and
// "Artist ID" are not names.
const TITLE_COLUMNS = new Set(["track name", "title", "song", "name"]);
const NOT_A_NAME = /\b(?:uri|url|id)s?\b/;

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);
const LINK_HOST = /^(?:https?:\/\/)?([^/?#:]*)/i;

interface Columns {
  delimiter: string;
  artist: number;
  title: number;
}

/** The non-blank lines of a paste, with its invisible marks removed. */
function pasteRows(text: string): string[] {
  return text
    .replace(INVISIBLE, "")
    .replaceAll(UNIT_SEPARATOR, " ")
    .split(LINE_BREAK)
    .filter((row) => row.trim() !== "");
}

function isComment(row: string): boolean {
  return COMMENT.test(row.trimStart());
}

function hasLetterOrDigit(s: string): boolean {
  return LETTER_OR_DIGIT.test(s);
}

// One CSV or TSV line split into cells as Python's csv module reads it: a
// quote opens a quoted cell only at the start of a cell, "" inside one is a
// quote, and text after its closing quote is kept.
function csvCells(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  let cellStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (line.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
      cellStart = true;
      continue;
    } else if (ch === '"' && cellStart) {
      quoted = true;
    } else {
      cell += ch;
    }
    cellStart = false;
  }
  cells.push(cell);
  return cells;
}

/** Where the artist and the title are, when this line is a CSV or TSV header. */
function csvColumns(header: string): Columns | null {
  const delimiter = header.includes("\t") ? "\t" : ",";
  const cells = csvCells(header, delimiter).map((c) => c.trim().toLowerCase());
  const title = cells.findIndex((c) => TITLE_COLUMNS.has(c));
  const artist = cells.findIndex((c) => c.startsWith("artist") && !NOT_A_NAME.test(c));
  if (title === -1 || artist === -1) return null;
  return { delimiter, artist, title };
}

function linkSite(link: string): LinkSite {
  if (/^spotify:/i.test(link)) return "spotify";
  const host = (LINK_HOST.exec(link)?.[1] ?? "").toLowerCase();
  if (host === "open.spotify.com") return "spotify";
  if (YOUTUBE_HOSTS.has(host)) return "youtube";
  return "other";
}

/**
 * The rows the server reads in a paste: no empty lines, no "# " comments and
 * no CSV or TSV header, with the header's columns when there is one.
 */
function listRows(text: string): { rows: string[]; columns: Columns | null } {
  let rows = pasteRows(text);
  // The header is looked for before comments are dropped: a table copied from
  // a playlist page heads its track-number column "#". Otherwise the header
  // is the first line left once comments are dropped.
  const first = rows[0];
  let columns = first === undefined ? null : csvColumns(first);
  if (columns !== null) rows = rows.slice(1);
  rows = rows.filter((row) => !isComment(row));
  const next = rows[0];
  if (columns === null && next !== undefined) {
    columns = csvColumns(next);
    if (columns !== null) rows = rows.slice(1);
  }
  return { rows, columns };
}

/** What the server reads in one row: a song line, a link (its site), or null. */
function readRow(row: string, columns: Columns | null): "song" | LinkSite | null {
  // A table row is read by its artist and title cells; a row with too few
  // cells is read as a plain line.
  if (columns !== null) {
    const cells = csvCells(row, columns.delimiter);
    if (cells.length > Math.max(columns.artist, columns.title)) {
      const named = [cells[columns.artist], cells[columns.title]].some(
        (name) => name !== undefined && hasLetterOrDigit(name),
      );
      return named ? "song" : null;
    }
  }
  const body = row.trim().replace(NUMBERING, "");
  if (LINK.test(body)) return linkSite(body);
  return hasLetterOrDigit(body.replace(/\s+/g, " ").trim().replace(DURATION, "")) ? "song" : null;
}

/**
 * How many song lines the server reads in a pasted list: not the empty lines,
 * the "# " comments, the lines that are only a link or have no letter or
 * digit, nor the header of a CSV or TSV export. Numbering, bullets and a
 * trailing duration do not drop a line.
 */
export function countSongLines(text: string): number {
  const { rows, columns } = listRows(text);
  return rows.filter((row) => readRow(row, columns) === "song").length;
}

/**
 * The site of the links in a pasted list with no song line, which the server
 * refuses as links only: "spotify" when every link is a Spotify link,
 * "youtube" when every link is a YouTube link, "other" for any other links or
 * a mix. Null when the list has a song line, or no link.
 */
export function detectLinks(text: string): LinkSite | null {
  const { rows, columns } = listRows(text);
  let found: LinkSite | null = null;
  for (const row of rows) {
    const read = readRow(row, columns);
    if (read === "song") return null;
    if (read === null) continue;
    found = found === null || found === read ? read : "other";
  }
  return found;
}
