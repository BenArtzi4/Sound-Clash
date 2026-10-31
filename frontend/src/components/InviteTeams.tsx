import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQrSvg } from "../hooks/useQrSvg";
import { hostInviteUrl, trackCta } from "../lib/funnel";
import type { Team } from "../lib/types";
import { ChatIcon, CheckIcon, CloseIcon, CopyIcon, ExpandIcon, QrIcon, ShareIcon } from "./icons";
import { Portal } from "./Portal";
import styles from "./InviteTeams.module.css";

// The host's invite: the join QR, the game code and a share link on the host's
// own screen, so a host with no TV (or before the TV is set up) can still get
// teams in. Before the game starts it is a card on the console (InviteCard);
// during the game it folds into a header button (InviteButton) that opens the
// same sheet, so a late team can join without anyone hunting for the code.
//
// Attribution: the QR encodes `?src=host-qr` and Share / Copy / WhatsApp send
// `?src=host-share`, so the funnel tells them apart from the Display's `?qr`
// (lib/funnel.ts joinSource). The address printed for people who type it
// carries no tag.

// A phone gets its share sheet (WhatsApp, Messages, ...); a laptop gets a plain
// copy, which is what a desktop user expects from the same button. Same rule as
// the Setlist's share.
function prefersNativeShare(): boolean {
  return (
    typeof navigator.share === "function" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** The message that goes out with the link. */
export function inviteText(gameCode: string): string {
  return `Join my Sound Clash game! Game code: ${gameCode}`;
}

/** A WhatsApp "send to..." link with the message and the invite link. */
export function whatsAppUrl(gameCode: string, shareUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${inviteText(gameCode)}\n${shareUrl}`)}`;
}

// The plain join address, for the line people read and type.
function joinUrl(gameCode: string): string {
  return `${window.location.origin}/join/${gameCode}`;
}

// The console has no team list, so the lobby card says who has joined: the
// host sees the invite working. One line; long lists end in an ellipsis.
function TeamsLine({ teams }: { teams: Team[] }) {
  return (
    <p className={styles.teams} data-testid="invite-teams-line">
      {teams.length === 0 ? (
        "No teams yet"
      ) : (
        <>
          {teams.length} {teams.length === 1 ? "team" : "teams"} in:{" "}
          {teams.map((t, i) => (
            <Fragment key={t.id}>
              {i > 0 ? ", " : null}
              <bdi>{t.name}</bdi>
            </Fragment>
          ))}
        </>
      )}
    </p>
  );
}

function QrImage({ svg, error }: { svg: string | null; error: boolean }) {
  return (
    <span className={styles.qrFrame} aria-hidden="true">
      {svg ? (
        <span className={styles.qrSvg} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className={styles.fallback}>{error ? "QR unavailable" : "Generating…"}</span>
      )}
    </span>
  );
}

/** Share invite (phones) or Copy link (laptops), plus a WhatsApp link. */
function ShareActions({ gameCode }: { gameCode: string }) {
  const nativeShare = useMemo(() => prefersNativeShare(), []);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const resetRef = useRef<number | null>(null);
  const shareUrl = hostInviteUrl(window.location.origin, gameCode, "host-share");

  useEffect(
    () => () => {
      if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    },
    [],
  );

  function flash(next: "copied" | "failed") {
    setCopyState(next);
    if (resetRef.current !== null) window.clearTimeout(resetRef.current);
    resetRef.current = window.setTimeout(() => setCopyState("idle"), 2500);
  }

  async function share() {
    trackCta(nativeShare ? "invite_share" : "invite_copy");
    if (nativeShare) {
      try {
        await navigator.share({ title: "Sound Clash", text: inviteText(gameCode), url: shareUrl });
        return;
      } catch (err) {
        // Closing the sheet is a choice, not a failure. Anything else (no
        // share target, permission) falls through to a plain copy.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      flash("copied");
    } catch {
      flash("failed");
    }
  }

  return (
    <>
      <div className={styles.actions}>
        <button
          type="button"
          className={`btn ${styles.action}`}
          onClick={() => void share()}
          data-testid="invite-share"
        >
          {copyState === "copied" ? (
            <>
              <CheckIcon /> Copied
            </>
          ) : nativeShare ? (
            <>
              <ShareIcon /> Share invite
            </>
          ) : (
            <>
              <CopyIcon /> Copy link
            </>
          )}
        </button>
        <a
          className={`btn ${styles.action}`}
          href={whatsAppUrl(gameCode, shareUrl)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackCta("invite_whatsapp")}
          data-testid="invite-whatsapp"
        >
          <ChatIcon /> WhatsApp
        </a>
      </div>
      {copyState === "failed" ? (
        <p className={styles.fail} role="status">
          Couldn't copy. The link: <span className={styles.failUrl}>{shareUrl}</span>
        </p>
      ) : null}
    </>
  );
}

/**
 * The big QR, the code and the share actions in a sheet over the console:
 * opened by tapping the lobby card's QR or the in-game Invite button. No
 * entrance animation (the console's screen changes are instant on purpose).
 */
function InviteSheet({ gameCode, onClose }: { gameCode: string; onClose: () => void }) {
  const { svg, error } = useQrSvg(hostInviteUrl(window.location.origin, gameCode, "host-qr"), 480);
  // The Portal commits its children after an effect, so the close button is
  // focused from a (stable) ref callback rather than from this component's
  // effect. Stable, or every console re-render would pull focus back to it.
  const focusClose = useCallback((node: HTMLButtonElement | null) => node?.focus(), []);

  // onClose must be stable (the callers memoise it): this effect remembers
  // which element had focus when the sheet opened and hands focus back on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      trigger?.focus?.();
    };
  }, [onClose]);

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-sheet-title"
          className={styles.sheet}
          onClick={(e) => e.stopPropagation()}
          data-testid="invite-sheet"
        >
          <div className={styles.sheetHeader}>
            <h2 id="invite-sheet-title" className={styles.sheetTitle}>
              Scan to join
            </h2>
            <button
              ref={focusClose}
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Close"
              data-testid="invite-sheet-close"
            >
              <CloseIcon />
            </button>
          </div>
          <div className={styles.sheetQr}>
            <QrImage svg={svg} error={error} />
          </div>
          <p className={styles.sheetCode}>{gameCode}</p>
          <p className={styles.sheetUrl}>{joinUrl(gameCode)}</p>
          <ShareActions gameCode={gameCode} />
        </div>
      </div>
    </Portal>
  );
}

