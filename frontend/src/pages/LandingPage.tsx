import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../components/SiteFooter";
import { ArrowRightIcon } from "../components/icons";
import { landingFor } from "../seo/landingContent";
import styles from "./LandingPage.module.css";

// One component for every search landing page (/guess-the-song-game, ...).
// The words live in src/seo/landingContent.ts as plain strings, so the same
// text feeds this page, its FAQ structured data and llms-full.txt. The build
// writes the rendered markup into the page's HTML (src/entry-server.tsx), so
// the text is there for crawlers that never run JavaScript.
export function LandingPage({ path }: { path: string }) {
  const page = landingFor(path);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.home} aria-label="Sound Clash home">
          <Logo size="small" />
        </Link>
      </header>

      <main className={styles.main}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>{page.eyebrow}</p>
          <h1 className={styles.title}>{page.h1}</h1>
          <p className={styles.lede}>{page.lede}</p>
          <div className={styles.ctas}>
            <Link to="/manager/create" className="btn btn-primary">
              Host a free game <ArrowRightIcon />
            </Link>
            <Link to="/join" className="btn btn-ghost">
              Join with a code
            </Link>
          </div>
        </section>

        {page.sections.map((section) => (
          <section key={section.heading} className={styles.section}>
            <h2 className={styles.sectionTitle}>{section.heading}</h2>
            {section.paragraphs?.map((text) => (
              <p key={text} className={styles.text}>
                {text}
              </p>
            ))}
            {section.steps ? (
              <ol className={styles.steps}>
                {section.steps.map((step) => (
                  <li key={step} className={styles.step}>
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}
            {section.bullets ? (
              <ul className={styles.bullets}>
                {section.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Questions</h2>
          <div className={styles.faq}>
            {page.faq.map(({ question, answer }) => (
              <div key={question} className={styles.faqItem}>
                <h3 className={styles.question}>{question}</h3>
                <p className={styles.text}>{answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.closing}>
          <h2 className={styles.closingTitle}>{page.closing}</h2>
          <div className={styles.ctas}>
            <Link to="/manager/create" className="btn btn-primary">
              Host a game <ArrowRightIcon />
            </Link>
            <Link to="/how-to-play" className="btn btn-ghost">
              How to play
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
