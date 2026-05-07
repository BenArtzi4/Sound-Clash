import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { DisplayIcon, ManagerIcon, TeamIcon } from "../components/RoleIcons";
import styles from "./HowToPlayPage.module.css";

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
              <p className={styles.subtitle}>Roles, flow, and scoring at a glance.</p>
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
              <h2 className={styles.sectionTitle}>Game flow</h2>
              <div className={styles.flowGrid}>
                <article className={styles.flowItem}>
                  <span className={styles.flowNumber}>1</span>
                  <div className={styles.flowContent}>
                    <h3>Teams Join</h3>
                    <p>Each team uses their phone to join with a 6-letter game code.</p>
                  </div>
                </article>

                <article className={styles.flowItem}>
                  <span className={styles.flowNumber}>2</span>
                  <div className={styles.flowContent}>
                    <h3>Listen &amp; Buzz</h3>
                    <p>First team to buzz gets to answer the song.</p>
                  </div>
                </article>

                <article className={styles.flowItem}>
                  <span className={styles.flowNumber}>3</span>
                  <div className={styles.flowContent}>
                    <h3>Manager Awards</h3>
                    <p>The host approves or declines, and the next round starts.</p>
                  </div>
                </article>
              </div>
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
                  <span>Manager bonus - the host can award +4 to any team at any time.</span>
                </li>
              </ul>
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
