import { beforeEach, describe, expect, it } from "vitest";
import { clearAdminPassword, getAdminPassword, setAdminPassword } from "./adminPassword";

beforeEach(() => {
  clearAdminPassword();
});

describe("adminPassword", () => {
  it("starts unset", () => {
    expect(getAdminPassword()).toBeNull();
  });

  it("set then get returns the value", () => {
    setAdminPassword("hunter2");
    expect(getAdminPassword()).toBe("hunter2");
  });

  it("clear returns to null", () => {
    setAdminPassword("hunter2");
    clearAdminPassword();
    expect(getAdminPassword()).toBeNull();
  });

  it("set overwrites the previous value", () => {
    setAdminPassword("first");
    setAdminPassword("second");
    expect(getAdminPassword()).toBe("second");
  });

  it("survives multiple set/clear cycles", () => {
    setAdminPassword("a");
    clearAdminPassword();
    setAdminPassword("b");
    expect(getAdminPassword()).toBe("b");
    clearAdminPassword();
    expect(getAdminPassword()).toBeNull();
  });
});
