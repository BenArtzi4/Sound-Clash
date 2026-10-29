import { seo } from "../lib/routeHead";
import { page as guessTheSongWithFriends } from "./landing/guess-the-song-with-friends";
import { page as hitsterAlternative } from "./landing/hitster-alternative";
import { page as kahootMusicQuizAlternative } from "./landing/kahoot-music-quiz-alternative";
import { page as musicTriviaBuzzerGame } from "./landing/music-trivia-buzzer-game";
import { page as musicTriviaNight } from "./landing/music-trivia-night";
import { page as soundtrackQuiz } from "./landing/soundtrack-quiz";

// The words of the search landing pages. Plain strings only, no markup: the
// same text renders on the page (pages/LandingPage.tsx), becomes the page's
// FAQPage structured data (structuredData.ts) and is copied into
// llms-full.txt (llms.ts), so the three can never disagree.
//
// Each page targets one search intent and lives in its own file under
// landing/ (the phrases it is written for are in the file's first comment);
// its pages.json entry holds the title and description.
// Facts here must be true of the live game: check docs/game-rules.md before
// changing a number.

export type LandingSection = {
  heading: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
};

export type Faq = {
  question: string;
  answer: string;
};

export type LandingContent = {
  path: string;
  eyebrow: string;
  h1: string;
  lede: string;
  sections: LandingSection[];
  faq: Faq[];
  closing: string;
};

export const LANDING_CONTENT: LandingContent[] = [
  guessTheSongWithFriends,
  musicTriviaBuzzerGame,
  musicTriviaNight,
  soundtrackQuiz,
  kahootMusicQuizAlternative,
  hitsterAlternative,
];

export function landingFor(path: string): LandingContent {
  const page = LANDING_CONTENT.find((p) => p.path === path);
  if (!page) throw new Error(`No landing content for ${path}`);
  return page;
}

// Every pages.json entry marked `landing` must have its content here; checked
// by landingContent.test.ts rather than at import, so a missing entry fails CI
// and never a visitor's page load.
export const landingPaths = (): string[] => seo.pages.filter((p) => p.landing).map((p) => p.path);
