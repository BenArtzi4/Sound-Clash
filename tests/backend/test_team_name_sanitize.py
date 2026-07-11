"""Team-name sanitization (T5.2): control/bidi/zero-width chars are stripped.

Pure model-level tests — no DB, no HTTP. The guard lives on the ``TeamName``
type as a ``BeforeValidator``, so it applies to every ``POST /games/{code}/teams``
request body. Invisible test inputs are built with ``chr()`` so this file
carries no invisible characters of its own.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.games import JoinTeamRequest

ZWSP = chr(0x200B)  # zero-width space (stripped)
ZWNJ = chr(0x200C)  # zero-width non-joiner (KEPT)
ZWJ = chr(0x200D)  # zero-width joiner (KEPT — emoji glue)
LRM = chr(0x200E)  # left-to-right mark (stripped)
RLO = chr(0x202E)  # right-to-left override (stripped)
WORD_JOINER = chr(0x2060)  # (stripped)
LINE_SEP = chr(0x2028)  # line separator (stripped)
BOM = chr(0xFEFF)  # zero-width no-break space / BOM (stripped)
NUL = chr(0x00)  # C0 control (stripped)


def _name(value: str) -> str:
    return JoinTeamRequest(name=value).name


def test_plain_ascii_unchanged() -> None:
    assert _name("Team Awesome") == "Team Awesome"


def test_hebrew_unchanged() -> None:
    # Hebrew renders RTL via the Unicode bidi algorithm; no format marks needed.
    assert _name("קבוצה מנצחת") == "קבוצה מנצחת"


def test_simple_emoji_preserved() -> None:
    party = "Party " + chr(0x1F389)
    assert _name(party) == party


def test_zwj_emoji_sequence_preserved() -> None:
    # Woman astronaut = 👩 + ZWJ + 🚀; stripping ZWJ would shatter the glyph.
    astronaut = chr(0x1F469) + ZWJ + chr(0x1F680)
    assert _name(astronaut) == astronaut
    assert ZWJ in _name(astronaut)


def test_zwnj_preserved() -> None:
    joined = "a" + ZWNJ + "b"
    assert _name(joined) == joined


def test_control_chars_stripped() -> None:
    assert _name("a" + NUL + "b") == "ab"
    assert _name("line1" + LINE_SEP + "line2") == "line1line2"
    assert _name("a\tb") == "ab"


def test_bidi_marks_stripped() -> None:
    assert _name(RLO + "evil") == "evil"
    assert _name("a" + LRM + "b") == "ab"


def test_zero_width_and_bom_stripped() -> None:
    assert _name("a" + ZWSP + "b") == "ab"
    assert _name(BOM + "name") == "name"
    assert _name("a" + WORD_JOINER + "b") == "ab"


def test_whitespace_still_trimmed() -> None:
    assert _name("  x  ") == "x"


def test_sanitize_runs_before_length_check() -> None:
    # 28 real chars + 5 bidi marks = 33 raw (> 30 cap), but 28 after stripping.
    # Only passes if the BeforeValidator runs before the max_length constraint.
    raw = (RLO * 5) + ("A" * 28)
    assert _name(raw) == "A" * 28


def test_all_invisible_collapses_and_is_rejected() -> None:
    with pytest.raises(ValidationError):
        JoinTeamRequest(name=ZWSP + RLO + BOM)


def test_blank_still_rejected() -> None:
    with pytest.raises(ValidationError):
        JoinTeamRequest(name="   ")


def test_too_long_still_rejected() -> None:
    with pytest.raises(ValidationError):
        JoinTeamRequest(name="X" * 31)
