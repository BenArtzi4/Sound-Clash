import type { LandingContent } from "../landingContent";

// Search intent: Kahoot music quiz alternative; also Kahoot-style music game, music quiz with a room code, guess the song quiz for a group
export const page: LandingContent = {
  path: "/kahoot-music-quiz-alternative",
  eyebrow: "For Kahoot! fans",
  h1: "A Kahoot! music quiz alternative: hear the song, race to buzz",
  lede: "If your group likes Kahoot! and you want a music round where teams actually hear the song and buzz in, Sound Clash is a Kahoot! music quiz alternative made for one room. The host plays real songs through a speaker, teams race to buzz from one phone each, and the answers are shouted, not tapped. It is free, with nothing to write.",
  sections: [
    {
      heading: "What Kahoot! is built for",
      paragraphs: [
        "Kahoot! is a quiz platform. The host shows questions on a shared screen, and players join with a game PIN and answer on their own phones or computers, most often multiple choice, with other types such as true or false. You write a kahoot yourself or pick one from its library, and you can host it over screen sharing or assign it as a self-paced challenge.",
        "A music round asks for something different. The song is the question, the answer lives in your memory rather than in a list of options, and the fun is recognising it a second before the team next to you.",
      ],
    },
    {
      heading: "How this Kahoot! music quiz alternative works",
      paragraphs: [
        "It is a music quiz with a room code, much like the game PIN your group already knows:",
      ],
      steps: [
        "The host opens soundclash.org on a phone or laptop, picks genres and decades, and gets a 6-letter code.",
        "Each team scans the QR code on the TV or types the code at soundclash.org/join. One phone per team becomes its buzzer.",
        "The host plays a song through the room's speaker. Only the host's device plays sound.",
        "The first team to buzz locks the buzzer and says the title and artist out loud.",
        "The host taps Correct Song for 10 points, Correct Artist for 5, or Wrong, which costs 3. A team that guessed wrong can buzz again, and title and artist can go to different teams.",
        "The TV shows the scoreboard and the reveal, and the host starts the next song.",
      ],
    },
    {
      heading: "Kahoot! and Sound Clash side by side",
      bullets: [
        "Preparation: a Kahoot! quiz is written by you or picked from a library. Sound Clash has nothing to write: about 1,700 English and Hebrew songs are ready to play.",
        "Answering: Kahoot! players tap an answer on their screen. Sound Clash teams say it out loud and the host judges it, so a near miss can still raise a laugh or earn a +4 bonus.",
        "Racing: only one team can hold the Sound Clash buzzer at a time, so being first matters.",
        "Groups: Kahoot! players usually answer one per device, and it also has a team mode. Sound Clash is built for teams, one phone per team, and has no solo mode.",
        "Cost: Kahoot! has free and paid plans. Sound Clash is free, with no account and no app, and it shows no ads.",
      ],
    },
    {
      heading: "When Kahoot! is the better choice",
      paragraphs: [
        "Sound Clash does one thing: a live music round in one room. Pick Kahoot! when:",
      ],
      bullets: [
        "You want to write your own questions, about music or anything else.",
        "Your class or team is remote. Kahoot! can be hosted over screen sharing or played as a self-paced challenge, while Sound Clash plays the music from the host's device. A remote group can still play over a video call if the host shares their computer's sound, but everyone hears the song with the call's delay.",
        "You want every player to answer on their own screen.",
        "You need your own song list. Sound Clash has no custom playlists and no way to add songs.",
      ],
    },
    {
      heading: "Or use both on the same night",
      paragraphs: [
        "Run your Kahoot! quiz for general knowledge, then switch to Sound Clash for the music round. Teams join with a new code, and the release year on the host's screen makes a ready-made +4 bonus question. At the end, every team gets the setlist with links to listen again.",
        "Sound Clash is an independent game and is not affiliated with Kahoot!.",
      ],
    },
  ],
  faq: [
    {
      question: "Is Sound Clash a Kahoot!-style music game?",
      answer:
        "In some ways: a host, a shared screen, a room code and phones in hand. The difference is that the song is the question, teams buzz instead of tapping an answer, and the host judges what they say out loud.",
    },
    {
      question: "What is a good Kahoot! music quiz alternative for a party?",
      answer:
        "Sound Clash is made for a room with a speaker and teams with phones. Teams hear each song, race to buzz, and name the title for 10 points and the artist for 5. It is free and needs no sign-up.",
    },
    {
      question: "How do players join a guess the song quiz for a group?",
      answer:
        "Each team opens soundclash.org/join on one phone and types the 6-letter code, or scans the QR code on the TV. No app or account is needed, and reloading the page rejoins the same team.",
    },
    {
      question: "Can I write my own music questions?",
      answer:
        "No. Sound Clash has no question editor: the song is the question, drawn from about 1,700 English and Hebrew songs in the genres and decades you choose. If writing your own questions matters, Kahoot! is the better fit.",
    },
    {
      question: "Who decides if an answer is right?",
      answer:
        "The host. Teams say the title and artist out loud, the host's screen shows the correct answer, and one tap scores it. Title and artist are scored separately, so two teams can split a song.",
    },
  ],
  closing: "Give your next quiz a real music round",
};
