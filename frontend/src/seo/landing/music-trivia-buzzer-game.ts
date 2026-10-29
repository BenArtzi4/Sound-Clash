import type { LandingContent } from "../landingContent";

// Search intent: music trivia buzzer game; also buzz-in music quiz, phone buzzer game, music quiz on TV, quiz buzzer app
export const page: LandingContent = {
  path: "/music-trivia-buzzer-game",
  eyebrow: "Phones as buzzers",
  h1: "A music trivia buzzer game where phones are the buzzers",
  lede: "Sound Clash is a free music trivia buzzer game with the feel of a TV game show and none of the hardware. Each team's phone is its buzzer, the first buzz locks everyone else out, and the TV shows the scoreboard. The host plays the songs and judges the answers. It all runs in the browser.",
  sections: [
    {
      heading: "A music trivia buzzer game without buzzer hardware",
      paragraphs: [
        "A physical buzzer set means a button for every team, usually a control box, and someone who has to buy it, store it and set it up. Sound Clash is a phone buzzer game instead: each team opens one web page on one phone, and that page becomes a big buzz button.",
        "If you were searching for a quiz buzzer app, there is nothing to install. Teams scan the QR code on the TV or type the 6-letter code at soundclash.org/join, and they are in. The phone also shows the team's live place and score, and if the page reloads, it rejoins the same team.",
      ],
    },
    {
      heading: "How the first buzz wins",
      paragraphs: [
        "In a buzz-in music quiz, everything hangs on who was first. While a song plays, every team's button is live. The first buzz the server receives wins, and in that same instant the buzzer locks: every other phone shows which team got there first, and the music pauses while that team answers out loud. Only one team can hold the buzzer at a time, so there is no photo finish to argue about and no host squinting to see whose hand went up first.",
        "What counts is when a buzz arrives, not when it was pressed, so a phone on a weak signal can lose a very close race. Put the buzzing phones on good Wi-Fi or mobile data and it stays a contest of ears.",
      ],
    },
    {
      heading: "Lock, judge, continue: one round, step by step",
      steps: [
        "The host starts the round. The song plays from the host's phone or laptop through the room's speaker.",
        "A team buzzes. All other buzzers lock, the music pauses, and the team says its answer.",
        "The host, whose screen shows the answer, taps Correct Song (+10), Correct Artist (+5), or both.",
        "After a correct answer the same team keeps the buzzer and can go for the other half. A miss on that next guess costs nothing.",
        "To open the floor to everyone, the host taps Continue round. The buzzers reopen and the song plays on.",
        "If an answer is wrong, the host taps Wrong instead. The team loses 3 points, every buzzer reopens, theirs included, and the song resumes.",
        "When the host is done with the song, Next round starts the next one.",
      ],
    },
    {
      heading: "Scoring at a glance",
      bullets: [
        "Correct song title: +10.",
        "Correct artist: +5. Title and artist are scored separately, so two teams can split a song.",
        "Wrong buzz: -3. The next wrong buzz after a correct answer in the same round costs 0.",
        "Soundtrack round: one Correct worth +15 for naming the movie, TV show, game or musical.",
        "Bonus: +4 to any team at any time, for trivia, singing along, dancing or sportsmanship. The host's screen shows each song's release year, so a year question can be paid out with the bonus.",
      ],
    },
    {
      heading: "A music quiz on TV, with the TV as the board",
      paragraphs: [
        "Open soundclash.org/display on a TV, projector or laptop the whole room can see, and enter the game code. Before the game it shows a big QR code for joining. During play it shows the live scoreboard, the top five teams plus how many more are playing, and the song reveal. Nobody has to read the scores out.",
        "The TV does not play sound. The music comes only from the host's device, so connect that to a speaker. And keep the host's screen out of sight: it shows the answer.",
      ],
    },
  ],
  faq: [
    {
      question: "What happens if two teams buzz at the same time?",
      answer:
        "One still wins. The first buzz the server receives takes the buzzer and locks out everyone else, so only one team ever holds it. The other phones show who got there first.",
    },
    {
      question: "Do we need buzzer hardware or a quiz buzzer app?",
      answer:
        "Neither. Each team's phone is its buzzer, inside the web browser. Teams join by scanning the QR code on the TV or typing the code at soundclash.org/join.",
    },
    {
      question: "Can a team buzz again after a wrong answer?",
      answer:
        "Yes. A wrong buzz costs 3 points but does not lock the team out. When the host taps Wrong, every buzzer reopens, theirs included.",
    },
    {
      question: "Does the TV play the music?",
      answer:
        "No. Audio plays only from the host's phone or laptop, so connect it to a speaker. The TV shows the join code, the scoreboard and the song reveal.",
    },
    {
      question: "Is this music trivia buzzer game free?",
      answer:
        "Yes. Sound Clash is free, with no ads, no account and nothing to install. Setting up a game takes about two minutes.",
    },
    {
      question: "How many teams can buzz in one game?",
      answer:
        "Any number. Each team uses one phone, and games have run with ten teams at once. The TV lists the top five and every phone shows its own place.",
    },
  ],
  closing: "Turn your phones into buzzers",
};
