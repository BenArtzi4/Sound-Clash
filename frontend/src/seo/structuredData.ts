import { seo } from "../lib/routeHead";
import { HOME_FAQ, HOME_VIDEO } from "./homeContent";
import { LANDING_CONTENT, type Faq } from "./landingContent";

// JSON-LD for each public page, written into its <head> at build time by
// scripts/prerender.mjs (through src/entry-server.tsx). The site-wide WebSite
// block, which gives Google the site name, stays inline in index.html.
//
// Only facts the page itself shows: no ratings, reviews or player counts we do
// not have. Google's app rich result needs a rating, so the app block earns no
// star snippet, and FAQ rich results left Google in 2026; both are here so
// search and AI answer engines know what the site is (a free, browser-based
// multiplayer music game) and can quote its answers. The Organization block
// tells this Sound Clash apart from the other "sound clash" names in results.

const url = (path: string) => seo.origin + path;

export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${url("/")}#organization`,
  name: "Sound Clash",
  url: url("/"),
  logo: `${seo.origin}/icons/icon-512.png`,
};

export const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": ["WebApplication", "VideoGame"],
  "@id": `${url("/")}#app`,
  publisher: { "@id": ORGANIZATION_JSON_LD["@id"] },
  name: "Sound Clash",
  alternateName: "SoundClash",
  url: url("/"),
  description: seo.pages.find((p) => p.path === "/")?.description,
  image: `${seo.origin}/og-image.jpg`,
  applicationCategory: "GameApplication",
  applicationSubCategory: "Music trivia party game",
  genre: ["Music quiz", "Party game", "Trivia"],
  operatingSystem: "Any (runs in a web browser)",
  gamePlatform: "Web browser",
  playMode: "MultiPlayer",
  browserRequirements: "Requires JavaScript and a current web browser",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  featureList: [
    "Teams buzz in from their own phones",
    "Host plays song clips from a phone or laptop",
    "Join with a 6-letter code or a QR code",
    "Live scoreboard on a TV display screen",
    "About 1,700 songs across pop, rock, hip-hop, electronic, soundtracks and Israeli music",
    "No app, no sign-up",
  ],
};

// The how-to-play video on Home. Home shows it as a poster until it is tapped
// (components/HomeVideo.tsx), so a crawler finds no player in the HTML; this
// block is how it learns the video is there. Google only shows video results
// for pages whose main content is the video, so Home earns no video snippet
// and Search Console may list it as "not on a watch page"; that is expected.
export const VIDEO_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "VideoObject",
  "@id": `${url("/")}#video`,
  name: HOME_VIDEO.title,
  description: HOME_VIDEO.description,
  thumbnailUrl: [HOME_VIDEO.thumbnail, `https://i.ytimg.com/vi/${HOME_VIDEO.id}/hqdefault.jpg`],
  uploadDate: HOME_VIDEO.uploadDate,
  duration: HOME_VIDEO.duration,
  embedUrl: `https://www.youtube.com/embed/${HOME_VIDEO.id}`,
  inLanguage: "en",
  publisher: { "@id": ORGANIZATION_JSON_LD["@id"] },
};

export function faqPageJsonLd(path: string, faq: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${url(path)}#faq`,
    url: url(path),
    mainEntity: faq.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}

export function structuredDataFor(path: string): object[] {
  if (path === "/") {
    return [ORGANIZATION_JSON_LD, APP_JSON_LD, VIDEO_JSON_LD, faqPageJsonLd("/", HOME_FAQ)];
  }
  const landing = LANDING_CONTENT.find((p) => p.path === path);
  if (landing && landing.faq.length > 0) return [faqPageJsonLd(path, landing.faq)];
  return [];
}
