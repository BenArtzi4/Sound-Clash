import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { setAdminPassword } from "../context/authStorage";
import { ManagerLoginPage } from "./ManagerLoginPage";

beforeEach(() => {
  window.sessionStorage.clear();
  setAdminPassword(null);
});

afterEach(() => {
  window.sessionStorage.clear();
  setAdminPassword(null);
});

describe("ManagerLoginPage", () => {
  it("navigates to /manager/create on submit", () => {
    render(
      <MemoryRouter initialEntries={["/manager/login"]}>
        <AuthProvider>
          <Routes>
            <Route path="/manager/login" element={<ManagerLoginPage />} />
            <Route
              path="/manager/create"
              element={<div>create page</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: "secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText("create page")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("auth:adminPassword")).toBe("secret");
  });

  it("blocks submit when password is empty", () => {
    render(
      <MemoryRouter initialEntries={["/manager/login"]}>
        <AuthProvider>
          <Routes>
            <Route path="/manager/login" element={<ManagerLoginPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});
