import type { ExportFonts } from "./exportSongs";

// The keepsake file embeds the two display faces so it opens in the game's own
// type, offline, years later. Both are small (Anton ~18 KB, Secular One ~8 KB)
// and same-origin, so the fetch is a cache hit whenever the page already drew
// them. Fetched once per page load; a failure just leaves that face out and the
// file falls back to Impact / system fonts.
const FONT_URLS = {
  anton: "/fonts/anton-latin.woff2",
  secularOne: "/fonts/secular-one-hebrew.woff2",
} as const;

let cached: Promise<ExportFonts> | null = null;

async function toDataUri(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(path);
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Chunked so a large font can't overflow the argument limit of apply().
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:font/woff2;base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

export function loadExportFonts(): Promise<ExportFonts> {
  cached ??= Promise.all([toDataUri(FONT_URLS.anton), toDataUri(FONT_URLS.secularOne)]).then(
    ([anton, secularOne]) => ({
      ...(anton ? { anton } : {}),
      ...(secularOne ? { secularOne } : {}),
    }),
  );
  return cached;
}

// Test hook: forget the memoised fetch.
export function _resetExportFonts(): void {
  cached = null;
}
