import { useEffect, useId, useMemo, useState, type ChangeEvent } from "react";
import { useToast } from "../context/useToast";
import { ApiError, checkSetlist } from "../lib/api";
import { countSongLines, detectLinks } from "../lib/setlistText";
import { describeMix, type MixTone } from "../lib/songPool";
import type { SetlistCheckResponse, SetlistMissReason } from "../lib/types";
import { CheckIcon, CloseIcon } from "./icons";
import { SetlistHelp } from "./SetlistHelp";
import styles from "./SetlistPanel.module.css";

// "My own list" on the Host page (Task 10): the host pastes song names, checks
// them against the catalog with POST /setlists/check (docs/api-contracts.md
// section 2.2a), and sees what will play. The page owns this state, so the
// pasted text and its check stay as the host left them when the tab changes.
export interface SetlistPanelState {
  text: string;
  /** The answer for exactly this text; null until checked, and after any edit. */
  check: SetlistCheckResponse | null;
  checking: boolean;
}

interface Props {
  value: SetlistPanelState;
  onChange: (state: SetlistPanelState) => void;
}

const REASONS: Record<SetlistMissReason, string> = {
  not_in_catalog: "Not in the game yet",
  several_songs_share_this_name: "More than one song has this name. Add the artist.",
};

const TONE_CLASS: Record<MixTone, string | undefined> = {
  ok: undefined,
  small: styles.poolSmall,
  empty: styles.poolEmpty,
};

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// The text on screen, for a check's answer that arrives after an edit. One
// ref for every mount, not one per mount: a tab change unmounts the panel
// while the page keeps its state, so a check started before the change can
// end in a later mount, and an edit made there must win over its answer.
// The page draws one panel at a time.
const shownText: { current: string } = { current: "" };

export function SetlistPanel({ value, onChange }: Props) {
  const { toast } = useToast();
  const inputId = useId();
  useEffect(() => {
    shownText.current = value.text;
  });

  const songLines = useMemo(() => countSongLines(value.text), [value.text]);
  const links = useMemo(() => detectLinks(value.text), [value.text]);
  // Closed by default; a paste of links opens it (also when the page brings
  // such a text back), and the host can close it again.
  const [helpOpen, setHelpOpen] = useState(() => links !== null);
  // A text the server refused as links only: its links line stays until an edit.
  const [linksOnlyText, setLinksOnlyText] = useState<string | null>(null);
  const linksPasted = links !== null || linksOnlyText === value.text;

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    if (links === null && detectLinks(text) !== null) setHelpOpen(true);
    onChange({ text, check: null, checking: false });
  }

  // Only on the button: the endpoint is rate-limited (10 a minute per IP,
  // shared with creating a game), so the panel never checks by itself, and
  // not again while the text has its answer (an edit clears the check).
  const canCheck = !value.checking && value.check === null && songLines > 0;
  async function handleCheck() {
    const sent = value.text;
    if (!canCheck) return;
    onChange({ ...value, checking: true });
    try {
      const answer = await checkSetlist(sent);
      // An edit while the check ran has already cleared it: drop the answer.
      if (shownText.current !== sent) return;
      onChange({ text: sent, check: answer, checking: false });
    } catch (err) {
      if (shownText.current !== sent) return;
      if (err instanceof ApiError && err.code === "setlist_links_only") {
        setLinksOnlyText(sent);
        setHelpOpen(true);
      }
      // The server's message, unchanged (setlist_too_long, rate_limited, ...).
      toast(err instanceof Error ? err.message : "Failed to check your list", {
        variant: "error",
      });
      onChange({ text: sent, check: null, checking: false });
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.box}>
        <label htmlFor={inputId} className={styles.label}>
          Paste a list of songs
        </label>
        <textarea
          id={inputId}
          className={styles.input}
          value={value.text}
          onChange={handleChange}
          placeholder="One per line: Artist - Song. A film or an artist alone works too."
          rows={7}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          data-testid="setlist-input"
        />
        {songLines > 0 ? (
          <p className={styles.found} data-testid="setlist-found">
            Found {count(songLines, "song", "songs")}
          </p>
        ) : null}
        <button
          type="button"
          className={`btn ${styles.check}`}
          disabled={!canCheck}
          onClick={() => void handleCheck()}
          data-testid="setlist-check"
        >
          {value.checking ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Checking your list…
            </>
          ) : (
            "Check my list"
          )}
        </button>
        <SetlistHelp
          open={helpOpen}
          onToggle={() => setHelpOpen((open) => !open)}
          linksPasted={linksPasted}
        />
      </div>
      {value.check ? <SetlistResult check={value.check} /> : null}
    </div>
  );
}

// What the check found. An edit clears the check and unmounts this card, so
// the "Show" list starts closed again for the next answer.
function SetlistResult({ check }: { check: SetlistCheckResponse }) {
  const [showMissing, setShowMissing] = useState(false);
  const missingId = useId();
  const cannotPlay = check.not_found.length;
  const pool = describeMix(check.pool_size, "game");

  return (
    <div className={styles.result} data-testid="setlist-result">
      <p className={styles.resultTitle}>Your list: {count(check.lines_total, "line", "lines")}</p>
      <ul className={styles.counts}>
        <li className={styles.count}>
          <CheckIcon className={styles.readyIcon} />
          <span>{check.ready.length.toLocaleString("en-US")} ready to play</span>
        </li>
        {cannotPlay > 0 ? (
          <li className={styles.count}>
            <CloseIcon className={styles.cannotIcon} />
            <span>{cannotPlay.toLocaleString("en-US")} cannot play</span>
            <button
              type="button"
              className={styles.show}
              aria-expanded={showMissing}
              aria-controls={showMissing ? missingId : undefined}
              onClick={() => setShowMissing((shown) => !shown)}
            >
              {showMissing ? "Hide" : "Show"}
            </button>
          </li>
        ) : null}
      </ul>
      {showMissing && cannotPlay > 0 ? (
        <ul id={missingId} className={styles.missing} data-testid="setlist-missing">
          {check.not_found.map((miss, i) => (
            <li key={i} className={styles.miss}>
              <span className={styles.missLine}>{miss.line}</span>
              <span className={styles.missReason}>{REASONS[miss.reason]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {check.same_artist_songs > 0 ? (
        <p className={styles.more}>
          + {check.same_artist_songs.toLocaleString("en-US")} more by the same artists, played after
          your list
        </p>
      ) : null}
      <p className={`${styles.pool} ${TONE_CLASS[pool.tone] ?? ""}`} data-tone={pool.tone}>
        {pool.text}
      </p>
    </div>
  );
}
