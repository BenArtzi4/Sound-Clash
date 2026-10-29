import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQrSvg } from "../hooks/useQrSvg";
import { trackCta } from "../lib/funnel";
import { ArrowRightIcon } from "./icons";
import styles from "./HostYourOwn.module.css";

// The end of a game is when everyone in the room has just had fun, so it is
// where the next host is won: "Host your own game" on every team phone, and a
// QR on the TV. Plan: GitHub issue #393 (step H-9). The wording follows the
// "create your own" pattern that beat every other label Typeform tested.

/** On a team phone, under the final results. */
export function HostYourOwnCard() {
  return (
    <section className={styles.card} aria-label="Host your own game">
      <p className={styles.kicker}>Had fun?</p>
      <Link to="/" className="btn btn-primary" onClick={() => trackCta("end_host_your_own")}>
        Host your own game <ArrowRightIcon />
      </Link>
      <p className={styles.small}>Free, with no app and no sign-up.</p>
    </section>
  );
}

// Shown once the podium has played out. The strip's space is kept from the
// start, so the final results (sized to the frame, #392) never jump when it
// appears.
export const TV_DELAY_MS = 6000;

/** On the Display, under the final results. */
export function HostYourOwnTv() {
  const [shown, setShown] = useState(false);
  const url = `${window.location.origin}/?src=tv-end`;
  const { svg } = useQrSvg(url, 200);

  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), TV_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <aside className={styles.tv} data-shown={shown || undefined} aria-hidden={!shown}>
      <div className={styles.tvQr} aria-hidden="true">
        {svg ? <div className={styles.qrSvg} dangerouslySetInnerHTML={{ __html: svg }} /> : null}
      </div>
      <div className={styles.tvText}>
        <p className={styles.tvTitle}>Host your own game</p>
        <p className={styles.tvSub}>soundclash.org · free, no sign-up</p>
      </div>
    </aside>
  );
}
