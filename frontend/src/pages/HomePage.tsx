import { useEffect, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ArrowRightIcon, HostIcon, PhoneIcon, TvIcon } from "../components/icons";
import { getHealth, listGenres } from "../lib/api";
import { prefetchQuietly } from "../lib/preloadError";
import styles from "./HomePage.module.css";

// The visible title is the short role word (decision 4); `name` is the
// accessible name, kept as the long phrase so every role/name query in
// HomePage.test, App.test and the e2e manager fixture still resolves.
// `role` selects the card's hue via --role-* (09-home-colour-and-fill.md).
const ROLES = [
  {
    to: "/manager/create",
    role: "host",
    title: "Host",
    desc: "Pick genres, run the rounds, score the room.",
    cue: "Start here",
    name: "Host a game",
    icon: <HostIcon />,
  },
  {
    to: "/join",
    role: "play",
    title: "Play",
    desc: "Join from your phone with the code on the TV.",
    cue: "Join",
    name: "Join a game",
    icon: <PhoneIcon />,
  },
  {
    to: "/display",
    role: "display",
    title: "Display",
    desc: "Put the scoreboard and the QR code on the big screen.",
    cue: "Open",
    name: "Display screen",
    icon: <TvIcon />,
  },
] as const;

// The lazy pages Home's links lead to (/join is eager: it is the QR landing
// page). The router keeps Home on screen until the next page's code has
// arrived, so on a cold phone an unfetched chunk reads as a dead tap.
const NEXT_PAGES = [
  () => import("./ManagerCreateGamePage"),
  () => import("./DisplayPage"),
  () => import("./HowToPlayPage"),
];

// Safari has no requestIdleCallback; a short timeout keeps the fetch clear of
// Home's own first paint and its two warm-up requests.
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 800);
  return () => window.clearTimeout(id);
}

// The fade-up greets someone opening the site on Home. Coming back must not
// replay it: remounting at opacity 0 blanked the first frame after a
// back-swipe, which on an iPhone reads as "loads, flashes, loads again"
// (10-touch-and-route-motion.md). HomePage is an eager import, so this runs
// once at startup and sees the path the page load began on.
let introPending = window.location.pathname === "/";

// Rendered twice per card: once as the resting face, once inside the clipped
// fill layer with the ink inverted. Two copies are what let the text flip at
// the wipe edge instead of cross-fading — a background-color transition
// cannot do that, because the fill and the ink would animate independently.
function RoleFace({
  icon,
  title,
  desc,
  cue,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  cue: string;
}) {
  return (
    <>
      <span className={styles.roleIcon}>{icon}</span>
      <span className={styles.roleTitle}>{title}</span>
      <span className={styles.roleDesc}>{desc}</span>
      <span className={styles.roleCue}>
        {cue} <ArrowRightIcon />
      </span>
    </>
  );
}

// A finger or stylus gets a ripple spreading from where it landed; a mouse
// already has the diagonal hover sweep, so it gets nothing extra. Keyed on the
// input, not the screen: a touchscreen laptop ripples under a finger and
// sweeps under the mouse. Built on the node rather than in React state, so a
// tap never costs a render.
function rippleOn(e: PointerEvent<HTMLAnchorElement>) {
  if (e.pointerType === "mouse") return;
  const card = e.currentTarget;
  const box = card.getBoundingClientRect();
  const x = e.clientX - box.left;
  const y = e.clientY - box.top;
  const r = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
  const dot = document.createElement("span");
  dot.className = styles.ripple ?? "";
  dot.setAttribute("data-ripple", "");
  dot.style.width = dot.style.height = `${2 * r}px`;
  dot.style.left = `${x - r}px`;
  dot.style.top = `${y - r}px`;
  card.prepend(dot);
}

// Fades every live ripple out, then drops it. A timer rather than
// transitionend: under reduced motion the fade is instant and may never fire
// the event, and a leaked node would stay tinted on the card.
function rippleOff(e: PointerEvent<HTMLAnchorElement>) {
  for (const dot of e.currentTarget.querySelectorAll("[data-ripple]:not([data-leaving])")) {
    dot.setAttribute("data-leaving", "");
    window.setTimeout(() => dot.remove(), 400);
  }
}

export function HomePage() {
  const [intro] = useState(() => introPending);

  useEffect(() => {
    introPending = false;
    // Pre-warm on landing so the next step is fast. Two background requests:
    //   1. getHealth() wakes the Render backend, which cold-starts in 2-30s on
    //      the free tier, so POST /games is warm by the time the host submits.
    //   2. listGenres() seeds the genre cache the create page needs.
    void getHealth().catch(() => undefined);
    void listGenres().catch(() => undefined);
    return whenIdle(() => {
      for (const load of NEXT_PAGES) void prefetchQuietly(load);
    });
  }, []);

  return (
    <div className={styles.page} data-intro={intro ? "true" : undefined}>
      <main className={styles.main}>
        <section className={styles.hero}>
          <Logo size="hero" />
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
              data-role={r.role}
              style={{ "--i": i } as CSSProperties}
              onPointerDown={rippleOn}
              onPointerUp={rippleOff}
              onPointerCancel={rippleOff}
              onPointerLeave={rippleOff}
            >
              <span className={styles.roleFace}>
                <RoleFace icon={r.icon} title={r.title} desc={r.desc} cue={r.cue} />
              </span>
              <span className={styles.roleFill} aria-hidden="true">
                <RoleFace icon={r.icon} title={r.title} desc={r.desc} cue={r.cue} />
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
