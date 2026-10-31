import { Link } from "react-router-dom";
import { HOME_ABOUT, HOME_FAQ } from "../seo/homeContent";
import { HomeVideo } from "./HomeVideo";
import { ArrowRightIcon } from "./icons";
import styles from "./HomeAbout.module.css";

// The part of Home below its first screen: what the game is, in words a search
// engine can match ("guess the song", "music quiz"), and the questions people
// ask before they host. HomePage renders it after its full-height page, so the
// first screen (wordmark, headline, role cards) is unchanged. On a wide screen
// the how-to-play video stands beside the steps and the questions run below
// both; on a phone it is one column in this order.
export function HomeAbout() {
  return (
    <section className={styles.about} aria-labelledby="home-about">
      <div className={styles.block}>
        <h2 id="home-about" className={styles.heading}>
          {HOME_ABOUT.heading}
        </h2>
        <p className={styles.text}>{HOME_ABOUT.intro}</p>
        <ol className={styles.steps}>
          {HOME_ABOUT.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className={styles.text}>{HOME_ABOUT.catalog}</p>
        <p>
          <Link to="/how-to-play" className={styles.more}>
            Full rules and scoring <ArrowRightIcon />
          </Link>
        </p>
      </div>

      <HomeVideo />

      <div className={`${styles.block} ${styles.questions}`}>
        <h2 className={styles.heading}>Questions</h2>
        <div className={styles.faq}>
          {HOME_FAQ.map(({ question, answer }) => (
            <div key={question}>
              <h3 className={styles.question}>{question}</h3>
              <p className={styles.text}>{answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
