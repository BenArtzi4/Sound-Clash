import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RouteFallback } from "./RouteFallback";

describe("RouteFallback", () => {
  it("renders a labelled loading status with the Sound Clash logo", () => {
    render(<RouteFallback />);
    expect(screen.getByRole("status", { name: /loading/i })).toBeInTheDocument();
    expect(screen.getByText("Sound Clash")).toBeInTheDocument();
  });
});
