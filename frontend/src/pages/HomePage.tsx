import { useEffect } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Logo } from "../components/Logo";
import { TransitionLink } from "../components/TransitionLink";
import { ArrowRightIcon, HostIcon, PhoneIcon, TvIcon } from "../components/icons";
import { getHealth, listGenres } from "../lib/api";
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
    // Warm the destination's lazy chunk before the route transition starts, so
    // it never animates to the Suspense fallback. /join is eager (it is the QR
    // landing page), so it needs no preload.
    preload: () => import("./ManagerCreateGamePage"),
  },
  {
    to: "/join",
    role: "play",
    title: "Play",
    desc: "Join from your phone with the code on the TV.",
    cue: "Join",
    name: "Join a game",
    icon: <PhoneIcon />,
    preload: undefined,
  },
  {
    to: "/display",
    role: "display",
    title: "Display",
    desc: "Put the scoreboard and the QR code on the big screen.",
    cue: "Open",
    name: "Display screen",
    icon: <TvIcon />,
    preload: () => import("./DisplayPage"),
  },
] as const;

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

// Touch has no hover, so the fill is driven by an attribute instead. Setting it
// on the node rather than in React state keeps this off the render path, and an
// attribute cleared on up/cancel/leave cannot strand a card mid-fill the way a
// sticky :hover does on touch (the PR #282 failure on the decade pills).
function flashOn(e: PointerEvent<HTMLAnchorElement>) {
  e.currentTarget.setAttribute("data-tapped", "true");
}
function flashOff(e: PointerEvent<HTMLAnchorElement>) {
  e.currentTarget.removeAttribute("data-tapped");
}

export function HomePage() {
  useEffect(() => {
    // Pre-warm on landing so the next step is fast. Two background requests:
    //   1. getHealth() wakes the Render backend, which cold-starts in 2-30s on
    //      the free tier, so POST /games is warm by the time the host submits.
    //   2. listGenres() seeds the genre cache the create page needs.
    void getHealth().catch(() => undefined);
    void listGenres().catch(() => undefined);
  }, []);

  return (
    <div className={styles.page}>
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
            <TransitionLink
              key={r.to}
              to={r.to}
              preload={r.preload}
              className={styles.role}
              aria-label={r.name}
              data-role={r.role}
              style={{ "--i": i } as CSSProperties}
              onPointerDown={flashOn}
              onPointerUp={flashOff}
              onPointerCancel={flashOff}
              onPointerLeave={flashOff}
            >
              <span className={styles.roleFace}>
                <RoleFace icon={r.icon} title={r.title} desc={r.desc} cue={r.cue} />
              </span>
              <span className={styles.roleFill} aria-hidden="true">
                <RoleFace icon={r.icon} title={r.title} desc={r.desc} cue={r.cue} />
              </span>
            </TransitionLink>
          ))}
        </nav>
        <p className={styles.howTo}>
          <TransitionLink to="/how-to-play" preload={() => import("./HowToPlayPage")}>
            How to play <ArrowRightIcon />
          </TransitionLink>
        </p>
      </main>
    </div>
  );
}
