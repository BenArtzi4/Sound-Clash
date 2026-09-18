import { useEffect } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ArrowRightIcon } from "../components/icons";
import { getHealth, listGenres } from "../lib/api";
import styles from "./HomePage.module.css";

// The visible title is the short role word (decision 4); `name` is the
// accessible name, kept as the long phrase so every role/name query in
// HomePage.test, App.test and the e2e manager fixture still resolves.
const ROLES = [
  {
    to: "/manager/create",
    index: "01",
    title: "Host",
    desc: "Pick genres, run the rounds, score the room.",
    name: "Host a game",
  },
  {
    to: "/join",
    index: "02",
    title: "Play",
    desc: "Join from your phone with the code on the TV.",
    name: "Join a game",
  },
  {
    to: "/display",
    index: "03",
    title: "Display",
    desc: "Put the scoreboard and the QR code on the big screen.",
    name: "Display screen",
  },
] as const;

export function HomePage() {
  useEffect(() => {
    // Pre-warm on landing so the next step is fast. Two background requests:
    //   1. getHealth() wakes the Render backend. Its free-tier container spins
    //      down after ~15 min idle, so the create-game / join POST would
    //      otherwise stall the user 2-30s on cold start; pinging /health now
    //      warms the container ahead of that click.
    //   2. listGenres() seeds the genre cache. Genres load straight from
    //      Supabase (not Render), so it's already fast and cold-start-free;
    //      prefetching here just means the "Host a game" picker is already in
    //      memory on arrival.
    // Errors are ignored — a failed pre-warm just means the user hits the same
    // path they would have anyway. No worse, often much better.
    void getHealth().catch(() => undefined);
    void listGenres().catch(() => undefined);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Logo size="small" />
      </header>
      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>Name the song. Buzz first.</h1>
          <p className={styles.subtitle}>
            Real-time music trivia for a room full of people and one TV.
          </p>
        </section>
        <nav className={styles.roles} aria-label="Choose your role">
          {ROLES.map((r, i) => (
            <Link
              key={r.to}
              to={r.to}
              className={styles.role}
              aria-label={r.name}
              style={{ "--i": i } as CSSProperties}
            >
              <span className={styles.roleIndex} aria-hidden="true">
                {r.index}
              </span>
              <span className={styles.roleBody}>
                <span className={styles.roleTitle}>{r.title}</span>
                <span className={styles.roleDesc}>{r.desc}</span>
              </span>
              <span className={styles.roleArrow} aria-hidden="true">
                <ArrowRightIcon />
              </span>
            </Link>
          ))}
        </nav>
        <p className={styles.howTo}>
          <Link to="/how-to-play">
            How to play <ArrowRightIcon />
          </Link>
        </p>
      </main>
    </div>
  );
}
