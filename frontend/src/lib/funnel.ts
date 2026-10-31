// The visitor funnel: where a visit came from, which screens it reached, and
// the clicks that move a would-be host towards a real game. Events go out
// through lib/telemetry (Faro → Loki), so this file never touches the vendor.
//
// What is recorded, and what is not (docs/tech-stack.md, product events):
//   - the referrer's HOSTNAME only, never its path;
//   - our own tracking tags (`?ref=`, `?src=`, `?qr`, `utm_*`), each cut to a
//     short safe token;
//   - route templates (`/join/*`), never game codes;
//   - no names, no ids beyond Faro's per-tab session.
import { seo } from "./routeHead";
import { trackEvent, trackView } from "./telemetry";

// `qr` is a bare flag (`/join/ABCDEF?qr`) because the Display's QR encodes it:
// three characters keep the URL inside the same QR version, so the code on the
// TV does not get denser. The host console's invite uses `?src=` instead (see
// hostInviteUrl). Anything else on the URL (`?cb=`, `#rt=`) is kept.
const TAG_PARAMS = ["ref", "src", "qr", "utm_source", "utm_medium", "utm_campaign", "utm_content"];

/**
 * Where a host's invite link came from: the QR on the host's console
 * (`host-qr`) or a link the host shared or copied (`host-share`).
 */
export type HostInviteSource = "host-qr" | "host-share";

export type JoinSource = "qr" | HostInviteSource | "link" | "typed";

// The landing `src` values that name how a team reached /join/<CODE>.
function isJoinTag(src: string): src is "qr" | HostInviteSource {
  return src === "qr" || src === "host-qr" || src === "host-share";
}

const HOSTED_KEY = "sound-clash:hosted-before";

export interface Landing {
  /** Route template of the first page (`/`, `/join/*`, ...). */
  view: string;
  /** Hostname of the referring site; empty when direct or from this site. */
  refHost: string;
  ref: string;
  src: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
}

let landing: Landing | null = null;

const STATIC_VIEWS = new Set([
  "/",
  "/how-to-play",
  "/join",
  "/display",
  "/manager/create",
  "/admin/songs",
  ...seo.pages.map((p) => p.path),
]);

/** The route template for a path, so game codes never reach the data. */
export function viewName(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const perGame = /^\/(join|team|display|manager\/game)\/[^/]+$/.exec(path);
  if (perGame) return `/${perGame[1]}/*`;
  return STATIC_VIEWS.has(path) ? path : "/other";
}

// Tags are typed by people (and by other sites), so keep a short, plain token.
function tag(value: string | null): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .slice(0, 48)
    .replace(/[^a-z0-9._~-]+/g, "_");
}

function siteHost(host: string): string {
  return host.replace(/^www\./, "");
}

function referrerHost(referrer: string, ownHost: string): string {
  if (!referrer) return "";
  try {
    const host = new URL(referrer).hostname;
    return siteHost(host) === siteHost(ownHost) ? "" : host;
  } catch {
    return "";
  }
}

/**
 * Read where this visit came from, send one `landing` event, and take our
 * tracking tags off the address bar so a link someone copies stays clean.
 * Call once, before the app renders (the router then reads the clean URL).
 * Never throws.
 */
export function captureLanding(): void {
  if (landing) return;
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    landing = {
      view: viewName(url.pathname),
      refHost: referrerHost(document.referrer, url.hostname),
      ref: tag(params.get("ref")),
      src: params.has("qr") ? "qr" : tag(params.get("src")),
      utmSource: tag(params.get("utm_source")),
      utmMedium: tag(params.get("utm_medium")),
      utmCampaign: tag(params.get("utm_campaign")),
      utmContent: tag(params.get("utm_content")),
    };
    trackEvent("landing", {
      view: landing.view,
      ref_host: landing.refHost,
      ref: landing.ref,
      src: landing.src,
      utm_source: landing.utmSource,
      utm_medium: landing.utmMedium,
      utm_campaign: landing.utmCampaign,
      utm_content: landing.utmContent,
    });

    if (TAG_PARAMS.some((p) => params.has(p))) {
      for (const p of TAG_PARAMS) params.delete(p);
      const search = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        url.pathname + (search ? `?${search}` : "") + url.hash,
      );
    }
  } catch {
    // Best-effort: tracking must never stop the page from loading.
  }
}

/** The landing captured on this page load (null before captureLanding). */
export function getLanding(): Landing | null {
  return landing;
}

/** Route change → `view` event (deduplicated in telemetry). */
export function trackRoute(pathname: string): void {
  trackView(viewName(pathname));
}

/** A click that moves a visitor along: `home_host`, `setlist_share`, ... */
export function trackCta(id: string): void {
  trackEvent("cta", { id });
}

/**
 * The join link the host console hands out: the QR on the console encodes
 * `?src=host-qr`, Share / Copy / WhatsApp send `?src=host-share`.
 * captureLanding reads the tag and takes it off the address bar.
 */
export function hostInviteUrl(origin: string, gameCode: string, via: HostInviteSource): string {
  return `${origin}/join/${gameCode}?src=${via}`;
}

/**
 * How a team reached the join form: `qr` (the Display's QR code), `host-qr`
 * (the QR on the host's console), `host-share` (a link the host shared),
 * `link` (any other /join/<CODE> link) or `typed` (the code typed on /join).
 */
export function joinSource(codeInUrl: boolean): JoinSource {
  if (landing?.view === "/join/*" && isJoinTag(landing.src)) return landing.src;
  return codeInUrl ? "link" : "typed";
}

export function trackTeamJoined(codeInUrl: boolean): void {
  trackEvent("team_joined", { source: joinSource(codeInUrl) });
}

/**
 * A game was created. `returning` says whether this browser created one
 * before: a retention signal that needs no account. Never throws.
 */
export function trackGameCreated(genresCount: number, decadesCount: number): void {
  let returning: boolean | undefined;
  try {
    returning = window.localStorage.getItem(HOSTED_KEY) !== null;
    window.localStorage.setItem(HOSTED_KEY, "1");
  } catch {
    returning = undefined;
  }
  trackEvent("game_created", {
    genres_count: genresCount,
    decades_count: decadesCount,
    returning,
  });
}

// Test-only: forget the captured landing.
export function _resetFunnel(): void {
  landing = null;
}
