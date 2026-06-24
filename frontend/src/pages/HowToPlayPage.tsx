import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { DisplayIcon, ManagerIcon, TeamIcon } from "../components/RoleIcons";
import styles from "./HowToPlayPage.module.css";

type Step = { title: string; body: React.ReactNode };

const SETUP_STEPS: ReadonlyArray<Step> = [
  {
    title: "Host a game",
    body: "from the home page",
  },
  {
    title: "Pick genres",
    body: (
      <>
        choose your music and get a 6-letter <strong>code</strong>
      </>
    ),
  },
  {
    title: "Open the Display",
    body: "put the join QR + scoreboard on a TV everyone sees",
  },
  {
    title: "Teams join",
    body: "each team scans the QR on one phone",
  },
];

const PLAY_STEPS: ReadonlyArray<Step> = [
  {
    title: "Start",
    body: (
      <>
        tap <strong>Start game</strong> and the first song plays
      </>
    ),
  },
  {
    title: "Buzz & judge",
    body: "first team to buzz answers out loud, then the host scores it",
  },
  {
    title: "Bonus",
    body: (
      <>
        give <strong>+4</strong> to any team, anytime (optional)
      </>
    ),
  },
];

const FAQ: ReadonlyArray<{ term: string; def: React.ReactNode }> = [
  {
    term: "Free guess after a correct answer",
    def: (
      <>
        Got the title (+10)? You can take a shot at the artist with no risk. The very next wrong
        buzz in the round costs <strong>0</strong> instead of 3 points.
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
        The host can grant <strong>+4</strong> to any team at any moment, for trivia, singing,
        dancing, or sportsmanship.
      </>
    ),
  },
  {
    term: "One phone per team",
    def: "Disconnected? Just reload. Your team's seat is saved on the device.",
  },
];

function StepFlow({
  steps,
  startAt,
  variant,
}: {
  steps: ReadonlyArray<Step>;
  startAt: number;
  variant: "setup" | "play";
}) {
  return (
    <ol className={`${styles.flow} ${variant === "play" ? styles.flowPlay : ""}`}>
      {steps.map((step, idx) => (
        <li key={step.title} className={styles.flowRow}>
          <span className={styles.flowNum} aria-hidden="true">
            {startAt + idx}
          </span>
          <p className={styles.flowText}>
            <strong className={styles.flowName}>{step.title}</strong>{" "}
            <span className={styles.flowDesc}>{step.body}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

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
                Roles, the quick setup, scoring, and the rules that come up most often.
              </p>
              <img
                src="/how-to-play-hero.png"
                alt="Three-screen setup: host's phone showing the Game Manager console, a TV displaying the scoreboard and join QR code, and team phones with the BUZZ button."
                className={styles.heroImage}
                width={1600}
                height={900}
              />
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

              <div className={styles.phaseLabel}>
                <span className={styles.phaseName}>Set up</span>
                <span className={styles.phaseMeta}>once, about 2 min</span>
              </div>
              <StepFlow steps={SETUP_STEPS} startAt={1} variant="setup" />

              <div className={`${styles.phaseLabel} ${styles.phaseLabelPlay}`}>
                <span className={styles.phaseName}>Play</span>
                <span className={styles.phaseMeta}>every round</span>
              </div>
              <StepFlow steps={PLAY_STEPS} startAt={5} variant="play" />

              <p className={styles.audioNote}>
                <span className={styles.audioIcon} aria-hidden="true">
                  🔊
                </span>
                <span>
                  <strong>Audio plays from the host's phone.</strong> Connect it to the room's
                  speakers, or keep the host near everyone.
                </span>
              </p>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Scoring</h2>
              <ul className={styles.scoringList}>
                <li className={styles.scoringRow}>
                  <span className={`${styles.chip} ${styles.chipGood}`}>+10</span>
                  <span>Correct song</span>
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
                  <span>Manager bonus. The host can award +4 to any team at any time.</span>
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
