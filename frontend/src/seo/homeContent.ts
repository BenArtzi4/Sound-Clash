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
    "Songs play from the host's phone or laptop, every team buzzes on its own phone without leaving its seat, the host scores every answer and the TV keeps the scoreboard.",
  ],
  catalog:
    "About 1,700 songs: pop, rock, hip-hop, electronic, movie and TV soundtracks, Disney, and Israeli hits across the decades.",
};

// The how-to-play video beside the steps (components/HomeVideo.tsx), also
// Home's VideoObject structured data. Its music is original (no commercial
// song), so YouTube can't claim, mute or block it in the embed. The facts are
// YouTube's own for this upload (unlisted, embedding allowed): its title, its
// length (51.6 s, which YouTube rounds to 52) and its upload time.
// `oardefault` is the thumbnail in the video's own 9:16 shape (1080 x 1920
// here; the width and height below only give the poster its 9:16 box);
// `hqdefault` is a 4:3 letterbox.
const VIDEO_ID = "idcNGYYuGas";

export const HOME_VIDEO = {
  id: VIDEO_ID,
  title: "How to play Sound Clash",
  caption: "How to play, in under a minute",
  label: "Play the video: how to play Sound Clash, 52 seconds",
  description:
    "One whole Sound Clash game in 52 seconds: the host creates a game, teams join from the QR code on the TV, a song plays, the fastest team buzzes in, the host scores the answer and the winner is crowned.",
  duration: "PT52S",
  uploadDate: "2026-11-01T01:03:26-07:00",
  thumbnail: `https://i.ytimg.com/vi/${VIDEO_ID}/oardefault.jpg`,
  thumbnailWidth: 720,
  thumbnailHeight: 1280,
  // youtube-nocookie: the host's player uses it too, and the CSP's frame-src
  // allows it. autoplay starts the video on the tap that loaded it;
  // playsinline keeps an iPhone from going full screen; rel=0 keeps the
  // suggestions at the end to this channel.
  embed: `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&playsinline=1&rel=0`,
};

export const HOME_FAQ: Faq[] = [
  {
    question: "Is Sound Clash free?",
    answer:
      "Yes. Hosting and playing are free, with no account and nothing to install, and Sound Clash shows no ads.",
  },
  {
    question: "Do players need to download an app?",
    answer:
      "No. Everyone plays in the web browser. Teams join by scanning the QR code or typing the 6-letter code at soundclash.org/join.",
  },
  {
    question: "Do we need Spotify or a music subscription?",
    answer:
      "No. The songs play as YouTube clips from the host's phone or laptop, so nobody needs Spotify, a music app or an account.",
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
