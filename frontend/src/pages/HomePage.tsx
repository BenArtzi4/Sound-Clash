import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import styles from "./HomePage.module.css";

export function HomePage() {
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
            <section className={styles.hero}>
              <h1 className={styles.title}>Welcome to Sound Clash</h1>
              <p className={styles.subtitle}>The ultimate music trivia buzzer game</p>
              <p className={styles.description}>Choose your role to get started</p>
            </section>

            <section className={styles.actions}>
              <Link to="/manager/login" className={`${styles.roleBtn} ${styles.rolePrimary}`}>
                <span className={styles.roleIcon} aria-hidden="true">
                  🎮
                </span>
                <span className={styles.roleContent}>
                  <span className={styles.roleTitle}>Manager Console</span>
                  <span className={styles.roleSubtitle}>Host a game</span>
                </span>
              </Link>

              <Link to="/join" className={`${styles.roleBtn} ${styles.roleSecondary}`}>
                <span className={styles.roleIcon} aria-hidden="true">
                  📱
                </span>
                <span className={styles.roleContent}>
                  <span className={styles.roleTitle}>Join as Team</span>
                  <span className={styles.roleSubtitle}>Play on your phone</span>
                </span>
              </Link>

              <Link to="/display" className={`${styles.roleBtn} ${styles.roleAccent}`}>
                <span className={styles.roleIcon} aria-hidden="true">
                  📺
                </span>
                <span className={styles.roleContent}>
                  <span className={styles.roleTitle}>Display Screen</span>
                  <span className={styles.roleSubtitle}>Show scoreboard</span>
                </span>
              </Link>
            </section>

            <section className={styles.info}>
              <h2 className={styles.infoTitle}>How to Play</h2>
              <div className={styles.infoGrid}>
                <article className={styles.infoItem}>
                  <span className={styles.infoNumber}>1</span>
                  <div className={styles.infoContent}>
                    <h3>Teams Join</h3>
                    <p>Each team uses their phone to join with a 6-letter game code.</p>
                  </div>
                </article>

                <article className={styles.infoItem}>
                  <span className={styles.infoNumber}>2</span>
                  <div className={styles.infoContent}>
                    <h3>Listen & Buzz</h3>
                    <p>First team to buzz gets to answer the song.</p>
                  </div>
                </article>

                <article className={styles.infoItem}>
                  <span className={styles.infoNumber}>3</span>
                  <div className={styles.infoContent}>
                    <h3>Manager Awards</h3>
                    <p>The host approves or declines, and the next round starts.</p>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
