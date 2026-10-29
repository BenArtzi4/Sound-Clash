import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const qr = vi.hoisted(() => ({ useQrSvg: vi.fn(() => ({ svg: "<svg></svg>", error: null })) }));
vi.mock("../hooks/useQrSvg", () => qr);

import { QRPanel } from "./QRPanel";

describe("QRPanel", () => {
  it("encodes the tagged address but prints the plain one", () => {
    render(
      <QRPanel
        gameCode="ABCDEF"
        joinUrl="https://www.soundclash.org/join/ABCDEF"
        qrUrl="https://www.soundclash.org/join/ABCDEF?qr"
      />,
    );
    expect(qr.useQrSvg).toHaveBeenLastCalledWith("https://www.soundclash.org/join/ABCDEF?qr", 220);
    expect(screen.getByText("https://www.soundclash.org/join/ABCDEF")).toBeInTheDocument();
    expect(screen.queryByText(/\?qr/)).not.toBeInTheDocument();
  });

  it("encodes the printed address when there is no tag", () => {
    render(<QRPanel gameCode="ABCDEF" joinUrl="https://www.soundclash.org/join/ABCDEF" />);
    expect(qr.useQrSvg).toHaveBeenLastCalledWith("https://www.soundclash.org/join/ABCDEF", 220);
  });
});
