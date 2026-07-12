import { useCallback, useEffect, useRef, useState } from "react";
import { getTeamRejoinToken } from "../lib/api";
import { teamRejoinUrl } from "../lib/teamStorage";
import type { Team } from "../lib/types";
import { useQrSvg } from "../hooks/useQrSvg";
import { Portal } from "./Portal";
import styles from "./TeamRescueModal.module.css";

// Host-only team reconnect (issue #183). A team that lost its device (dead
// phone, cleared storage, a different phone) can't self-serve a secure rejoin,
// and there is deliberately NO rejoin QR on the player screen. Instead the host
// opens this modal, picks the team, and shows its rejoin QR for the player to
// scan on a new/borrowed device. The per-team rejoin token is fetched lazily,
// one team at a time, from the manager-token-gated endpoint — it is never
// exposed to players or fanned out over Realtime.

interface Props {
  gameCode: string;
  managerToken: string;
  teams: Team[];
  onClose: () => void;
}

export function TeamRescueModal({ gameCode, managerToken, teams, onClose }: Props) {
  const [selected, setSelected] = useState<Team | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rescue-title"
          className={styles.dialog}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.header}>
            <h2 id="rescue-title" className={styles.title}>
              {selected ? selected.name : "Reconnect a team"}
            </h2>
            <button
              ref={closeRef}
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Close"
              data-testid="rescue-close"
            >
              ×
            </button>
          </div>

          {selected ? (
            <TeamRejoinView
              team={selected}
              gameCode={gameCode}
              managerToken={managerToken}
              onBack={() => setSelected(null)}
            />
          ) : (
            <TeamList teams={teams} onPick={setSelected} />
          )}
        </div>
      </div>
    </Portal>
  );
}

function TeamList({ teams, onPick }: { teams: Team[]; onPick: (t: Team) => void }) {
  if (teams.length === 0) {
    return <p className={styles.empty}>No teams have joined yet.</p>;
  }
  return (
    <>
      <p className={styles.hint}>
        Pick the team that needs to get back in, then have them scan the QR on their device.
      </p>
      <ul className={styles.teamList} aria-label="Teams">
        {teams.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={styles.teamRow}
              onClick={() => onPick(t)}
              data-testid={`rescue-team-${t.id}`}
            >
              <span className={styles.teamName}>{t.name}</span>
              <span className={styles.teamScore}>{t.score} pts</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function TeamRejoinView({
  team,
  gameCode,
  managerToken,
  onBack,
}: {
  team: Team;
  gameCode: string;
  managerToken: string;
  onBack: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setToken(null);
    setFailed(false);
    void getTeamRejoinToken(gameCode, team.id, managerToken)
      .then((res) => {
        if (!cancelled) setToken(res.rejoin_token);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [gameCode, team.id, managerToken]);

  return (
    <div className={styles.rejoinView}>
      {failed ? (
        <p className={styles.error} role="status">
          Couldn't load this team's rejoin code. Close and try again.
        </p>
      ) : token ? (
        <RejoinQr url={teamRejoinUrl(gameCode, token)} teamName={team.name} />
      ) : (
        <p className={styles.hint}>Generating rejoin code…</p>
      )}
      <button type="button" className={`btn btn-ghost ${styles.back}`} onClick={onBack}>
        ← Back to teams
      </button>
    </div>
  );
}

function RejoinQr({ url, teamName }: { url: string; teamName: string }) {
  const { svg, error } = useQrSvg(url, 200);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyResetRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopyState("idle"), 2500);
  }, [url]);

  return (
    <div className={styles.qrBlock} data-testid="rescue-qr">
      <div className={styles.qrFrame} aria-hidden="true">
        {svg ? (
          <div className={styles.qrSvg} dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <span className={styles.fallback}>{error ? "QR unavailable" : "Generating…"}</span>
        )}
      </div>
      <p className={styles.hint}>
        Have <strong>{teamName}</strong> scan this on their device to rejoin — they keep their exact
        score.
      </p>
      <p className={styles.url} data-testid="rescue-url">
        {url}
      </p>
      <div className={styles.copyRow}>
        <button
          type="button"
          className={`btn ${styles.copyBtn}`}
          onClick={() => void handleCopy()}
          data-testid="rescue-copy"
        >
          {copyState === "copied" ? "Copied ✓" : "Copy link"}
        </button>
        {copyState === "failed" ? (
          <span className={styles.copyFailed} role="status">
            Copy failed — select the link text above instead.
          </span>
        ) : null}
      </div>
    </div>
  );
}
