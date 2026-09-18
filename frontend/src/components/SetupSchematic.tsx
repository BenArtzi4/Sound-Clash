// How-to-play hero: an inline SVG schematic of the three-screen setup, drawn
// in the icon style (design system §7) — the host's phone with the game code
// and the score buttons, the TV with the board and the join QR, and two team
// phones with the BUZZ tile. It replaces the 2.3 MB raster hero.
//
// The only text is "ABCDEF" and "BUZZ": HowToPlayPage.test asserts that the
// step numerals are the page's only bare digits 1–7, so nothing here may
// render a digit as text. Colours come from the tokens via inline `style`
// (custom properties are not resolved in SVG presentation attributes).

const ALT =
  "Three-screen setup: host's phone showing the Game Manager console, a TV displaying the scoreboard and join QR code, and team phones with the BUZZ button.";

// 7×7 join-QR sketch on the TV: three finder-like blocks plus a few modules.
const QR = ["1110111", "1010101", "1110111", "0101010", "1110101", "1010011", "1110101"];
const QR_X = 560;
const QR_Y = 95;
const QR_CELL = 12;
const QR_MODULE = 10;

const SCORE_BUTTON_Y = [124, 168, 212, 256];

const displayFont = { fontFamily: "var(--font-display)" };

export function SetupSchematic() {
  return (
    <svg
      viewBox="0 0 960 360"
      role="img"
      aria-label={ALT}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Host phone: game code + the four score buttons. */}
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="60" y="40" width="160" height="280" rx="18" />
        <text
          x="140"
          y="98"
          textAnchor="middle"
          fontSize="26"
          letterSpacing="4"
          fill="currentColor"
          stroke="none"
          style={displayFont}
        >
          ABCDEF
        </text>
        {SCORE_BUTTON_Y.map((y) => (
          <rect key={y} x="84" y={y} width="112" height="32" rx="8" />
        ))}
        <path d="M125 302h30" />
      </g>

      {/* TV: scoreboard rows + join QR. */}
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="300" y="60" width="360" height="210" rx="8" />
        <path d="M480 270v28M424 298h112" />
        <rect x="330" y="98" width="200" height="26" rx="4" />
        <rect x="330" y="138" width="168" height="26" rx="4" />
        <rect x="330" y="178" width="136" height="26" rx="4" />
        {QR.flatMap((row, r) =>
          Array.from(row).map((cell, c) =>
            cell === "1" ? (
              <rect
                key={`${r}-${c}`}
                x={QR_X + c * QR_CELL}
                y={QR_Y + r * QR_CELL}
                width={QR_MODULE}
                height={QR_MODULE}
                fill="currentColor"
                stroke="none"
              />
            ) : null,
          ),
        )}
      </g>

      {/* Two team phones, each with the BUZZ tile. */}
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="700" y="40" width="112" height="220" rx="14" />
        <rect
          x="716"
          y="96"
          width="80"
          height="80"
          rx="12"
          stroke="none"
          style={{ fill: "var(--accent)" }}
        />
        <text
          x="756"
          y="136"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="22"
          letterSpacing="1"
          stroke="none"
          style={{ ...displayFont, fill: "var(--accent-ink)" }}
        >
          BUZZ
        </text>
        <path d="M746 240h20" />

        <rect x="832" y="100" width="112" height="220" rx="14" />
        <rect
          x="848"
          y="156"
          width="80"
          height="80"
          rx="12"
          stroke="none"
          style={{ fill: "var(--accent)" }}
        />
        <text
          x="888"
          y="196"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="22"
          letterSpacing="1"
          stroke="none"
          style={{ ...displayFont, fill: "var(--accent-ink)" }}
        >
          BUZZ
        </text>
        <path d="M878 300h20" />
      </g>
    </svg>
  );
}
