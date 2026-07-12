import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { usePrewarmBackend, useSlowPending } from "../hooks/useBackendWarmup";
import { ApiError, joinTeam, rejoinTeam } from "../lib/api";
import { parseRejoinHash, setStoredTeam } from "../lib/teamStorage";
import styles from "./JoinTeamPage.module.css";

const CODE_RE = /^[A-Z2-9]{6}$/;
const CODE_CHAR_RE = /[A-Z2-9]/g;

function normalizeCode(raw: string): string {
  return (raw.toUpperCase().match(CODE_CHAR_RE) ?? []).join("").slice(0, 6);
}

export function JoinTeamPage() {
  const { gameCode: paramCode } = useParams<{ gameCode?: string }>();
  const { hash } = useLocation();
  const navigate = useNavigate();

  const [code, setCode] = useState(normalizeCode(paramCode ?? ""));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rejoin-by-link (issue #183): a host-shown QR opens /join/<CODE>#rt=<token>.
  // If we land with a valid token fragment, reconnect straight to the team and
  // skip the form; on failure, drop to the manual form with a message.
  const [rejoining, setRejoining] = useState(() => parseRejoinHash(hash) !== null);

  // Wake the Render backend now so the join POST (which goes through Render) is
  // warm by the time the player finishes typing.
  usePrewarmBackend();
  // After ~2.5s of a pending join, tell the user the server is waking (cold
  // start can take up to ~30s) instead of leaving "Joining…" hanging.
  const wakingServer = useSlowPending(busy);

  // Prefetch the gameplay chunk while the player types their name, so the jump
  // to /team/:code after a successful join is instant (React.lazy in App.tsx
  // requests the same chunk — Vite dedupes it).
  useEffect(() => {
    void import("./TeamGameplayPage");
  }, []);

  // Adopt a #rt= rejoin token once: resolve it to the exact team (same id,
  // preserved score) and jump to gameplay, storing the normal {id,name}
  // identity so later refreshes use the same-browser auto-rejoin path. On
  // failure, scrub the token from the URL and fall back to the manual form.
  useEffect(() => {
    const token = parseRejoinHash(hash);
    if (!token) {
      setRejoining(false);
      return;
    }
    const targetCode = normalizeCode(paramCode ?? "");
    if (!CODE_RE.test(targetCode)) {
      setRejoining(false);
      setError("That rejoin link is missing a valid game code.");
      return;
    }
    let cancelled = false;
    setRejoining(true);
    void (async () => {
      try {
        const team = await rejoinTeam(targetCode, token);
        if (cancelled) return;
        setStoredTeam(targetCode, { id: team.id, name: team.name });
        navigate(`/team/${targetCode}`, { replace: true });
      } catch {
        if (cancelled) return;
        setRejoining(false);
        setError(
          "That rejoin link didn't work. Enter your team name to rejoin and keep your score.",
        );
        navigate(`/join/${targetCode}`, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hash, paramCode, navigate]);

  const trimmedName = name.trim();
  const codeValid = CODE_RE.test(code);
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 30;
  const submittable = codeValid && nameValid && !busy;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!submittable) return;
    setBusy(true);
    setError(null);
    try {
      const team = await joinTeam(code, trimmedName);
      setStoredTeam(code, { id: team.id, name: team.name });
      navigate(`/team/${code}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) setError("That game code does not exist.");
        else if (err.status === 410) setError("That game has already ended.");
        else if (err.status === 409) setError("That team name is already taken.");
        else setError(err.message);
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (rejoining) {
    return (
      <main className={styles.shell}>
        <div className={styles.card} aria-busy="true">
          <h1 className={styles.title}>Reconnecting…</h1>
          <p className={styles.subtitle}>Getting you back into your team.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div>
          <h1 className={styles.title}>Join a team</h1>
          <p className={styles.subtitle}>Enter the code your host shared with you.</p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="game-code">
            Game code
          </label>
          <input
            id="game-code"
            className={styles.codeInput}
            value={code}
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            placeholder="ABCDEF"
            autoComplete="off"
            inputMode="text"
            maxLength={6}
            required
          />
          <span className={styles.counter} aria-hidden="true">
            {code.length}/6
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="team-name">
            Team name
          </label>
          <input
            id="team-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="The Champions"
            maxLength={30}
            required
          />
          <span className={styles.counter} aria-hidden="true">
            {trimmedName.length}/30
          </span>
          <p className={styles.hint}>
            Already had a team? Enter the same name to rejoin and keep your score.
          </p>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className={styles.actions}>
          <Link to="/" className="btn btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={!submittable}>
            {busy ? (wakingServer ? "Waking the server — up to 30s…" : "Joining…") : "Join game"}
          </button>
        </div>
      </form>
    </main>
  );
}
