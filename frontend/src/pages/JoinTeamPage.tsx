import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, joinTeam } from "../lib/api";
import styles from "./JoinTeamPage.module.css";

const CODE_RE = /^[A-Z2-9]{6}$/;

function teamStorageKey(gameCode: string): string {
  return `game:${gameCode}:team`;
}

export function JoinTeamPage() {
  const { gameCode: paramCode } = useParams<{ gameCode?: string }>();
  const navigate = useNavigate();

  const [code, setCode] = useState((paramCode ?? "").toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      window.localStorage.setItem(
        teamStorageKey(code),
        JSON.stringify({ id: team.id, name: team.name }),
      );
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

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div>
          <h1 className={styles.title}>Join a team</h1>
          <p className={styles.subtitle}>
            Enter the code your host shared with you.
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="game-code">
            Game code
          </label>
          <input
            id="game-code"
            className={styles.codeInput}
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().slice(0, 6))
            }
            placeholder="ABCDEF"
            autoComplete="off"
            inputMode="text"
            maxLength={6}
            required
          />
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
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className={styles.actions}>
          <Link to="/" className="btn btn-ghost">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!submittable}
          >
            {busy ? "Joining…" : "Join game"}
          </button>
        </div>
      </form>
    </main>
  );
}
