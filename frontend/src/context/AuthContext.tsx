import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AuthContext } from "./authContextValue";
import { getAdminPassword, setAdminPassword } from "./authStorage";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [adminPassword, setStateValue] = useState<string | null>(() => getAdminPassword());

  const login = useCallback((password: string) => {
    setAdminPassword(password);
    setStateValue(password);
  }, []);

  const logout = useCallback(() => {
    setAdminPassword(null);
    setStateValue(null);
  }, []);

  const value = useMemo(() => ({ adminPassword, login, logout }), [adminPassword, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
