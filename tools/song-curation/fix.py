#!/usr/bin/env python3
"""Second-pass fixer: catch reversed artist/title and trailing transliteration.

The names are all real (audit.py: 100% present in the YouTube title); the only
remaining risk is field assignment. This:
- swaps artist<->title when a KNOWN artist name sits in the title field but not
  the artist field (a "Song - Artist" playlist entry parsed as artist=Song)
- strips a trailing " - <Latin transliteration>" tail from a Hebrew title/artist
- rewrites candidates.js and reports every change for eyeballing
"""
from __future__ import annotations
import json, re
from pathlib import Path

HERE = Path(__file__).parent
d = Path(HERE / "candidates.js").read_text(encoding="utf-8")
ROWS = json.loads(d.split("=", 1)[1].rsplit(";", 1)[0])
HEB = re.compile(r"[֐-׿]")

# Broad set of well-known Israeli artists (substring match on the Hebrew name).
KNOWN = [
 "אייל גולן","עדן חסון","אושר כהן","איתי לוי","ששון איפרם","בן צור","משה פרץ","קובי פרץ",
 "ליאור נרקיס","שרית חדד","זהבה בן","עדן בן זקן","מושיק עפיה","נסרין","מתן חסן","נדב חנציס",
 "אודיה","שיר לוי","רינת בר","דודו אהרון","עומר אדם","אבי ביטר","זוהר ארגוב","שלומי שבת",
 "רביבו","עופר לוי","פאר טסי","נועה קירל","אנה זק","סטטיק","בן אל","סטפן לגר","אגם בוחבוט",
 "ספיר סבן","רואי אדם","אבי אבורומי","מירי מסיקה","שירי מימון","הראל סקעת","ישי ריבו",
 "חנן בן ארי","עמיר בניון","אמיר דדון","עידן עמדי","עידן רייכל","דקלה","משה כורסיה",
 "התקווה 6","משינה","תיסלם","אתניקס","אביב גפן","שלמה ארצי","ברי סחרוף","פורטיסחרוף",
 "אהוד בנאי","יהודה פוליקר","ריטה","מוקי","כנסיית השכל","היהודים","מוניקה סקס","שלום חנוך",
 "כוורת","אסף אבידן","רוקפור","דודו טסה","אריק איינשטיין","שלמה גרוניך","מאיר בנאי",
 "רמי קלינשטיין","גידי גוב","יוני רכטר","דני סנדרסון","ארקדי דוכין","אפוקליפסה","סאבלימינל",
 "פלאשבק","פאנצ","פלד","אליעד","סטלוס","עידן יניב","דנה אינטרנשיונל","עידן רפאל חביב",
 "מרגי","טונה","נצא","קרן פלס","ריף כהן","יסמין מועלם","עברי לידר","ניב",
 "עמית חיו","עפרה חזה","יזהר אשדות","רמי פורטיס","אביתר בנאי","דויד ברוזה","דיויד ברוזה",
 "מתי כספי","חוה אלברשטיין","נורית גלרון","שלמה בר","בועז שרעבי","יהורם גאון","אריק סיני",
 "מירי אלוני","גלי עטרי","עוזי חיטמן","קובי אוז","אהובה עוזרי","חיים משה","חיים אוליאל",
 "בני אלבז","ליאור פרחי","דנה ברגר","אהוד מנור","שלמה גרוניך","יוני בלוך","אסף אמדורסקי",
 "מאור אדרי","יהודה קיסר","משה לוי","יזהר כהן","ירדנה ארזי","קובי פרץ","עוזי פוקס",
]
def known_in(text: str) -> str | None:
    for k in KNOWN:
        if k in (text or ""):
            return k
    return None

LATIN_TAIL = re.compile(r"\s*[-–—]\s*[A-Za-z][\w .,'&!?\"-]*$")
def strip_tail(s: str) -> str:
    if HEB.search(s):
        s2 = LATIN_TAIL.sub("", s).strip(" -–—\"")
        if len(s2) >= 2:
            return s2
    return s.strip(" -–—\"")

