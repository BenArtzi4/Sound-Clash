import { Link, useLocation } from "react-router-dom";
import { trackCta } from "../lib/funnel";
import { pageFor, seo } from "../lib/routeHead";
import styles from "./SiteFooter.module.css";

// The product page, not the launch-day URL: it keeps working after the launch
// and shows the launch, the comments and any reviews.
const PRODUCT_HUNT_URL = "https://www.producthunt.com/products/sound-clash";

// The footer of the content pages (Home, How to play, the search landing
// pages). It links each of them to all the others: a page search engines
// reach only through the sitemap ranks far worse than one the rest of the
// site links to. The list is every pages.json entry with a `nav` label except
// the page you are on, so a new landing page appears here without touching
// this file.
//
// Labels must not repeat a link name the page already has: Home's tests and
// the e2e suite find "How to play", "Host a game", "Join a game" and "Display
// screen" by name and expect exactly one match (hence "Game rules").
export function SiteFooter() {
  const current = pageFor(useLocation().pathname)?.path;
  const links = seo.pages.filter((p) => p.nav && p.path !== current);
  return (
    <footer className={styles.footer}>
      <nav aria-label="Sound Clash pages">
        <ul className={styles.links}>
          {links.map((p) => (
            <li key={p.path}>
              <Link to={p.path}>{p.nav}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className={styles.note}>
        Sound Clash is a free guess-the-song party game. No app, no account, and Sound Clash shows
        no ads.
      </p>
      {/* A plain link, no badge: Product Hunt's badge image would load from
        their server on every page view, which the privacy page doesn't list.
        Static text, so the prerendered page and the app render the same. */}
      <p className={styles.note}>
        Sound Clash launched on{" "}
        <a
          href={PRODUCT_HUNT_URL}
          target="_blank"
          rel="noopener"
          onClick={() => trackCta("footer_producthunt")}
        >
          Product Hunt
        </a>{" "}
        on 22 November 2026. Questions and ideas are welcome there.
      </p>
    </footer>
  );
}
