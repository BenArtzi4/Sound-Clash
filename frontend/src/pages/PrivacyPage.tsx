import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../components/SiteFooter";
import { ArrowLeftIcon } from "../components/icons";
import styles from "./PrivacyPage.module.css";

// The privacy note. Israel's Privacy Protection Law (Amendment 13, 2025) makes
// an accurate notice the duty that applies to a small site like this one, so
// every service that sees visitor data is named. Keep it in step with what the
// code actually stores: docs/data-model.md, docs/tech-stack.md (product events)
// and lib/funnel.ts.
export const CONTACT_EMAIL = "hello@soundclash.org";

const SECTIONS: ReadonlyArray<{ title: string; items: ReadonlyArray<string> }> = [
  {
    title: "While you play",
    items: [
      "A game keeps its code, the team names you type, the scores and the songs that played. Everyone in that game can see the team names, so use a nickname, not a full name.",
      "The live game is deleted 4 to 5 hours after it was created (longer only if the host extends it).",
      "A short summary of each game that played at least one round (team names, final scores, the songs and the genres chosen) is kept so the game can be improved. Only the maintainer can read it.",
    ],
  },
  {
    title: "On your device",
    items: [
      "Your browser keeps the host key or your team's key for each game, so a refresh keeps you in it, and a note that this browser has hosted before.",
      "Sound Clash sets no cookies of its own and has no accounts.",
    ],
  },
  {
    title: "Usage and errors",
    items: [
      "Anonymous usage events: which screens a visit reached, the website it came from (the site's name only), clicks such as Host a game, how a team joined (QR code, link or typed code) and loading times, with the browser type and language. No names. Kept about 30 days.",
      "Error reports when something breaks, so it can be fixed.",
    ],
  },
  {
    title: "Services that handle this data",
    items: [
      "Supabase (the game database, in the EU), Render (the game server), Cloudflare (hosting, plus visitor totals by country and referring site), Grafana Cloud (the usage events), Sentry (error reports).",
      "YouTube: every song plays in YouTube's player, under YouTube's own privacy policy. Sound Clash shows no ads, but YouTube may show its own before a song.",
      "No data is sold or shared for advertising.",
    ],
  },
];

export function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Logo size="small" />
      </header>

      <main className={styles.main}>
        <section className={styles.intro}>
          <h1 className={styles.title}>Privacy</h1>
          <p className={styles.subtitle}>
            What Sound Clash stores, for how long, and who sees it. Sound Clash is a free game run
            by Gal Ben Artzi.
          </p>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.title} className={styles.section}>
            <h2 className={styles.sectionTitle}>{s.title}</h2>
            <ul className={styles.list}>
              {s.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Questions</h2>
          <p className={styles.text}>
            Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with any question, or
            to have a game's data removed sooner.
          </p>
          <p className={styles.updated}>Updated 30 October 2026.</p>
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
