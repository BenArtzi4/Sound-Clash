import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAdminPassword,
  setAdminPassword,
} from "./authStorage";

interface AuthContextValue {
  adminPassword: string | null;
  login: (password: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminPassword, setStateValue] = useState<string | null>(() =>
    getAdminPassword(),
  );

  const login = useCallback((password: string) => {
    setAdminPassword(password);
    setStateValue(password);
  }, []);

  const logout = useCallback(() => {
    setAdminPassword(null);
    setStateValue(null);
  }, []);

  const value = useMemo(
    () => ({ adminPassword, login, logout }),
    [adminPassword, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
