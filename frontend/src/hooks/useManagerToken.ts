import { useMemo, useRef } from "react";
import { getManagerToken, parseRecoveryHash, setManagerToken } from "../lib/managerToken";

// Resolve the per-game manager token for the console (T4.10 backup-host-link
// adoption). Extracted verbatim from ManagerConsolePage during the T7.2
// decomposition so the intentional in-render ref access stays contained in one
// small, well-named hook instead of tainting the page's whole render.
//
// A backup-host-link URL — /manager/game/<code>#mt=<token> — re-authenticates a
// host whose localStorage is gone (new device, cleared browser). Resolution
// order:
//   1. A token already stored for this game wins unconditionally — recovery is
//      for tokenless devices. The room knows the game code, so if the hash won
//      instead, any guest could craft a well-formed #mt= link that silently
//      clobbers the host's working credential (one-click lockout).
//   2. Otherwise a well-formed fragment is adopted: persisted for future visits
//      and mirrored in a ref so the credential survives the hash scrub the page
//      runs next, even where localStorage writes are blocked (private mode) —
//      persistence is best-effort, the live session is not.
//   3. Otherwise fall back to that ref (an adoption earlier in this mount);
//      keyed by game code so a console-to-console navigation can't reuse it.
// Reading storage and the idempotent write inside the memo keep the very first
// render authenticated (no "not the host" flash); both are safe under
// StrictMode's double-invoke.
export function useManagerToken(gameCode: string, hash: string): string | null {
  const adoptedTokenRef = useRef<{ gameCode: string; token: string } | null>(null);
  // The memo intentionally reads/writes the ref during render to keep the very
  // first paint authenticated (no "not the host" flash) and to survive the
  // page's hash-scrub navigation even where localStorage writes are blocked.
  // The write is idempotent, so it's safe under StrictMode's double-invoke.
  // react-hooks/refs forbids in-render ref access categorically; this is the
  // documented exception, contained to this one small hook so it doesn't taint
  // the console's render.
  // eslint-disable-next-line react-hooks/refs -- first-paint no-flash guard; survives the hash scrub
  return useMemo(() => {
    const stored = getManagerToken(gameCode);
    if (stored) return stored;
    const adopted = parseRecoveryHash(hash);
    if (adopted) {
      // eslint-disable-next-line react-hooks/refs -- see above; idempotent in-render mirror write
      adoptedTokenRef.current = { gameCode, token: adopted };
      setManagerToken(gameCode, adopted);
      return adopted;
    }
    // eslint-disable-next-line react-hooks/refs -- see above; in-render read is the no-flash guard
    return adoptedTokenRef.current?.gameCode === gameCode ? adoptedTokenRef.current.token : null;
  }, [gameCode, hash]);
}
