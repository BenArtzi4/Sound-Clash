import { Link } from "react-router-dom";
import styles from "./HomePage.module.css";

export function HomePage() {
  return (
    <main className={styles.shell}>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.title}>Sound Clash</h1>
          <p className={styles.subtitle}>
            Real-time multiplayer music trivia. Buzz in, name the tune, win the
            round.
          </p>
        </div>
        <div className={styles.cards}>
          <Link to="/manager/login" className={styles.card}>
            <span className={styles.cardTitle}>Host a game</span>
            <span className={styles.cardDesc}>
              Create a game, pick genres, run the round.
            </span>
          </Link>
          <Link to="/join" className={styles.card}>
            <span className={styles.cardTitle}>Join a team</span>
            <span className={styles.cardDesc}>
              Enter a 6-letter code, pick a name, start buzzing.
            </span>
          </Link>
          <Link to="/display" className={styles.card}>
            <span className={styles.cardTitle}>Open display</span>
            <span className={styles.cardDesc}>
              Read-only scoreboard for a screen everyone can see.
            </span>
          </Link>
        </div>
      </div>
    </main>
  );
}
