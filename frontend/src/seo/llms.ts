import { seo } from "../lib/routeHead";
import {
  ARTIST_POINTS,
  BONUS_POINTS,
  SOUNDTRACK_POINTS,
  TITLE_POINTS,
  WRONG_BUZZ_PENALTY,
} from "../lib/scoring";
import { HOME_ABOUT, HOME_FAQ } from "./homeContent";
import { LANDING_CONTENT, type Faq, type LandingContent } from "./landingContent";

// /llms.txt and /llms-full.txt (https://llmstxt.org), written into dist/ by
// scripts/prerender.mjs. llms.txt is the short Markdown index the proposal
// describes: a name, a one-paragraph summary, the facts an assistant needs to
// describe the game correctly, then links. llms-full.txt carries the full text
// of Home and every landing page. Both are built from the same strings the
// pages render and the scoring constants the game uses, so they cannot drift
// from the site.

const url = (path: string) => seo.origin + (path === "/" ? "/" : path);

const SUMMARY =
  "Sound Clash is a free, browser-based guess-the-song party game for a room full of people. " +
  `The host plays song clips, teams buzz in from their phones, and the first team to buzz names the song title (+${TITLE_POINTS}) and the artist (+${ARTIST_POINTS}). ` +
  "No app, no account, no ads.";

const FACTS = [
  "Roles: one **host** runs the game from a phone or laptop (picks genres and decades, starts rounds, judges answers); each **team** uses one phone as its buzzer and joins with a 6-letter code or a QR code; an optional **display** (TV, projector or laptop) shows the join QR code, the live scoreboard and the song reveal.",
  "The music plays only from the host's device, so the host connects it to a speaker. The display has no sound.",
  `Scoring: correct title +${TITLE_POINTS}, correct artist +${ARTIST_POINTS} (different teams can win each), wrong buzz -${WRONG_BUZZ_PENALTY}. After a correct answer, the next wrong buzz in that round is free. The host can give any team a +${BONUS_POINTS} bonus at any time.`,
  `Soundtrack rounds: for songs from movies, TV shows, games and musicals, teams name the work instead of the song, for +${SOUNDTRACK_POINTS}.`,
  HOME_ABOUT.catalog,
  "The interface is in English; the songs are in English and Hebrew.",
  "Not supported: your own playlists or songs, Spotify, solo play, accounts. It is built for one room; a remote group can play over a video call if the host shares their computer's sound.",
];

function page(path: string) {
  const entry = seo.pages.find((p) => p.path === path);
  if (!entry) throw new Error(`src/seo/pages.json has no ${path}`);
  return entry;
}

function link(path: string, label?: string): string {
  const entry = page(path);
  return `- [${label ?? entry.nav ?? entry.title}](${url(path)}): ${entry.description}`;
}

export function llmsTxt(): string {
  const content = seo.pages.filter((p) => p.inSitemap && p.path !== "/");
  return [
    "# Sound Clash",
    "",
    `> ${SUMMARY}`,
    "",
    ...FACTS.map((fact) => `- ${fact}`),
    "",
    "## Pages",
    "",
    link("/", "Home"),
    ...content.map((p) => link(p.path)),
    "",
    "## Play",
    "",
    link("/manager/create", "Host a game"),
    link("/join", "Join a game"),
    link("/display", "Display screen"),
    "",
    "## Optional",
    "",
    `- [Full text of the site](${url("/llms-full.txt")}): Home, the rules summary and every guide page in one Markdown file.`,
    "",
  ].join("\n");
}

function faqMarkdown(faq: Faq[]): string[] {
  return faq.flatMap(({ question, answer }) => [`### ${question}`, "", answer, ""]);
}

function landingMarkdown(content: LandingContent): string[] {
  const entry = page(content.path);
  const sections = content.sections.flatMap((section) => [
    `### ${section.heading}`,
    "",
    ...(section.paragraphs ?? []).flatMap((text) => [text, ""]),
    ...(section.steps?.length ? [...section.steps.map((s, i) => `${i + 1}. ${s}`), ""] : []),
    ...(section.bullets?.length ? [...section.bullets.map((b) => `- ${b}`), ""] : []),
  ]);
  return [
    `## ${content.h1}`,
    "",
    `Source: ${url(content.path)} (${entry.title})`,
    "",
    content.lede,
    "",
    ...sections,
    ...faqMarkdown(content.faq),
  ];
}

export function llmsFullTxt(): string {
  return [
    "# Sound Clash: full text",
    "",
    `> ${SUMMARY}`,
    "",
    `This file collects the text of ${url("/")} for language models. The short index is ${url("/llms.txt")}.`,
    "",
    "## Key facts",
    "",
    ...FACTS.map((fact) => `- ${fact}`),
    "",
    `## ${HOME_ABOUT.heading}`,
    "",
    `Source: ${url("/")}`,
    "",
    HOME_ABOUT.intro,
    "",
    ...HOME_ABOUT.steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    ...faqMarkdown(HOME_FAQ),
    ...LANDING_CONTENT.flatMap(landingMarkdown),
  ].join("\n");
}
