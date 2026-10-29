import type { LandingContent } from "../landingContent";

// Search intent: how to host a music trivia night; also music quiz for a party, music trivia night at home, free music quiz for groups, family music quiz, office team building music game
export const page: LandingContent = {
  path: "/music-trivia-night",
  eyebrow: "Host's guide",
  h1: "How to host a music trivia night, from speaker to scoreboard",
  lede: "This is how to host a music trivia night without writing a single question. Sound Clash brings the songs, the buzzers and the scoreboard: you play each clip from your phone or laptop, teams buzz in from one phone each, and you judge the answers. It is free, runs in the browser and takes about two minutes to set up.",
  sections: [
    {
      heading: "What you need",
      paragraphs: [
        "A free music quiz for groups needs less kit than a pub quiz: no question sheets, no answer pens, no app.",
      ],
      bullets: [
        "A phone or laptop for the host. It plays every song and shows you the answer and the release year.",
        "A speaker the whole room can hear, connected to your device. Only the host's device plays music, so test it before guests arrive.",
        "One phone per team as its buzzer. No accounts.",
        "Optional: a TV or projector for the join QR code, the live scoreboard and each song reveal. It plays no sound.",
      ],
    },
    {
      heading: "Set up the room",
      paragraphs: [
        "Place the speaker where it reaches every table and test the volume. Open soundclash.org/display on the TV and enter your game code to show the join QR code.",
        "Seat each team together, facing the TV. Teams of three to six work well: enough heads to cover several decades, few enough that everyone gets a say. Each team joins by scanning the QR code or typing the code at soundclash.org/join.",
        "Sit where nobody can read your screen, because it shows every answer. Before the first song, read the rules out loud: name the title for 10 points and the artist for 5; a wrong buzz costs 3, but you can buzz again.",
      ],
    },
    {
      heading: "Pick genres and decades for the crowd",
      paragraphs: [
        "You choose genres and decades when you create the game, and songs are drawn at random from that mix with no song twice in a game. The catalog holds about 1,700 English and Hebrew songs across Pop, Rock, Hip-Hop, Electronic, Soundtracks and six Israeli genres.",
      ],
      bullets: [
        "Mixed ages: two or three genres and a wide spread of decades.",
        "Friends who grew up together: narrow the decades to their school years and the buzzing gets fast.",
        "Movie fans and kids: add Soundtracks, with movie songs, TV themes and Disney songs. Teams name the film or show for 15 points.",
        "A Hebrew-speaking room: mix an Israeli genre such as Mizrahit with an English one.",
      ],
    },
    {
      heading: "How to host a music trivia night that stays lively",
      paragraphs: [
        "There is no set number of rounds: each round is one song, and the next starts when you press Next round. Play blocks of 10 to 15 songs with a short break between. A game lasts up to 4 hours, and you can extend it an hour at a time.",
        "If an intro drags, skip forward; if nobody buzzes, go back and replay the hook. If a song is wrong for the room, press Next round, with no points lost.",
        "Hand out the +4 bonus freely: for singing the chorus, a great dance or a fact about the band. Your screen shows each song's release year too, so ask the room for it and give the bonus to the team that gets it.",
        "Title and artist can go to different teams, and once one half is claimed, the next wrong buzz on that song is free, so someone usually takes a shot at the other half. Tap Continue round to reopen the buzzers.",
      ],
    },
    {
      heading: "Ideas for each occasion",
      paragraphs: ["A few tweaks turn the same game into a music quiz for a party of any kind:"],
      bullets: [
        "Birthday: pick the decades the birthday person grew up with.",
        "Family gathering: for a family music quiz, mix ages within each team and add Soundtracks for the Disney songs.",
        "Office party: as an office team building music game, mix departments within teams and put the scoreboard on the meeting-room screen.",
        "Wedding or bachelorette: pick the couple's decades and reward the loudest sing-along. Everyone gets the setlist afterwards, with links to listen again.",
        "Classroom: the teacher hosts from the class computer, each group shares one phone, and an unsuitable song is one tap from skipped.",
      ],
    },
  ],
  faq: [
    {
      question: "How do I host a music trivia night at home?",
      answer:
        "Open soundclash.org on your phone or laptop, create a game and pick genres and decades. Connect to a speaker, and teams join with the 6-letter code, one phone each.",
    },
    {
      question: "How many people can play?",
      answer:
        "Any number of teams, one phone each, and games have run with ten teams at once. The TV shows the top five plus how many more are playing.",
    },
    {
      question: "What happens if two teams tie?",
      answer:
        "Tied teams share the win. For one winner, play a few more songs before End game, or ask a bonus question and give the +4 to whoever answers first.",
    },
    {
      question: "Can we play a music trivia night over a video call?",
      answer:
        "It is made for one room, since the music plays from the host's device. Over a video call the host can share their computer's sound, but everyone hears each song with the call's delay.",
    },
    {
      question: "Can I use my own playlist?",
      answer:
        "No. Songs come from the built-in catalog, and you shape the mix with genres and decades. At the end, every team and the host get the setlist with links to listen again.",
    },
  ],
  closing: "Your music trivia night is two minutes away",
};
