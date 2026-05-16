import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { DisplayIcon, ManagerIcon, TeamIcon } from "../components/RoleIcons";
import styles from "./HowToPlayPage.module.css";

const STEPS: ReadonlyArray<{ title: string; body: React.ReactNode }> = [
  {
    title: "Host a game",
    body: (
      <>
        From the home page, tap <strong>Host a game</strong>.
      </>
    ),
  },
  {
    title: "Pick genres and create",
    body: (
      <>
        Choose the music genres you want. Sound Clash hands you a 6-letter{" "}
        <strong>game code</strong>.
      </>
    ),
  },
  {
    title: "Open the Display screen",
    body: (
      <>
        On a TV or laptop everyone in the room can see, open <strong>Display screen</strong> and
        enter the code. It shows the join QR, the scoreboard, and the YouTube clip.
      </>
    ),
  },
  {
    title: "Teams join from their phones",
    body: (
      <>
        Each team needs one phone. Scan the QR on the display, or open soundclash.org and tap{" "}
        <strong>Join a game</strong>.
      </>
    ),
  },
  {
    title: "Start the game",
    body: (
      <>
        Once the teams are in, the host taps <strong>Start game</strong> and the first song plays.
      </>
    ),
  },
  {
    title: "Buzz and judge",
    body: (
      <>
        The first team to buzz answers out loud. The host taps <strong>Correct Title</strong> (+10),{" "}
        <strong>Correct Artist</strong> (+5), or <strong>Wrong</strong> (−3). The team that just
        answered keeps the floor to also try the other half.
      </>
    ),
  },
  {
    title: "Award a bonus (optional)",
    body: (
      <>
        At any moment the host can tap <strong>+4 Bonus</strong> and pick a team — for great
        singing, dancing, or a fun trivia detail. It's independent of rounds.
      </>
    ),
  },
];

const FAQ: ReadonlyArray<{ term: string; def: React.ReactNode }> = [
  {
    term: "Free guess after a correct answer",
    def: (
      <>
        Got the title (+10)? You can take a shot at the artist with no risk — the very next wrong
        buzz in the round costs <strong>0</strong> instead of −3.
      </>
    ),
  },
  {
    term: "Two answers per song",
    def: "Title and Artist are independent. Different teams can claim each one.",
  },
  {
    term: "A wrong buzz doesn't lock you out",
    def: "Buzz wrong, and you can still buzz again on the same song.",
  },
  {
    term: "Bonus anytime",
    def: (
      <>
        The host can grant <strong>+4</strong> to any team at any moment — for trivia, singing,
        dancing, or sportsmanship.
      </>
    ),
  },
  {
    term: "One phone per team",
    def: "Disconnected? Just reload. Your team's seat is saved on the device.",
  },
];

export function HowToPlayPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.container}>
          <Logo size="large" />
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.content}>
            <section className={styles.intro}>
              <h1 className={styles.title}>How to Play</h1>
              <p className={styles.subtitle}>
                Roles, the seven steps to run a game, scoring, and the rules that come up most
                often.
              </p>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Roles</h2>
              <div className={styles.roles}>
                <article className={`${styles.roleCard} ${styles.rolePrimary}`}>
                  <span className={styles.roleIcon} aria-hidden="true">
                    <ManagerIcon />
                  </span>
                  <h3 className={styles.roleTitle}>Host</h3>
                  <p className={styles.roleText}>
                    Picks genres, runs each round, and awards points.
                  </p>
                </article>

                <article className={`${styles.roleCard} ${styles.roleSecondary}`}>
                  <span className={styles.roleIcon} aria-hidden="true">
                    <TeamIcon />
                  </span>
                  <h3 className={styles.roleTitle}>Team</h3>
                  <p className={styles.roleText}>
                    Joins on a phone with a 6-letter code and hits the buzzer.
                  </p>
                </article>

                <article className={`${styles.roleCard} ${styles.roleAccent}`}>
                  <span className={styles.roleIcon} aria-hidden="true">
                    <DisplayIcon />
                  </span>
                  <h3 className={styles.roleTitle}>Display</h3>
                  <p className={styles.roleText}>
                    Shows the scoreboard and plays the YouTube clip on the big screen.
                  </p>
                </article>
              </div>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Steps to run a game</h2>
              <ol className={styles.stepsList}>
                {STEPS.map((step, idx) => (
                  <li key={step.title} className={styles.stepRow}>
                    <span className={styles.stepNumber} aria-hidden="true">
                      {idx + 1}
                    </span>
                    <div className={styles.stepBody}>
                      <h3 className={styles.stepTitle}>{step.title}</h3>
                      <p className={styles.stepText}>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Scoring</h2>
              <ul className={styles.scoringList}>
                <li className={styles.scoringRow}>
                  <span className={`${styles.chip} ${styles.chipGood}`}>+10</span>
                  <span>Correct title</span>
                </li>
                <li className={styles.scoringRow}>
                  <span className={`${styles.chip} ${styles.chipGood}`}>+5</span>
                  <span>Correct artist</span>
                </li>
                <li className={styles.scoringRow}>
                  <span className={`${styles.chip} ${styles.chipBad}`}>&minus;3</span>
                  <span>Wrong buzz (cannot combine with title or artist)</span>
                </li>
                <li className={styles.scoringRow}>
                  <span className={`${styles.chip} ${styles.chipBonus}`}>+4</span>
                  <span>Manager bonus — the host can award +4 to any team at any time.</span>
                </li>
              </ul>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Rules &amp; FAQ</h2>
              <dl className={styles.faqList}>
                {FAQ.map(({ term, def }) => (
                  <div key={term} className={styles.faqRow}>
                    <dt className={styles.faqTerm}>{term}</dt>
                    <dd className={styles.faqDef}>{def}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <div className={styles.backRow}>
              <Link to="/" className="btn btn-ghost">
                <span aria-hidden="true">&lsaquo;</span> Back
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