# promotional junk in a title/artist => not a clean catalog entry, drop it.
# (specific phrases only — bare words like חתונה / מופע appear in real song/band names)
JUNK = re.compile(r"(זמר לחתונה|זמר לאירוע|סינגל חדש|הרכב לקבל|עם מילות השיר|קאבר לייב|"
                  r"הלהיט של הזמר|יוצר:|פלייבק|קריוקי|שירה בציבור|מתוך התכנית|לקבלת פנים)")
DROP_ARTIST = ["עמית חיו"]  # minor self-promoter; whole playlist was junk-titled
LATIN_NODASH_TAIL = re.compile(r"\s+[A-Za-z][A-Za-z .'&]+$")  # " Amit Hayo" tail w/o dash

swaps, trims, dropped, kept = [], [], [], []
for r in ROWS:
    a, t = r.get("artist", ""), r.get("title", "")
    if known_in(t) and not known_in(a):  # reversal: known artist in title field
        r["artist"], r["title"] = t, a
        swaps.append((r["youtube_id"], f"{a} | {t}", f"{r['artist']} | {r['title']}"))
        a, t = r["artist"], r["title"]
    na, nt = strip_tail(a), strip_tail(t)
    if HEB.search(na):  # also drop a trailing dash-less latin transliteration of the artist
        na = LATIN_NODASH_TAIL.sub("", na).strip() or na
    if (na, nt) != (a, t):
        trims.append((r["youtube_id"], f"{a} | {t}", f"{na} | {nt}"))
    r["artist"], r["title"] = na, nt
    # legit Israeli acts that use a Latin stage name -> keep, force israeli-pop
    ALLOW = ("static", "ben el", "noam bettan")
    if any(a in r["artist"].lower() for a in ALLOW):
        r["genres"] = ["israeli-pop"]
    oe = r.get("oembed_title", "")
    # a Hebrew-language genre with a non-Hebrew artist (not allow-listed) is a
    # foreign track that leaked from a "top in Israel"/covers chart -> drop.
    foreign = (any(g in {"israeli-pop", "mizrahit", "israeli-rock-pop", "israeli-cover"} for g in r["genres"])
               and not HEB.search(r["artist"])
               and not any(a in r["artist"].lower() for a in ALLOW))
    medley = "מחרוזת" in r["title"] or "מחרוזת" in oe  # multiple songs in one clip
    if (any(x in r["artist"] for x in DROP_ARTIST) or JUNK.search(r["artist"])
            or JUNK.search(r["title"]) or foreign or medley):
        dropped.append((r["youtube_id"], f"{r['artist']} | {r['title']}"))
        continue
    kept.append(r)

# within-batch dedup: same song uploaded twice (different id) collapses to one.
import unicodedata
_NIQ = re.compile(r"[֑-ׇ]")
def _norm(s: str) -> str:
    s = _NIQ.sub("", s or "")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).casefold()
    return re.sub(r"[^\w֐-׿]+", " ", s).strip()
seen_key, deduped, batch_dups = set(), [], 0
for r in kept:
    k = (_norm(r["artist"]), _norm(r["title"]))
    if k in seen_key:
        batch_dups += 1
        continue
    seen_key.add(k)
    deduped.append(r)
kept = deduped

Path(HERE / "candidates.js").write_text(
    "window.CANDIDATES = " + json.dumps(kept, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
print(f"swapped: {len(swaps)} | trimmed: {len(trims)} | dropped junk: {len(dropped)} | within-batch dups: {batch_dups} | kept: {len(kept)}")
for vid, s in dropped[:15]:
    print(f"  DROP {s}")
for i, (vid, b, a) in enumerate(swaps[:20]):
    print(f"  SWAP {b}  ->  {a}")
for vid, b, a in trims[:12]:
    print(f"  TRIM {b}  ->  {a}")
