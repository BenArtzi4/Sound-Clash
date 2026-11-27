import { useId } from "react";
import { CHOSIC_EXPORTER } from "../lib/chosic";
import { ArrowRightIcon } from "./icons";
import styles from "./SetlistPanel.module.css";

// How a host brings a Spotify or Apple Music playlist in as song names
// (docs/planning/2026-11-24-custom-setlist-design.md, section 6). Spotify
// copies only links, so the host exports the names with Chosic's playlist
// exporter (no login) and pastes the text. These sites can change or close:
// this text and How to play's answer are all that depend on them.

interface Props {
  open: boolean;
  onToggle: () => void;
  /** The paste is links: say so above the helper. */
  linksPasted: boolean;
}

export function SetlistHelp({ open, onToggle, linksPasted }: Props) {
  const bodyId = useId();
  return (
    <section className={styles.help} data-testid="setlist-help">
      {linksPasted ? <p className={styles.linksLine}>These are links, not song names.</p> : null}
      <button
        type="button"
        className={styles.helpToggle}
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={onToggle}
      >
        Have the list on Spotify?
        <ArrowRightIcon className={styles.helpArrow} />
      </button>
      {open ? (
        <div id={bodyId} className={styles.helpBody}>
          <ol className={styles.steps}>
            <li>
              Open{" "}
              <a href={CHOSIC_EXPORTER} target="_blank" rel="noopener noreferrer">
                Chosic's playlist exporter
              </a>
            </li>
            <li>Paste your playlist link there and download the TXT file</li>
            <li>Paste the text here</li>
          </ol>
          <p>On a Mac with Apple Music: File → Library → Export Playlist.</p>
          <p className={styles.helpNote}>
            Sound Clash is not connected to Spotify, Apple Music or Chosic.
          </p>
        </div>
      ) : null}
    </section>
  );
}
