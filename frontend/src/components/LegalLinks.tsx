import styles from "./LegalLinks.module.css";

// YouTube's API Services Developer Policies (III.A.2) ask a site that embeds
// YouTube's player to have users agree to its privacy policy before they use
// it, and to keep that policy "easily accessible to users at all times". The
// content pages have the site footer; the game screens get these two quiet
// pieces instead. Both open in a new tab, so a host or a team never loses the
// form or the game they are in.

function NewTab({ to, children }: { to: "/privacy" | "/terms"; children: string }) {
  return (
    <a href={to} target="_blank" rel="noopener">
      {children}
    </a>
  );
}

/** "Privacy · Terms", for the in-game screens that have no site footer. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`${styles.links} ${className}`} data-testid="legal-links">
      <NewTab to="/privacy">Privacy</NewTab>
      <span aria-hidden="true"> · </span>
      <NewTab to="/terms">Terms</NewTab>
    </p>
  );
}

/** The agreement line under the button that starts using the game. */
export function AgreeNote({
  action,
  className = "",
}: {
  /** Completes "By … you agree", e.g. "creating a game" or "joining". */
  action: string;
  className?: string;
}) {
  return (
    <p className={`${styles.links} ${className}`} data-testid="agree-note">
      By {action} you agree to the <NewTab to="/terms">Terms</NewTab> and the{" "}
      <NewTab to="/privacy">Privacy policy</NewTab>.
    </p>
  );
}
