import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { DisplayIcon, ManagerIcon, TeamIcon } from "../components/RoleIcons";
import { getHealth, listGenres } from "../lib/api";
import styles from "./HomePage.module.css";

export function HomePage() {
  useEffect(() => {
    // Pre-warm the Render-hosted backend. Its free-tier container spins down
    // after ~15 min idle, so the next request (Create / Join / Display)
    // would otherwise stall the user for 2-30s on cold start. We fire two
    // throwaway requests in the background:
    //   1. /health wakes the container.
    //   2. /genres warms it AND seeds the listGenres cache so the manager's
    //      "Host a game" form has its options ready when they click through.
    // Errors are ignored — if pre-warm fails, the user just hits the same
    // cold start they would have hit before. No worse, often much better.
    void getHealth().catch(() => undefined);
    void listGenres().catch(() => undefined);
  }, []);

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
            </section>

            <section className={styles.actions}>
              <Link to="/manager/create" className={`${styles.roleBtn} ${styles.rolePrimary}`}>
                <span className={styles.roleIcon} aria-hidden="true">
                  <ManagerIcon />
                </span>
                <span className={styles.roleContent}>
                  <span className={styles.roleTitle}>Host a game</span>
                  <span className={styles.roleSubtitle}>Pick genres and start playing</span>
                </span>
              </Link>

              <Link to="/join" className={`${styles.roleBtn} ${styles.roleSecondary}`}>
                <span className={styles.roleIcon} aria-hidden="true">
                  <TeamIcon />
                </span>
                <span className={styles.roleContent}>
                  <span className={styles.roleTitle}>Join as Team</span>
                  <span className={styles.roleSubtitle}>Play on your phone</span>
                </span>
              </Link>

              <Link to="/display" className={`${styles.roleBtn} ${styles.roleAccent}`}>
                <span className={styles.roleIcon} aria-hidden="true">
                  <DisplayIcon />
                </span>
                <span className={styles.roleContent}>
                  <span className={styles.roleTitle}>Display Screen</span>
                  <span className={styles.roleSubtitle}>Show scoreboard</span>
                </span>
              </Link>
            </section>

            <div className={styles.howToPlayLink}>
              <Link to="/how-to-play" className="btn btn-ghost">
                How to Play <span aria-hidden="true">&rsaquo;</span>
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
