import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import styles from "./ManagerLoginPage.module.css";

export function ManagerLoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    login(password);
    navigate("/manager/create", { replace: true });
  }

  return (
    <main className={styles.shell}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div>
          <h1 className={styles.title}>Host login</h1>
          <p className={styles.subtitle}>
            Enter the admin password to create games.
          </p>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        <div className={styles.actions}>
          <button type="submit" className="btn btn-primary" disabled={!password}>
            Continue
          </button>
        </div>
      </form>
    </main>
  );
}
