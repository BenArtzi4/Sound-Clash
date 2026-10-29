import type { LandingContent } from "../landingContent";

// Search intent: Hitster alternative; also free Hitster alternative online, music party game without cards, music card game alternative
export const page: LandingContent = {
  path: "/hitster-alternative",
  eyebrow: "No cards needed",
  h1: "A free Hitster alternative: no cards, just phones and a speaker",
  lede: "Want a Hitster alternative for a night without the deck, or for a bigger group that would rather play in teams? Sound Clash is a free music game in the web browser. The host plays songs through a speaker, teams buzz in from their phones, and the first to buzz names the title and artist out loud.",
  sections: [
    {
      heading: "How Hitster works",
      paragraphs: [
        "Hitster is a music card game published by Jumbo. Each card carries a QR code. The DJ scans it with the free Hitster app, which plays the song through Spotify, and the player whose turn it is places the card face down in their own timeline, before or after the songs already there, by release year. Then the card is flipped: a correct placement keeps it, a wrong one loses it.",
        "Tokens add a second layer. Players earn them by naming the artist and title, and spend them to skip a song or challenge another player's placement. The first player with 10 songs in the right order wins, and harder modes also ask for the title and artist, and even the exact year.",
      ],
    },
    {
      heading: "How this Hitster alternative plays",
      paragraphs: [
        "If you want a music card game alternative that needs nothing but phones, Sound Clash works differently:",
      ],
      bullets: [
        "No cards and nothing to buy. It is free, runs in the browser, and needs no app or account.",
        "Teams race rather than take turns. Every song is open to every team, and the first to buzz locks the buzzer and answers.",
        "The answer is the title and the artist, not the year: 10 points for the title and 5 for the artist, and they can go to different teams. A wrong buzz costs 3, but the team can buzz again.",
        "No Spotify. Songs play as YouTube clips from the host's phone or laptop, picked at random from about 1,700 English and Hebrew songs in the genres and decades the host chooses.",
        "A host judges every buzz, and an optional TV shows the live scoreboard and each reveal.",
      ],
    },
    {
      heading: "A nod to Hitster's year game",
      paragraphs: [
        "Release years are the heart of Hitster and a side dish in Sound Clash, but you can still play with them. The host's screen shows each song's release year. Once the title and artist are claimed, ask the room what year the song came out, and give the +4 bonus to the team that gets it, or to the closest guess if you prefer. The game never scores the year by itself, so the rule is yours to set.",
      ],
    },
    {
      heading: "What Hitster does that Sound Clash doesn't",
      paragraphs: ["Hitster has real strengths that Sound Clash does not try to copy:"],
      bullets: [
        "The timeline. Sorting songs by year is the whole puzzle in Hitster, and Sound Clash has nothing like it.",
        "A physical game: a deck you can hold, deal and give as a present, played around a table.",
        "Individual play. In Hitster each player builds their own timeline. Sound Clash is played in teams, one phone per team, and has no solo mode.",
        "Tokens that let players skip a song or challenge each other's placements.",
        "Time to think. Hitster gives each player a turn; Sound Clash rewards the fastest buzz.",
      ],
    },
    {
      heading: "Which one fits your night",
      paragraphs: [
        "Reach for Hitster at a small table that enjoys the timeline puzzle and has the deck to hand. Reach for Sound Clash when you have a speaker, a room full of people who want to shout answers and nothing to deal: a music party game without cards, set up in about two minutes. At the end, every team gets the setlist of songs played, with links to listen again.",
        "Sound Clash is an independent game and is not affiliated with Hitster or its publisher, Jumbo.",
      ],
    },
  ],
  faq: [
    {
      question: "Is there a free Hitster alternative online?",
      answer:
        "Sound Clash is free and runs in the web browser. It is a different game, with teams buzzing to name the title and artist rather than placing songs on a timeline, but it needs no cards, no app and no account.",
    },
    {
      question: "Is there a music party game without cards?",
      answer:
        "Sound Clash needs only the host's phone or laptop on a speaker and one phone per team. Teams race to buzz, the host judges each answer, and an optional TV shows the scoreboard.",
    },
    {
      question: "Can Sound Clash do release years like Hitster?",
      answer:
        "Not as a timeline. The host's screen shows each song's release year, so the host can ask a year question and award it with the +4 bonus, but the game itself scores only the title and the artist.",
    },
    {
      question: "Do I need Spotify to play Sound Clash?",
      answer:
        "No. Sound Clash does not use Spotify. The songs play as YouTube clips from the host's device, so players need no music app or account.",
    },
    {
      question: "Do we need a TV to play?",
      answer:
        "No. A TV or projector is optional and shows the join QR code, the scoreboard and each reveal. Without one, teams type the code at soundclash.org/join and follow their score on their own phone.",
    },
    {
      question: "Can we choose the music, like picking a Hitster edition?",
      answer:
        "You choose genres and decades, and songs are drawn at random from that mix, with no song twice in a game. You cannot add your own songs or playlists.",
    },
  ],
  closing: "No deck tonight? Play in the browser",
};
