import { createContext } from "react";

export interface AuthContextValue {
  adminPassword: string | null;
  login: (password: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
