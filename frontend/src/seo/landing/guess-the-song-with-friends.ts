import type { LandingContent } from "../landingContent";

// Search intent: guess the song with friends; also guess the song multiplayer, guess the song online with friends, group guess the song game, music guessing game for groups
export const page: LandingContent = {
  path: "/guess-the-song-with-friends",
  eyebrow: "Music game for groups",
  h1: "Guess the song with friends, all in one room",
  lede: "Most song-guessing games are made for one player and a daily puzzle. Sound Clash is for when you want to guess the song with friends: a multiplayer music quiz where one speaker plays the song, every team races to buzz in from its own phone, and a host decides who got it right. Free, in the browser, with no app and no sign-up.",
  sections: [
    {
      heading: "A group game, not a solo puzzle",
      paragraphs: [
        "Many guess-the-song games online are built for one person: a daily clip to identify in as few tries as you can, or a match against one other player, each tapping answers from a list. Fun on a bus ride, but not made for a living room.",
        "Sound Clash is a group guess-the-song game, multiplayer in the plainest sense: everyone hears the same song from the same speaker at the same moment. There is no list to pick from. The team that buzzes first has to say the title or the artist out loud, and the host, one of your friends, rules on it.",
      ],
    },
    {
      heading: "How teams, buzzing and scoring feel",
      paragraphs: [
        "Split into teams of any size. Each team picks one phone as its buzzer. When a song starts, every team listens for the moment it knows. The first buzz the server receives locks every other phone, the music pauses, and that team answers.",
      ],
      bullets: [
        "The song title is worth 10 points and the artist 5. They are separate, so one team can take the title and another the artist.",
        "A wrong buzz costs 3 points, but the team is not shut out. It can buzz again on the same song.",
        "After a team gets something right, the next wrong buzz in that round costs nothing, so a guess at the other half is free.",
        "The host can give any team a 4-point bonus at any time: for a trivia answer, singing along, dancing or good sportsmanship.",
      ],
    },
    {
      heading: "What you need to guess the song with friends",
      paragraphs: [
        "Setup takes about two minutes, with no accounts and nothing to install. Here is the whole kit:",
      ],
      steps: [
        "A host with a phone or laptop connected to the room's speaker. The music plays only from the host's device, so this is the one that needs to be loud.",
        "One phone per team. Teams join by scanning the QR code on the TV or typing the 6-letter code at soundclash.org/join. If a phone reloads the page, it rejoins its team.",
        "A TV, projector or laptop that everyone can see, if you have one. Open soundclash.org/display and enter the code to show the join QR code, the live scoreboard and each song's reveal. It plays no sound.",
      ],
    },
    {
      heading: "Songs a mixed crowd will know",
      paragraphs: [
        "A music guessing game for groups lives or dies on the song choice. The catalog holds about 1,700 songs in English and Hebrew, from pop, rock, hip-hop and electronic to movie and TV soundtracks, Mizrahit and Israeli hits. The host picks any mix of genres and can narrow it to certain decades. That lets you match the room: older decades for a family gathering, recent hits for a younger crowd, or everything at once.",
        "Songs are picked at random from that mix and kept balanced between genres. No song plays twice in a game, and no artist comes back within 8 rounds. When you finish, every team and the host get the setlist: every song you played, with links to listen again.",
      ],
    },
    {
      heading: "Playing online with friends who are not in the room",
      paragraphs: [
        "Sound Clash is made for one room, because the music comes only from the host's device. A remote group can still play over a video call: the host shares their computer's sound on the call, and each team joins on its own phone. Everyone hears the song with the call's delay, though, and it can differ from person to person, so close buzz races are less fair than in one room. That is fine for a relaxed game, but for a real contest, get everyone together.",
      ],
    },
  ],
  faq: [
    {
      question: "Is there a free way to guess the song with friends?",
      answer:
        "Sound Clash is free to host and to join, with no account and nothing to download, and it shows no ads. Everything runs in the web browser on the phones and screens you already have.",
    },
    {
      question: "How big a group can play together?",
      answer:
        "Any number of teams can join, and games have run with ten teams at once. Each team needs only one phone, so a big group can simply play as bigger teams.",
    },
    {
      question: "Can we play guess the song online with friends over a video call?",
      answer:
        "Yes, if the host shares their computer's sound on the call. Everyone hears the song with the call's delay, so it suits a relaxed game better than a close race. Sound Clash has no built-in voice or video.",
    },
    {
      question: "Which songs will we hear?",
      answer:
        "Songs from the built-in catalog of about 1,700 English and Hebrew songs, limited to the genres and decades the host picks. You cannot add your own songs or playlists, and there is no Spotify connection.",
    },
    {
      question: "Is there a solo mode?",
      answer:
        "No. Sound Clash is built around a host and teams racing each other, so it needs a group. If you are playing alone, a solo song puzzle is a better fit.",
    },
  ],
  closing: "Get your friends together and start a game",
};
