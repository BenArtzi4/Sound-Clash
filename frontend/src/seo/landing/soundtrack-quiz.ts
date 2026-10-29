import type { LandingContent } from "../landingContent";

// Search intent: movie soundtrack quiz; also guess the movie by the song, TV theme song quiz, Disney songs quiz, guess the TV show theme
export const page: LandingContent = {
  path: "/soundtrack-quiz",
  eyebrow: "Soundtrack rounds",
  h1: "A movie soundtrack quiz: name the film from the song",
  lede: "Sound Clash has a movie soundtrack quiz built in. In a soundtrack round a song from a film, TV show or musical plays, and the first team to buzz has to name where it comes from, not the song. Play a whole game of soundtracks, from Disney to TV themes, or mix them into a normal music night. Free, in the browser.",
  sections: [
    {
      heading: "How a soundtrack round works",
      paragraphs: [
        "Every song in the Soundtracks or Israeli Soundtracks genre plays as a soundtrack round. A Soundtrack badge appears on the host's screen and on the TV, so everyone knows the question has changed: name the movie, TV show, game or musical the song comes from. The song's title and singer do not score here.",
      ],
      bullets: [
        "Naming the work is worth +15, scored with a single Correct button.",
        "A wrong buzz still costs 3 points, and the team can buzz again on the same song.",
        "The host's screen shows the answer, so the host can rule straight away, and the TV shows it once a team gets it.",
      ],
    },
    {
      heading: "Guess the movie by the song",
      paragraphs: [
        "The Soundtracks genre mixes movie songs, TV theme songs and Disney songs. Hear Let It Go and the answer is Frozen. Hakuna Matata means The Lion King, My Heart Will Go On means Titanic, and The Imperial March means Star Wars. TV themes work the same way, so it doubles as a game to guess the TV show theme: I'll Be There for You is answered Friends.",
        "Watch for the twist: a pop hit that belongs to a film counts as a soundtrack. When Dancing Queen plays in a soundtrack round, the answer the host is waiting for is Mamma Mia!, not ABBA.",
      ],
    },
    {
      heading: "How to run a movie soundtrack quiz",
      paragraphs: ["A soundtrack-only game takes the same two minutes to set up as any other:"],
      steps: [
        "On the host screen, pick only the Soundtracks genre. Pick only Israeli Soundtracks for Hebrew film and TV, or both for a mix of languages.",
        "Leave every decade on, or narrow the songs to an era.",
        "Put soundclash.org/display on the TV. Teams scan its QR code or type the 6-letter code, one phone per team.",
        "Connect the host's phone or laptop to a speaker: the music plays only from there.",
        "Start the game. Every round is a soundtrack round, worth +15 for naming the work.",
        "Use the +4 bonus for extras: naming the song as well, or the whole room singing the chorus.",
      ],
    },
    {
      heading: "Hebrew film and TV: Israeli Soundtracks",
      paragraphs: [
        "The Israeli Soundtracks genre holds Hebrew songs from Israeli film and TV: film classics such as Kazablan and Sallah Shabati, series such as Ramzor and HaShminiya, and Hebrew versions of Disney songs from The Lion King and Aladdin. Pick it on its own for a Hebrew-only game, or with Soundtracks to mix both languages. The game's buttons and text stay in English, while the songs and the answers on screen are in Hebrew.",
      ],
    },
    {
      heading: "Mixing soundtrack rounds into a normal game",
      paragraphs: [
        "Soundtracks also work as a change of pace. Pick the genre next to your usual ones, say Pop and Rock, and soundtrack rounds come up in turn: the game keeps genres balanced and never plays the same genre twice in a row while others still have songs. With exactly two genres, such as Pop and Soundtracks, the rounds alternate.",
        "Because the badge flags every soundtrack round, teams know when to switch from naming the song (+10) and the artist (+5) to naming the movie or show (+15). Expect a few wrong buzzes from teams who shout the song title out of habit.",
      ],
    },
  ],
  faq: [
    {
      question: "What counts as the right answer in a movie soundtrack quiz?",
      answer:
        "The name of the movie, TV show, game or musical the song comes from. The song's own title does not score in a soundtrack round, though the host can reward it with a +4 bonus.",
    },
    {
      question: "Can I make a Disney songs quiz?",
      answer:
        "Disney songs are part of the Soundtracks genre, alongside other films and TV themes. There is no Disney-only filter, so expect them mixed with other soundtracks. Sound Clash is not affiliated with Disney or any studio or network.",
    },
    {
      question: "Is there a TV theme song quiz?",
      answer:
        "Yes, within the same genre. TV theme songs are part of Soundtracks, and naming the show scores +15, just like naming a film. They play mixed with movie songs rather than as a separate genre.",
    },
    {
      question: "Are there Hebrew movie and TV songs?",
      answer:
        "Yes. The Israeli Soundtracks genre has Hebrew songs from Israeli film and TV, plus Hebrew versions of Disney songs. Pick it alone for a Hebrew-only game or together with Soundtracks.",
    },
    {
      question: "Can I add my own soundtrack songs?",
      answer:
        "No. Songs come from the built-in catalog of about 1,700 songs, and you cannot add your own songs or playlists. The host chooses which genres and decades play.",
    },
  ],
  closing: "Start a soundtrack game in two minutes",
};
