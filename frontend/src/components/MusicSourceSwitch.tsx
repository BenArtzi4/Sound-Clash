import type { KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import styles from "./MusicSourceSwitch.module.css";

// The switch at the top of the Host page (host-music-choices section 7): how
// the host picks the songs. Each tab is an address, so a reload keeps it; a
// tab change replaces the address, so Back leaves the Host page.
export type MusicSource = "genres" | "list" | "artists";

export interface MusicSourceTab {
  id: MusicSource;
  label: string;
  to: string;
}

// The tabs belong with the switch (Task 10's interface); a change here just
// reloads the page under Fast Refresh.
// eslint-disable-next-line react-refresh/only-export-components
export const MUSIC_SOURCE_TABS: readonly MusicSourceTab[] = [
  { id: "genres", label: "Genres", to: "/manager/create" },
  { id: "list", label: "My own list", to: "/manager/create/list" },
];

interface Props {
  tabs: readonly MusicSourceTab[];
  active: MusicSource;
  /** The id of the open tab's panel; each tab's id is `${panelId}-${tab.id}`. */
  panelId?: string;
}

export function MusicSourceSwitch({ tabs, active, panelId }: Props) {
  const { search } = useLocation();
  const navigate = useNavigate();
  const open = Math.max(
    0,
    tabs.findIndex((t) => t.id === active),
  );

  // Left and right open the previous and next tab, and wrap.
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const next = tabs[(open + step + tabs.length) % tabs.length];
    if (step === 0 || !next) return;
    e.preventDefault();
    navigate({ pathname: next.to, search }, { replace: true });
    e.currentTarget.querySelector<HTMLElement>(`[data-testid="music-source-${next.id}"]`)?.focus();
  }

  return (
    <div className={styles.switch}>
      <div className={styles.track}>
        <div
          className={styles.row}
          role="tablist"
          aria-label="How to pick the songs"
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab, i) => (
            <Link
              key={tab.id}
              to={{ pathname: tab.to, search }}
              replace
              role="tab"
              id={panelId ? `${panelId}-${tab.id}` : undefined}
              aria-selected={i === open}
              aria-controls={i === open ? panelId : undefined}
              tabIndex={i === open ? 0 : -1}
              className={styles.tab}
              data-testid={`music-source-${tab.id}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
        {/* The same labels in the open colours, clipped to the open tab: moving
            the clip slides the block, and each label changes colour exactly
            at its edge. */}
        <div
          className={`${styles.row} ${styles.on}`}
          aria-hidden="true"
          data-n={tabs.length}
          data-i={open}
        >
          {tabs.map((tab) => (
            <span key={tab.id} className={styles.label}>
              {tab.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
