import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { AuthProvider } from "./AuthContext";
import { useAuth } from "./useAuth";
import { getAdminPassword, setAdminPassword } from "./authStorage";

beforeEach(() => {
  window.sessionStorage.clear();
  setAdminPassword(null);
});

afterEach(() => {
  window.sessionStorage.clear();
  setAdminPassword(null);
});

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe("AuthContext", () => {
  it("initial state reads from sessionStorage", () => {
    setAdminPassword("preset");
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.adminPassword).toBe("preset");
  });

  it("login writes both state and storage; getAdminPassword reflects it", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.login("hunter2"));
    expect(result.current.adminPassword).toBe("hunter2");
    expect(window.sessionStorage.getItem("auth:adminPassword")).toBe("hunter2");
    expect(getAdminPassword()).toBe("hunter2");
  });

  it("logout clears state and storage", () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    act(() => result.current.login("x"));
    act(() => result.current.logout());
    expect(result.current.adminPassword).toBeNull();
    expect(window.sessionStorage.getItem("auth:adminPassword")).toBeNull();
    expect(getAdminPassword()).toBeNull();
  });

  it("useAuth throws when used outside provider", () => {
    function Bad() {
      useAuth();
      return null;
    }
    expect(() => render(<Bad />)).toThrow(/AuthProvider/);
  });

  it("AuthProvider renders children", () => {
    render(
      <AuthProvider>
        <span>child</span>
      </AuthProvider>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