/** Before the game starts: the invite as a card on the console. */
export function InviteCard({ gameCode, teams }: { gameCode: string; teams: Team[] }) {
  const { svg, error } = useQrSvg(hostInviteUrl(window.location.origin, gameCode, "host-qr"), 320);
  const [enlarged, setEnlarged] = useState(false);
  const closeSheet = useCallback(() => setEnlarged(false), []);
  const site = window.location.host.replace(/^www\./, "");

  return (
    <section className={styles.card} aria-labelledby="invite-heading" data-testid="invite-teams">
      <button
        type="button"
        className={styles.qrButton}
        onClick={() => {
          trackCta("invite_qr_enlarge");
          setEnlarged(true);
        }}
        aria-label="Show the join QR code bigger"
        data-testid="invite-qr"
      >
        <QrImage svg={svg} error={error} />
        <span className={styles.qrHint}>
          <ExpandIcon /> Enlarge
        </span>
      </button>
      <div className={styles.body}>
        <h2 id="invite-heading" className={styles.heading}>
          Invite teams
        </h2>
        <p className={styles.code}>{gameCode}</p>
        <p className={styles.hint}>
          Scan the QR, or enter the code at <span className={styles.hintUrl}>{site}/join</span>
        </p>
        <TeamsLine teams={teams} />
      </div>
      <div className={styles.cardActions}>
        <ShareActions gameCode={gameCode} />
      </div>
      {enlarged ? <InviteSheet gameCode={gameCode} onClose={closeSheet} /> : null}
    </section>
  );
}

/** During the game: a compact header button that opens the invite sheet. */
export function InviteButton({ gameCode }: { gameCode: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => {
          trackCta("invite_open");
          setOpen(true);
        }}
        aria-label="Invite teams"
        aria-haspopup="dialog"
        data-testid="invite-open"
      >
        <QrIcon />
        <span className={styles.triggerLabel}>Invite</span>
      </button>
      {open ? <InviteSheet gameCode={gameCode} onClose={close} /> : null}
    </>
  );
}
