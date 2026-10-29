import type { Faq } from "./landingContent";

// The words of the section below Home's first screen (components/HomeAbout.tsx).
// Plain strings, like landingContent.ts, because the FAQ is also Home's
// FAQPage structured data and part of llms.txt. Facts must match
// docs/game-rules.md.

export const HOME_ABOUT = {
  heading: "A guess-the-song game for the whole room",
  intro:
    "Sound Clash is a free music quiz you play together. The host plays a song from a phone or laptop, every team buzzes in from its own phone, and the fastest team names the song for 10 points and the artist for 5. A wrong buzz costs 3.",
  steps: [
    "The host picks genres and decades and gets a 6-letter game code.",
    "Each team scans the QR code on the TV, or types the code, and one phone becomes its buzzer.",
    "Songs play, teams buzz, the host scores every answer and the TV keeps the scoreboard.",
  ],
  catalog:
    "About 1,700 songs: pop, rock, hip-hop, electronic, movie and TV soundtracks, Disney, and Israeli hits across the decades.",
};

export const HOME_FAQ: Faq[] = [
  {
    question: "Is Sound Clash free?",
    answer: "Yes. Hosting and playing are free, with no ads, no account and nothing to install.",
  },
  {
    question: "Do players need to download an app?",
    answer:
      "No. Everyone plays in the web browser. Teams join by scanning the QR code or typing the 6-letter code at soundclash.org/join.",
  },
  {
    question: "How many people can play?",
    answer:
      "As many as fit in the room. Each team plays on one phone, games have been played with ten teams at once, and the TV scoreboard shows the top five.",
  },
  {
    question: "What do we need to play?",
    answer:
      "A phone or laptop for the host, connected to a speaker so everyone hears the music, and one phone per team. A TV or projector for the join code and the scoreboard is optional but makes it feel like a game show.",
  },
];
