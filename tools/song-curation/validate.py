#!/usr/bin/env python3
"""Validation pass: standardise every name on the REAL oEmbed video title.

- drop duplicates / invalid / playlist-banner entries
- for playlist-sourced rows, re-derive artist/title from the real oEmbed title
  (preserving Hebrew apostrophes/gershayim — the earlier parser stripped them)
- keep curated global labels as-is
- soundtracks: artist = film/show name, title = same (mig 028 convention);
  israeli-soundtracks "שיר הפתיחה של X" -> artist = X
- reassign Israeli rows by a curated artist->genre map (splits israeli-pop out)
- emit candidates.js (validated) + flagged.json (still needs a human eye)
"""
from __future__ import annotations
import json, re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
_raw = (HERE / "_verified.js").read_text(encoding="utf-8")
ROWS = json.loads(_raw[_raw.index("["):_raw.rindex("]") + 1])

DASH = re.compile(r"\s+[-–—]\s+")
BRACKETS = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
NOISE = re.compile(r"(הקליפ הרשמי|קליפ רשמי|official.*|prod\.?\s*by.*|lyrics?|audio|visualizer|מתוך.*|\bhd\b|\b4k\b)", re.I)
BANNER = re.compile(r"(פלייליסט|מצעד|playlist|מיקס|top\s*\d+)", re.I)
LATIN_TAIL = re.compile(r"\s+[A-Za-z][A-Za-z .'&]+$")  # trailing English transliteration

def clean(t: str) -> str:
    t = BRACKETS.sub(" ", t).split("|")[0].split("//")[0]
    t = NOISE.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip(" -–—.\t\"")  # keeps internal ' " ׳ ״
    return t

HEB = re.compile(r"[֐-׿]")

def derive(oe: str):
    parts = DASH.split(oe, 1)
    if len(parts) == 2:
        a, s = clean(parts[0]), clean(parts[1])
        # only strip a trailing latin transliteration when the title is Hebrew
        # (otherwise we'd mangle genuinely-English titles like "Waka Waka ...")
        if HEB.search(s):
            s2 = LATIN_TAIL.sub("", s).strip()
            if len(s2) >= 2:
                s = s2
        if a and s:
            return a, s
    return None

POP = ["נועה קירל","אנה זק","סטטיק","בן אל","סטפן לגר","נטע ברזילי","עברי לידר","שירי מימון",
       "הראל סקעת","נינט","מרגול","אגם בוחבוט","דניאל ממן","עידן רפאל חביב","נטע"]
ROCKPOP = ["התקווה 6","משינה","תיסלם","אתניקס","אביב גפן","שלמה ארצי","ברי סחרוף","פורטיסחרוף",
           "אהוד בנאי","יהודה פוליקר","ריטה","מוקי","כנסיית השכל","היהודים","מוניקה סקס","שלום חנוך",
           "כוורת","אסף אבידן","עידן רייכל","רוקפור","נגה ארז","עידן עמדי","אמיר דדון","חנן בן ארי"]
MIZRAHIT = ["אייל גולן","עדן חסון","אושר כהן","איתי לוי","ששון איפרם","בן צור","משה פרץ","קובי פרץ",
            "ליאור נרקיס","שרית חדד","זהבה בן","עדן בן זקן","מושיק עפיה","נסרין","מתן חסן","נדב חנציס",
            "אודיה","שיר לוי","רינת בר","דודו אהרון","עומר אדם","אבי ביטר","זוהר ארגוב","שלומי שבת",
            "אייל לוי","רביבו","משה כורסיה","אבי אבורומי","פאר טסי","עידן יניב","פלד","אליעד"]
ISRAELI = {"mizrahit","israeli-pop","israeli-rock-pop","israeli-rap-hip-hop","israeli-cover","israeli-soundtracks"}

def regenre(artist: str, cur: str) -> str:
    if cur not in ISRAELI:
        return cur
    a = artist or ""
    for kw in POP:
        if kw and kw in a: return "israeli-pop"
    for kw in ROCKPOP:
        if kw and kw in a: return "israeli-rock-pop"
    for kw in MIZRAHIT:
        if kw and kw in a: return "mizrahit"
    return cur

out, flagged = [], []
for r in ROWS:
    if not r["valid"] or r["match_status"] == "duplicate":
        continue
    oe = (r.get("oembed_title") or "").strip()
    if BANNER.search(oe):
        continue  # playlist promo banner video, not a song
    artist = (r.get("artist") or "").strip()
    title = (r.get("title") or "").strip()
    genres = list(r["genres"])
    src = r.get("source") or ""

    if "soundtracks" in genres:
        if "israeli-soundtracks" in genres:
            m = re.search(r"של\s+([^\-|]+)", oe)
            if m:
                artist = clean(m.group(1)).split("׳")[0].strip() or artist
            title = artist or title
        else:
            title = artist or title  # global film themes: title = artist = film
    elif src.startswith("yt "):
        d = derive(oe)
        if d:
            artist, title = d

    # Could not validate an artist (title had no clean "Artist - Song" split and
    # oEmbed didn't help) — drop it rather than ship a blank-artist row.
    if not artist:
        flagged.append({"id": r["youtube_id"], "why": "dropped-no-artist", "oembed": oe, "genres": genres})
        continue
    # a Hebrew-pop/mizrahit/rock song with zero Hebrew anywhere is probably a
    # foreign track that slipped into a mixed playlist (e.g. Shakira in "100 top
    # Israel"). Keep but flag. Skip cover/rap genres where English is normal.
    if any(g in {"mizrahit", "israeli-pop", "israeli-rock-pop"} for g in genres) and not HEB.search(artist + title):
        flagged.append({"id": r["youtube_id"], "why": "maybe-foreign",
                        "proposed": f"{artist} - {title}", "oembed": oe, "genres": genres})

    genres = sorted({regenre(artist, g) for g in genres})
    nr = dict(r); nr["artist"], nr["title"], nr["genres"] = artist, title, genres
    out.append(nr)

(HERE / "candidates.js").write_text(
    "window.CANDIDATES = " + json.dumps(out, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
(HERE / "flagged.json").write_text(json.dumps(flagged, ensure_ascii=False, indent=2), encoding="utf-8")

c = Counter(g for d in out for g in d["genres"])
print(f"validated net-new: {len(out)} | still flagged (blank artist): {len(flagged)}")
for g in ["rock","pop","hip-hop","electronic","soundtracks","mizrahit","israeli-pop",
          "israeli-cover","israeli-rock-pop","israeli-rap-hip-hop","israeli-soundtracks"]:
    print(f"  {g:22} {c.get(g,0)}")
