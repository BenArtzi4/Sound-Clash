import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../components/SiteFooter";
import { ArrowLeftIcon } from "../components/icons";
import { CONTACT_EMAIL } from "../lib/contact";
import styles from "./TermsPage.module.css";

// The terms of use. Every song plays in YouTube's embedded player, which makes
// the site a YouTube API Client, and the YouTube API Services Developer
// Policies (III.A.1) require its own terms to link the YouTube Terms of Service
// and say that users agree to be bound by them. The rest is the plain basics of
// a free hobby service. No name on this page: the operator is named once, on
// the privacy page.
export const YOUTUBE_TERMS_URL = "https://www.youtube.com/t/terms";

const SECTIONS: ReadonlyArray<{ title: string; items: ReadonlyArray<ReactNode> }> = [
  {
    title: "The game",
    items: [
      "Sound Clash is a free guess-the-song game that runs in the browser. There are no accounts, no sign-up and nothing to pay for.",
      "Anyone with a game's code can join it. The host runs the game and can remove a team or end the game.",
    ],
  },
  {
    title: "Songs play on YouTube",
    items: [
      "Sound Clash uses YouTube API Services: every song plays in YouTube's embedded player. Sound Clash does not host or copy any song.",
      <>
        By using Sound Clash, you agree to be bound by the{" "}
        <a href={YOUTUBE_TERMS_URL}>YouTube Terms of Service</a>.
      </>,
    ],
  },
  {
    title: "Play fair",
    items: [
      "Don't use Sound Clash to harass, threaten or abuse anyone.",
      "Everyone in a game sees the team names, so keep them friendly: nothing offensive or hateful, and nobody's full name.",
      "No bots, scripts or other automated use, and no attempts to overload the servers, break the game or get around its rules.",
      "A team or a game that breaks these rules may be removed.",
    ],
  },
  {
    title: "No warranty",
    items: [
      "Sound Clash is provided as is, without any warranty. A song may not play and a game may drop.",
      "The game may change, pause or stop at any time, without notice.",
      "As far as the law allows, we are not liable for any loss that comes from using Sound Clash.",
    ],
  },
  {
    title: "Privacy",
    items: [
      <>
        What the game stores, for how long and who sees it is on the{" "}
        <Link to="/privacy">privacy page</Link>.
      </>,
    ],
  },
];

export function TermsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Logo size="small" />
      </header>

      <main className={styles.main}>
        <section className={styles.intro}>
          <h1 className={styles.title}>Terms of use</h1>
          <p className={styles.subtitle}>
            The few rules for using Sound Clash. By using the site, you agree to them.
          </p>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.title} className={styles.section}>
            <h2 className={styles.sectionTitle}>{s.title}</h2>
            <ul className={styles.list}>
              {s.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Changes and questions</h2>
          <p className={styles.text}>
            These terms may change, and the date below shows the latest version. Using Sound Clash
            after a change means you accept it.
          </p>
          <p className={styles.text}>
            Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with any question.
          </p>
          <p className={styles.updated}>Updated 1 November 2026.</p>
        </section>

        <div className={styles.backRow}>
          <Link to="/" className="btn btn-ghost">
            <ArrowLeftIcon /> Back
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
