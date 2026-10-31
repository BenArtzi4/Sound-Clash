import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../components/SiteFooter";
import { ArrowLeftIcon } from "../components/icons";
import { CONTACT_EMAIL } from "../lib/contact";
import styles from "./PrivacyPage.module.css";

// The privacy note. Israel's Privacy Protection Law (Amendment 13, 2025) makes
// an accurate notice the duty that applies to a small site like this one, so
// every service that sees visitor data is named. Keep it in step with what the
// code actually stores: docs/data-model.md, docs/tech-stack.md (product events)
// and lib/funnel.ts.
//
// The "Songs from YouTube" section is what the YouTube API Services Developer
// Policies (III.A.2) ask of the privacy policy of a site that embeds YouTube's
// player: say it uses YouTube API Services, link the Google Privacy Policy, and
// disclose the cookies YouTube may set and the ads YouTube may show. The items
// for Authorized Data (revoking access in Google's security settings) do not
// apply: there is no Google sign-in.
export const GOOGLE_PRIVACY_URL = "https://www.google.com/policies/privacy";

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
      "Your browser keeps the host key or your team's key for each game, so a refresh keeps you in it, a note that this browser has hosted before, and a random visit id for the usage events that is cleared when the tab closes.",
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
      "YouTube, which plays the songs (see the next section).",
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
          <h2 className={styles.sectionTitle}>Songs from YouTube</h2>
          <ul className={styles.list}>
            <li>
              Sound Clash uses YouTube API Services: every song plays in YouTube's embedded player
              on the host's device. Sound Clash shows no ads, but YouTube may show its own before a
              song.
            </li>
            <li>
              When a song loads or plays, YouTube may collect data and set or read cookies or
              similar data on that device, as described in the{" "}
              <a href={GOOGLE_PRIVACY_URL}>Google Privacy Policy</a>.
            </li>
            <li>
              There is no YouTube or Google sign-in: Sound Clash cannot see your YouTube account,
              and it stores nothing about you that comes from YouTube.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Questions</h2>
          <p className={styles.text}>
            Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with any question, or
            to have a game's data removed sooner.
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
