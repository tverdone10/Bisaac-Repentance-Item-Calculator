"""Turn cached wikitext into the JSON the app consumes.

Reads data/raw/** (built by fetch_wiki.py) and writes:
    src/data/characters.json
    src/data/items.json
    src/data/trinkets.json
    data/review_stats.md      <- numeric effect lines the extractor did NOT
                                 understand, so gaps are visible and triageable

Design notes:
  * Everything is filtered to Repentance+ using the codes resolved by
    resolve_dlc.py. A {{dlc|nr}} bullet describes pre-Repentance behaviour and
    is dropped outright rather than averaged in.
  * Stat extraction is deliberately conservative. A bullet only produces a
    modifier if it matches a known shape; anything numeric that doesn't match
    goes to the review report instead of being guessed at. Silent wrong
    numbers are much worse than visible gaps in a calculator.

Usage:
    python scripts/parse_data.py
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT_TS = ROOT / "src" / "data"
DLC_CODES = ROOT / "data" / "dlc_codes.json"
REVIEW = ROOT / "data" / "review_stats.md"

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

NON_ITEM_PAGES = {
    "Collection Page", "Item Tags",
    "Unlocking Super Meat Boy & Super Bandage Girl", "Golden Trinket",
}

# Repentance+ defaults, used when a character infobox omits the field.
DEFAULT_BASE = {
    "damage": 3.5,
    "damageMultiplier": 1.0,
    "tears": 0.0,
    "fireRateMultiplier": 1.0,
    "shotsPerVolley": 1.0,
    "speed": 1.0,
    "range": 6.5,
    "shotSpeed": 1.0,
    "luck": 0.0,
}

MANIFEST = ROOT / "public" / "sprites" / "manifest.json"


def load_sprites() -> dict[str, dict[str, str]]:
    """group -> {page title: public sprite path}.

    Paths are emitted into the data so the app never recomputes a slug and
    cannot drift out of sync with what fetch_sprites.py actually wrote.
    """
    if not MANIFEST.exists():
        return {}
    raw = json.loads(io.open(MANIFEST, encoding="utf-8").read())
    return {
        group: {
            name: f"sprites/{group}/{fname}"
            for name, fname in payload.get("sprites", {}).items()
        }
        for group, payload in raw.items()
    }


SPRITES = load_sprites()
MISSING_SPRITES: list[str] = []


def sprite_for(group: str, title: str) -> str | None:
    path = SPRITES.get(group, {}).get(title)
    if path is None:
        MISSING_SPRITES.append(f"{group}/{title}")
    return path


# ---------------------------------------------------------------- dlc handling


def load_dlc() -> dict[str, bool]:
    data = json.loads(io.open(DLC_CODES, encoding="utf-8").read())
    return {c: v["applies_to_target"] for c, v in data["codes"].items()}


DLC = load_dlc()


def dlc_applies(code: str) -> bool:
    """True if content tagged with this code exists in Repentance+.

    Unknown codes default to True: better to show a value that might be stale
    than to silently drop a real one. Unknowns are reported at the end.
    """
    code = code.strip()
    if code in DLC:
        return DLC[code]
    UNKNOWN_DLC.add(code)
    return True


UNKNOWN_DLC: set[str] = set()
CHARACTER_MULT_USED: set[str] = set()
CHARACTER_SHOTS_USED: set[str] = set()


def find_templates(text: str, name: str) -> list[tuple[int, int, list[str]]]:
    """Locate balanced {{name|...}} calls. Returns (start, end, args)."""
    out = []
    needle = "{{" + name
    i = 0
    while True:
        i = text.lower().find(needle.lower(), i)
        if i < 0:
            return out
        # Confirm the name ends at a delimiter, so {{dlc}} != {{dlcalt}}.
        # Infoboxes put a newline before the first pipe, so skip whitespace
        # before testing -- requiring the delimiter immediately silently broke
        # every infobox lookup.
        rest = text[i + len(needle):]
        after = rest.lstrip()[:1]
        if after not in ("|", "}"):
            i += 2
            continue
        depth = 0
        j = i
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1
                j += 2
            elif text.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        body = text[i + 2: j - 2]
        out.append((i, j, split_args(body)))
        i = j


def split_args(body: str) -> list[str]:
    """Split template args on top-level | only (ignoring nested {{ }} / [[ ]])."""
    parts, buf, depth = [], [], 0
    k = 0
    while k < len(body):
        if body.startswith("{{", k) or body.startswith("[[", k):
            depth += 1
            buf.append(body[k:k + 2])
            k += 2
        elif body.startswith("}}", k) or body.startswith("]]", k):
            depth -= 1
            buf.append(body[k:k + 2])
            k += 2
        elif body[k] == "|" and depth == 0:
            parts.append("".join(buf))
            buf = []
            k += 1
        else:
            buf.append(body[k])
            k += 1
    parts.append("".join(buf))
    return parts


def resolve_dlcalt(text: str) -> str:
    """{{dlcalt|default|r=X|r+=Y}} -> the Repentance+ variant.

    Named args are version overrides; the positional arg is the fallback for
    versions with no override. Most specific applicable wins (r+ over r).
    """
    while True:
        hits = find_templates(text, "dlcalt")
        if not hits:
            return text
        start, end, args = hits[0]
        positional, named = [], {}
        for a in args[1:]:
            m = re.match(r"\s*([a-z+]+)\s*=\s*(.*)$", a, re.S)
            if m and (m.group(1) in DLC or m.group(1) in ("r", "r+")):
                named[m.group(1)] = m.group(2)
            else:
                positional.append(a)
        choice = None
        for key in ("r+", "r"):
            if key in named and dlc_applies(key):
                choice = named[key]
                break
        if choice is None:
            # any other applicable override, else the positional default
            for key, val in named.items():
                if dlc_applies(key):
                    choice = val
                    break
        if choice is None:
            choice = positional[0] if positional else ""
        text = text[:start] + choice + text[end:]


def apply_dlc_inline(text: str) -> str | None:
    """Resolve {{dlc|code}} and {{dlc|code|content}} for Repentance+.

    Returns None if the whole string is gated to a version that isn't
    Repentance+ (a bare leading {{dlc|nr}} marker scopes the rest of the line).
    """
    text = resolve_dlcalt(text)

    # A bare marker at the start gates the entire line.
    lead = re.match(r"\s*(?:\*+\s*)?\{\{dlc\|([a-z+]+)\}\}", text, re.I)
    if lead and not dlc_applies(lead.group(1)):
        return None

    while True:
        hits = find_templates(text, "dlc")
        hits = [h for h in hits if len(h[2]) >= 2 and h[2][0].lower() == "dlc"]
        if not hits:
            break
        start, end, args = hits[0]
        code = args[1] if len(args) > 1 else ""
        content = args[2] if len(args) > 2 else ""
        keep = content if dlc_applies(code) else ""
        text = text[:start] + keep + text[end:]

    # {{dlc+|code}} ... {{dlc-}} block scoping
    for _, _, args in find_templates(text, "dlc+"):
        if len(args) > 1 and not dlc_applies(args[1]):
            # Drop from the dlc+ marker to the matching dlc-
            text = re.sub(
                r"\{\{dlc\+\|" + re.escape(args[1]) + r"\}\}.*?\{\{dlc-\}\}",
                "", text, flags=re.S | re.I,
            )
    text = re.sub(r"\{\{dlc[+\-]\|?[a-z+]*\}\}", "", text, flags=re.I)
    return text


# -------------------------------------------------------------- text cleaning

LINK_TEMPLATES = "icetpsrmb"  # {{i|..}} item, {{c|..}} character, etc.


def clean(text: str) -> str:
    """Wikitext -> readable plain text."""
    if text is None:
        return ""
    t = text

    t = re.sub(r"<math[^>]*>(.*?)</math>", lambda m: tidy_math(m.group(1)),
               t, flags=re.S)
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"<ref[^>]*>.*?</ref>", "", t, flags=re.S | re.I)
    t = re.sub(r"<ref[^>]*/>", "", t, flags=re.I)
    t = re.sub(r"<br\s*/?>", " ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)

    # Single-letter link templates: {{i|Brimstone}} -> Brimstone,
    # {{i|Brimstone|r}} -> Brimstone (second arg is a dlc hint, not text).
    t = re.sub(
        r"\{\{([" + LINK_TEMPLATES + LINK_TEMPLATES.upper() + r"])\|([^}|]+)(\|[^}]*)?\}\}",
        r"\2", t,
    )
    t = re.sub(r"\{\{(?:tag|code)\|([^}|]+)\}\}", r"\1", t, flags=re.I)
    t = re.sub(r"\{\{hearts\|([^}]*)\}\}", r"\1", t, flags=re.I)
    # Collapse innermost-first so nested templates like
    # {{column list|content={{i|X}}}} don't leave dangling fragments.
    for _ in range(8):
        t2 = re.sub(r"\{\{[^{}]*\}\}", "", t)
        if t2 == t:
            break
        t = t2
    t = re.sub(r"\{\{.*", "", t, flags=re.S)       # unbalanced leftovers
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = t.replace("'''", "").replace("''", "")
    # Normalise unicode maths so one set of patterns covers both
    # spellings. The wiki mixes "x", U+00D7 and U+00F7 freely; missing
    # these silently dropped real multipliers (20/20, Almond Milk,
    # Cricket's Head, Brimstone).
    t = (t.replace("\u00d7", "x").replace("\u00f7", "/")
          .replace("\u2212", "-").replace("\u2013", "-"))
    t = re.sub(r"https?://\S+", "", t)
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip(" *:;\n")


def tidy_math(tex: str) -> str:
    """Crude LaTeX -> readable inline formula."""
    t = tex
    t = re.sub(r"\\mathit\{([^}]*)\}|\\text\{([^}]*)\}|\\mathrm\{([^}]*)\}",
               lambda m: m.group(1) or m.group(2) or m.group(3) or "", t)
    t = t.replace(r"\times", "*").replace(r"\cdot", "*")
    t = re.sub(r"\\frac\{([^}]*)\}\{([^}]*)\}", r"(\1)/(\2)", t)
    t = re.sub(r"\\sqrt\{([^}]*)\}", r"sqrt(\1)", t)
    t = t.replace("{+}", "+").replace("\\", "")
    t = re.sub(r"[{}]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def infobox(text: str, kind: str) -> dict[str, str]:
    """Pull the named infobox's fields into a dict of raw (uncleaned) values."""
    hits = find_templates(text, "infobox " + kind)
    if not hits:
        return {}
    _, _, args = hits[0]
    out: dict[str, str] = {}
    for a in args[1:]:
        m = re.match(r"\s*([a-z0-9 '/+]+?)\s*=\s*(.*)$", a, re.S)
        if m:
            out[m.group(1).strip()] = m.group(2).strip()
    return out


def section(text: str, *names: str) -> str:
    """Return the body of the first matching == Section == heading."""
    for name in names:
        m = re.search(
            r"^==\s*" + name + r"\s*==\s*$(.*?)(?=^==[^=]|\Z)",
            text, re.M | re.S | re.I,
        )
        if m:
            return m.group(1)
    return ""


def bullets(body: str) -> list[str]:
    """Top-level bullet lines of a section, DLC-filtered and cleaned."""
    out = []
    for line in body.splitlines():
        s = line.strip()
        if not s.startswith("*"):
            continue
        depth = len(s) - len(s.lstrip("*"))
        raw = s.lstrip("*").strip()
        resolved = apply_dlc_inline(raw)
        if resolved is None:
            continue
        txt = clean(resolved)
        if txt:
            out.append({"depth": depth, "text": txt})
    return out


def link_dlc_excluded(raw: str) -> bool:
    """True if a bullet's leading item link is tagged for another version.

    Synergy and interaction bullets name their partner item as
    {{I|Name|code}} / {{I|Name|dlc=code}}, where the code is a DLC range for
    the *interaction*, not just the item. 431 entries in these sections were
    removed in Repentance and 33 more in Repentance+; keeping them would
    present long-dead behaviour as current.

    Only known DLC codes gate a bullet -- the second parameter is sometimes
    something else entirely (e.g. {{t|Lil Larva|dlc=n}}), and dropping those
    would lose real content.
    """
    m = re.match(r"\s*\{\{[iItT]\|[^}|]+\|(?:dlc=)?([a-z+]+)\}\}", raw)
    if not m:
        return False
    code = m.group(1)
    return code in DLC and not DLC[code]


# Group labels inside an Interactions section are plain lines ending in ":",
# not wiki headings, and they carry the meaning of the bullets beneath them:
#   "Overridden by Brimstone:"                        -> behaviour replaced
#   "Only stat effects are applied; otherwise ...:"    -> stats still count
GROUP_RE = re.compile(r"^[^*#=|{].{0,120}:\s*$")


def grouped_bullets(body: str) -> list[dict]:
    """Bullets of a section, tagged with the group heading above them.

    Flattening these loses the point: a bare "20/20" under "Overridden by
    Brimstone" means something very different from one under "Other
    interactions".
    """
    out: list[dict] = []
    group: str | None = None
    for line in body.splitlines():
        s = line.strip()
        if not s:
            continue
        if not s.startswith("*"):
            if GROUP_RE.match(s):
                label = clean(apply_dlc_inline(s) or "").rstrip(":").strip()
                group = label or None
            continue
        raw = s.lstrip("*").strip()
        if link_dlc_excluded(raw):
            continue
        resolved = apply_dlc_inline(raw)
        if resolved is None:
            continue
        txt = clean(resolved)
        if txt:
            out.append({
                "group": group,
                "text": txt,
                "depth": len(s) - len(s.lstrip("*")),
            })
    return out


# ----------------------------------------------------------- stat extraction

NUM = r"([+\-\u2212\u2013]?\s*\d+(?:\.\d+)?)"

STAT_FIELD = {
    "damage": "damageUps",
    "tears": "tears",
    "speed": "speed",
    "range": "range",
    "shot speed": "shotSpeed",
    "luck": "luck",
    "fire rate": "fireRateAdd",
    "tear delay": "tearDelay",
}

# Multiplicative counterparts, for "0.8x range multiplier" style bullets.
MULT_FIELD = {
    "damage": "damageMultipliers",
    "fire rate": "fireRateMultipliers",
    "tears": "fireRateMultipliers",
    "tear delay": "tearDelayMultipliers",
    "speed": "speedMultipliers",
    "range": "rangeMultipliers",
    "shot speed": "shotSpeedMultipliers",
}

# Stats the engine does not model; recognised so they don't pollute review.
IGNORED_STATS = {
    "tear falling speed", "tear size", "tear scale", "knockback",
    "bomb damage", "shot height", "tear height",
}


MULT_ALT = "|".join(sorted(MULT_FIELD, key=len, reverse=True))
STAT_ALT = "|".join(sorted(STAT_FIELD, key=len, reverse=True))


def num(s: str) -> float:
    return float(s.replace(" ", "").replace("\u2212", "-").replace("\u2013", "-"))


def extract_mods(lines: list[dict]) -> tuple[dict, list[str]]:
    """Pull stat modifiers out of effect bullets.

    Returns (mods, unmatched) where unmatched holds numeric-looking lines the
    patterns did not claim, for the review report.
    """
    mods: dict = {
        "damageUps": 0.0, "damageUpMultipliers": [],
        "flatDamage": 0.0, "damageMultipliers": [],
        "nonStackingMultipliers": [], "tears": 0.0, "tearDelay": 0.0,
        "fireRateAdd": 0.0, "fireRateMultipliers": [],
        "tearDelayMultipliers": [], "shotMultipliers": [],
        "speed": 0.0, "range": 0.0, "shotSpeed": 0.0, "luck": 0.0,
        "speedMultipliers": [], "rangeMultipliers": [],
        "shotSpeedMultipliers": [],
    }
    unmatched: list[str] = []

    for item in lines:
        line = item["text"]

        # A conditional or state-scaled line must never yield a flat
        # modifier. This guard used to be implicit -- the patterns required
        # the line to start with a number -- but stripping leading verbs
        # ("Grants +0.6 damage for each stat down pill") exposed these, which
        # silently applied one pill's worth of a scaling bonus as a constant.
        # They are reported through conditionalEffects instead.
        if CONDITION_RE.search(line):
            continue

        low = line.lower().rstrip(".")
        claimed = False

        # A leading "<stat> up:" / "<stat> down:" label just restates the
        # subject ("Range down: 0.8x range multiplier"); drop it so the
        # patterns below see the actual change.
        low = re.sub(
            r"^(?:damage|tears|fire rate|range|speed|shot speed|luck)\s+"
            r"(?:up|down)\s*:\s*",
            "",
            low,
        )

        # Many lines lead with a verb -- "Gives Isaac +2.0 luck", "Also
        # grants +0.4 Tears". The stat patterns below anchor on the number,
        # so without this the whole line slides past unparsed.
        low = re.sub(
            r"^(?:also\s+)?(?:gives?|grants?|adds?|provides?)\s+"
            r"(?:isaac\s+)?(?:a\s+)?",
            "",
            low,
        )

        # "+1 flat damage" / "+4 flat damage up"
        m = re.match(rf"^{NUM}\s+flat\s+damage\b", low)
        if m:
            mods["flatDamage"] += num(m.group(1))
            continue

        # "x0.9 total damage up multiplier" -- scales the damage-up SUM
        # inside the sqrt, not final damage. Must precede the plain
        # "Nx damage" pattern, which would mis-file it as a total multiplier.
        m = re.match(
            rf"^(?:{NUM}\s*x|x\s*{NUM})\s+(?:total\s+)?damage\s+up\b", low
        )
        if m:
            mods["damageUpMultipliers"].append(num(m.group(1) or m.group(2)))
            continue

        # "+1 damage and 1.5x damage multiplier." -- one sentence, two
        # changes. Handled explicitly because the single-change patterns
        # below would take the first and discard the second.
        m = re.match(
            rf"^{NUM}\s+damage\s+and\s+(?:{NUM}\s*x|x\s*{NUM})\s+damage\b",
            low,
        )
        if m:
            mods["damageUps"] += num(m.group(1))
            mods["damageMultipliers"].append(num(m.group(2) or m.group(3)))
            continue

        # "0.2x damage multiplier" / "x1.5 damage" / "0.8x range multiplier"
        m = re.match(
            rf"^(?:{NUM}\s*x|x\s*{NUM})\s+"
            rf"({MULT_ALT})\b",
            low,
        )
        if m:
            mods[MULT_FIELD[m.group(3)]].append(num(m.group(1) or m.group(2)))
            continue

        # "Tear Delay x 2 + 11" (Haemolacria): a multiplier AND an additive
        # term in one statement. Must be matched before the plain
        # "tear delay x N" pattern, which would silently drop the "+ 11".
        m = re.match(
            rf"^tear delay\s*[*x]\s*{NUM}\s*([+\-])\s*{NUM}\b", low
        )
        if m:
            mods["tearDelayMultipliers"].append(num(m.group(1)))
            add = num(m.group(3))
            mods["tearDelay"] += -add if m.group(2) == "-" else add
            continue

        # "Tears fired per second * (2/3)" -- parenthesised fraction.
        m = re.match(
            r"^(?:tears fired per second|tear delay|fire rate)\s*[*x]\s*"
            r"\(\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*\)",
            low,
        )
        if m and float(m.group(2)):
            factor = float(m.group(1)) / float(m.group(2))
            field = ("tearDelayMultipliers" if low.startswith("tear delay")
                     else "fireRateMultipliers")
            mods[field].append(factor)
            continue

        # "Tears fired per second * 0.42" / "tear delay x 3" / "fire rate / 3"
        m = re.match(
            rf"^(?:tears fired per second|tear delay|fire rate)\s*([*x/])\s*{NUM}",
            low,
        )
        if m:
            factor = num(m.group(2))
            field = ("tearDelayMultipliers" if low.startswith("tear delay")
                     else "fireRateMultipliers")
            if m.group(1) == "/" and factor:
                factor = 1 / factor
            mods[field].append(factor)
            continue

        # "Tears down: Tear Delay x 2.5 / Fire Rate / 2.5" -- the two halves
        # restate the same change, so only the tear delay half is applied.
        m = re.match(
            rf"^tears?\s*(?:up|down)\s*:\s*tear delay\s*([*x/])\s*{NUM}", low
        )
        if m:
            factor = num(m.group(2))
            if m.group(1) == "/" and factor:
                factor = 1 / factor
            mods["tearDelayMultipliers"].append(factor)
            continue

        # "1/3 Fire Rate" (Ipecac) -- a bare fraction prefix.
        m = re.match(r"^(\d+)\s*/\s*(\d+)\s+(fire rate|tears)\b", low)
        if m and float(m.group(2)):
            mods["fireRateMultipliers"].append(
                float(m.group(1)) / float(m.group(2))
            )
            continue

        # "multiplies fire rate by 5.5x" / "divides tear delay by 5.5x"
        m = re.search(r"\b(multiplies|divides)\b.*?\bby\s+([\d.]+)\s*x", low)
        if m and ("fire rate" in low or "tear delay" in low):
            factor = float(m.group(2))
            # Dividing tear delay by N is the same as multiplying fire rate
            # by N -- the wiki states Soy Milk both ways on different lines.
            if m.group(1) == "divides" and "tear delay" not in low:
                factor = 1 / factor if factor else 1
            mods["fireRateMultipliers"].append(factor)
            continue

        # "+1 damage." / "-0.3 shot speed." / "+2.5 range."
        m = re.match(
            rf"^{NUM}\s+({'|'.join(sorted(STAT_FIELD, key=len, reverse=True))})"
            r"(?:\s+(?:up|down))?\b",
            low,
        )
        if m:
            field = STAT_FIELD[m.group(2)]
            mods[field] += num(m.group(1))
            claimed = True

        if claimed:
            continue

        # A single bullet can list several changes: My Reflection reads
        # "2x + 1.5 range, +1.5 damage, -1 luck." Only reached when the
        # whole-line patterns above found nothing, so this cannot
        # double-count a line that already contributed.
        if "," in low or " and " in low:
            segs = [s.strip() for s in re.split(r",| and ", low) if s.strip()]
            claimed_any = False
            for seg in segs:
                # "2x + 1.5 range" -> a multiplier AND an additive on range
                m = re.match(
                    rf"^(?:{NUM}\s*x|x\s*{NUM})\s*\+\s*{NUM}\s+({MULT_ALT})\b",
                    seg,
                )
                if m:
                    field = MULT_FIELD[m.group(4)]
                    mods[field].append(num(m.group(1) or m.group(2)))
                    add_key = {
                        "damageMultipliers": "damageUps",
                        "rangeMultipliers": "range",
                        "speedMultipliers": "speed",
                        "shotSpeedMultipliers": "shotSpeed",
                    }.get(field)
                    if add_key:
                        mods[add_key] += num(m.group(3))
                    claimed_any = True
                    continue
                # plain "+1.5 damage" / "-1 luck"
                m = re.match(
                    rf"^{NUM}\s+({STAT_ALT})(?:\s+(?:up|down))?\b", seg
                )
                if m:
                    mods[STAT_FIELD[m.group(2)]] += num(m.group(1))
                    claimed_any = True
                    continue
                # "0.8x range multiplier" inside a list
                m = re.match(
                    rf"^(?:{NUM}\s*x|x\s*{NUM})\s+({MULT_ALT})\b", seg
                )
                if m:
                    mods[MULT_FIELD[m.group(3)]].append(
                        num(m.group(1) or m.group(2))
                    )
                    claimed_any = True
            if claimed_any:
                continue

        if any(s in low for s in IGNORED_STATS):
            continue

        # Anything else numeric that mentions a stat word is worth a human look.
        if re.search(r"\d", low) and re.search(
            r"\b(damage|tears|fire rate|speed|range|luck|tear delay)\b", low
        ):
            unmatched.append(line)

    return mods, unmatched


OVERRIDES_PATH = ROOT / "data" / "overrides.json"


def load_overrides() -> dict[str, dict]:
    if not OVERRIDES_PATH.exists():
        return {}
    raw = json.loads(io.open(OVERRIDES_PATH, encoding="utf-8").read())
    return {k: v for k, v in raw.items() if not k.startswith("_")}


OVERRIDES = load_overrides()
OVERRIDES_USED: set[str] = set()
DPS_NOTE_USED: set[str] = set()
SHOT_MULT_USED: set[str] = set()


def apply_override(name: str, mods: dict) -> tuple[dict, str | None]:
    """Merge a hand-verified override over parsed mods.

    Returns (mods, reason). `replace` discards the parsed values entirely,
    which is needed when the extractor put a value in the wrong channel
    (e.g. a non-stacking multiplier read as a freely-stacking one).
    """
    entry = OVERRIDES.get(name)
    if not entry:
        return mods, None
    OVERRIDES_USED.add(name)
    out = {k: ([] if isinstance(v, list) else 0.0) for k, v in mods.items()} \
        if entry.get("replace") else dict(mods)
    for key, val in entry.get("mods", {}).items():
        if key not in out:
            raise ValueError(f"override {name!r} sets unknown channel {key!r}")
        out[key] = list(val) if isinstance(val, list) else val
    return out, entry.get("reason")


# Phrases that gate a stat change behind a condition. An item whose only
# stat effects are conditional (Mega Mush's 4x damage for 30 seconds, Sulfur
# for the current room, Succubus while inside its aura) must NOT contribute a
# flat modifier -- but the user still deserves to know it was left out.
CONDITION_RE = re.compile(
    r"\b(while|when|whenever|upon|during|until|after taking|for the current "
    r"(?:room|floor|stage)|temporar|for \d+ seconds?|if isaac|if the|"
    r"chance|per (?:room|floor|enemy|kill)|every time|based on|depend|"
    r"scales?\b|additional copies|stand(?:s|ing)? (?:in|inside)|"
    r"gigantic|berserk|for each|for every|every \d+ coins?|in a cycle|"
    r"rest of the (?:floor|run)|right eye|left eye)",
    re.I,
)

# A line only counts as a dropped conditional if it describes a change to one
# of ISAAC's stats. Merely mentioning "damage" isn't enough -- "deals 40
# damage to every enemy" is enemy damage, not a player stat, and flagging it
# would bury the real conditionals in noise.
STATS_ALT = r"damage|tears|fire rate|tear delay|shot speed|range|speed|luck"
STAT_CHANGE_RE = re.compile(
    # "+2 damage", "-0.18 speed"
    rf"[+\-−]\s*\d+(?:\.\d+)?\s*(?:{STATS_ALT})\b"
    # "1.5x damage", "x4 damage", "4x damage multiplier"
    rf"|(?:\d+(?:\.\d+)?\s*x|x\s*\d+(?:\.\d+)?)\s*(?:{STATS_ALT})\b"
    # "damage up", "tears down"
    rf"|\b(?:{STATS_ALT})\s+(?:up|down)\b"
    # "increases his speed to 1.5", "gains +0.5 Speed"
    rf"|\b(?:increase|decrease|reduce|gain|raise|lower)\w*\s+"
    rf"(?:his\s+|isaac's\s+)?(?:{STATS_ALT})\b",
    re.I,
)


def conditional_effects(lines: list[dict]) -> list[str]:
    """Effect lines that change a stat only under some condition.

    These deliberately produce no flat modifier -- applying Mega Mush's 4x
    damage permanently would be wrong -- but they're surfaced in the UI so
    the omission is visible rather than silent.
    """
    out = []
    # A sub-bullet inherits its parent's condition: Mega Mush reads
    #   * Upon use, gigantifies Isaac ... While gigantic, Isaac gains:
    #   ** A 4x damage multiplier, +2 range, and -1.9 tears.
    # where the numbers and the condition sit on different lines.
    conditional_at_depth: dict[int, bool] = {}
    for item in lines:
        s, depth = item["text"], item["depth"]
        # Drop stale deeper scopes once we come back up a level.
        for d in [d for d in conditional_at_depth if d > depth]:
            del conditional_at_depth[d]
        conditional_at_depth[depth] = bool(CONDITION_RE.search(s))

        inherited = any(
            flag for d, flag in conditional_at_depth.items() if d <= depth
        )
        if inherited and STAT_CHANGE_RE.search(s):
            out.append(s)
    return out


# How an item behaves when you hold more than one copy.
#
# Duplicates are reachable in normal play (Diplopia, Crooked Penny, Damocles,
# Glitched Crown), so this is not a theoretical concern -- and summing a
# non-stacking multiplier is badly wrong: three Immaculate Hearts would read
# as x1.728 damage instead of x1.2.
#
# "none"       -> additional copies contribute nothing
# "diminished" -> additional copies contribute REPEAT_MODS[name] instead
# "full"       -> additional copies contribute the same mods again (default)
NO_STACK_RE = re.compile(
    r"(do(es)?n'?t stack with (additional|multiple)"
    r"|does not stack with (additional|multiple)"
    r"|no further (decrease|increase))",
    re.I,
)

# What each copy beyond the first actually grants. Channels left out
# contribute nothing on repeat pickups.
#
# Odd Mushroom (Thin): "+1.7 fire rate. ** Additional copies only grant +0.7
# fire rate." The speed and damage changes do not repeat.
REPEAT_MODS = {
    "Odd Mushroom (Thin)": {"fireRateAdd": 0.7},
}


def stacking_for(name: str, lines: list[dict]) -> tuple[str, dict]:
    """Decide an item's duplicate-stacking rule and its per-copy mods."""
    if name in REPEAT_MODS:
        REPEAT_USED.add(name)
        return "diminished", dict(REPEAT_MODS[name])
    for item in lines:
        if NO_STACK_RE.search(item["text"]):
            return "none", {}
    return "full", {}


def repeat_mods_for(rule: str, mods: dict, repeat: dict) -> dict:
    """The mods each copy beyond the first contributes."""
    zero = {k: ([] if isinstance(v, list) else 0.0) for k, v in mods.items()}
    if rule == "full":
        return dict(mods)
    if rule == "none":
        return zero
    out = zero
    for key, val in repeat.items():
        if key not in out:
            raise ValueError(f"repeat mods set unknown channel {key!r}")
        out[key] = list(val) if isinstance(val, list) else val
    return out


REPEAT_USED: set[str] = set()


VARIANTS_PATH = ROOT / "data" / "variants.json"


def load_variants() -> tuple[dict, dict]:
    if not VARIANTS_PATH.exists():
        return {}, {}
    raw = json.loads(io.open(VARIANTS_PATH, encoding="utf-8").read())
    return raw.get("variants", {}), raw.get("scaled", {})


VARIANTS, SCALED = load_variants()
VARIANTS_USED: set[str] = set()
SCALED_USED: set[str] = set()


def zero_mods(mods: dict) -> dict:
    return {k: ([] if isinstance(v, list) else 0.0) for k, v in mods.items()}


def fill_mods(template: dict, spec: dict, label: str) -> dict:
    """Expand a sparse {channel: value} spec into a full mods object."""
    out = zero_mods(template)
    for key, val in spec.items():
        if key not in out:
            raise ValueError(f"{label}: unknown channel {key!r}")
        out[key] = list(val) if isinstance(val, list) else val
    return out


def variants_for(name: str, mods: dict) -> list[dict]:
    entry = VARIANTS.get(name)
    if not entry:
        return []
    VARIANTS_USED.add(name)
    return [
        {"label": o["label"],
         "mods": fill_mods(mods, o.get("mods", {}), f"variant {name}")}
        for o in entry["options"]
    ]


def scaled_for(name: str, mods: dict) -> dict | None:
    entry = SCALED.get(name)
    if not entry:
        return None
    SCALED_USED.add(name)
    return {
        "quantity": entry["quantity"],
        "per": fill_mods(mods, entry.get("per", {}), f"scaled {name}"),
        "max": entry.get("max"),
        "source": entry.get("source", ""),
    }


def note_dps(name: str) -> str | None:
    note = DPS_UNRELIABLE.get(name)
    if note:
        DPS_NOTE_USED.add(name)
    return note


def has_any_mod(mods: dict) -> bool:
    return any(
        (v != 0) if isinstance(v, (int, float)) else bool(v)
        for v in mods.values()
    )


# ------------------------------------------------------------------- parsing


def parse_number_pair(raw: str) -> tuple[float | None, float | None]:
    """'3.5 (*1.05)' -> (3.5, 1.05).  '1.0' -> (1.0, None)."""
    txt = clean(resolve_dlcalt(raw))
    base = re.search(r"(\d+(?:\.\d+)?)", txt)
    mult = re.search(r"[*x\u00d7]\s*(\d+(?:\.\d+)?)", txt)
    return (
        float(base.group(1)) if base else None,
        float(mult.group(1)) if mult else None,
    )


# Innate fire rate multipliers the character infoboxes omit.
#
# The infobox carries this for Azazel, Tainted Azazel and both Forgottens
# (appended to the tears field as "x0.267" / "x1/2") but not for Tainted Eve.
# Source: wiki "Tear delay" page, Characters section.
CHARACTER_FIRE_RATE_MULT = {
    "Tainted Eve": 0.66,
}

# Characters whose innate multiplier is conditional, where a single number
# would misrepresent them. Surfaced in the UI instead of silently applied.
CONDITIONAL_FIRE_RATE = {
    "Tainted Samson": "x0.5 fire rate, then +2, while berserking",
    "Tainted Bethany": "x0.75 on fire rate gained above base",
}


def parse_fire_rate_mult(raw):
    """Pull an innate fire rate multiplier out of a tears field.

    The wiki appends it to the tears value: "+0.5; x0.267", "+0; x1/3".
    Fractions appear as often as decimals.
    """
    txt = clean(resolve_dlcalt(raw))
    m = re.search(r"[x\u00d7]\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)", txt)
    if m and float(m.group(2)):
        return float(m.group(1)) / float(m.group(2))
    m = re.search(r"[x\u00d7]\s*(\d+(?:\.\d+)?)", txt)
    return float(m.group(1)) if m else None


# Projectiles fired per volley.
#
# Curated rather than parsed: the counts live in prose ("Isaac shoots three
# tears at once"), and getting this wrong flips DPS the wrong way, so each
# entry is read off the item's own page.
#
# Only clean multi-shot belongs here -- items that fire N full-strength
# projectiles simultaneously. Split-on-impact effects (The Parasite,
# Cricket's Body, Haemolacria) produce weaker tears conditional on hitting
# something, so they are not a flat multiplier and are excluded.
#
# Monstro's Lung is excluded too: its 14 tears come per *charged* shot, a
# different mechanic, and it already carries a dpsNote.
SHOT_MULTIPLIER = {
    "20/20": 2,            # "Isaac fires two tears at once, one from each eye"
    "The Inner Eye": 3,    # "Isaac shoots three tears at once"
    "Mutant Spider": 4,    # "Isaac shoots four tears at once"
    "The Wiz": 2,          # fires 2 tears, in both diagonal directions
}

# Innate multi-shot, from the characters' collectibles field.
CHARACTER_SHOTS = {
    "Keeper": 3,           # "Triple shot"
    "Tainted Keeper": 4,   # "Quadruple shot"
}


STAT_FIELDS = (
    ("tears", "tears"), ("speed", "speed"), ("range", "range"),
    ("shot speed", "shotSpeed"), ("luck", "luck"),
)

SPREAD_RE = re.compile("[±－÷]|\bto\b")


def parse_form(box, suffix):
    """Read one character form's base stats.

    `suffix` is "" for the primary form or " 2" for the second form of a dual
    character (Jacob/Esau, Forgotten/Soul, Tainted Lazarus' revived state).
    Fields absent from the infobox take the Repentance+ default.
    """
    dmg, mult = parse_number_pair(box.get("damage" + suffix, ""))
    base = dict(DEFAULT_BASE)
    if dmg is not None:
        base["damage"] = dmg
    if mult is not None:
        base["damageMultiplier"] = mult

    for field, key in STAT_FIELDS:
        raw = box.get(field + suffix)
        if raw is None:
            continue
        txt = clean(resolve_dlcalt(raw))
        m = re.search(r"([+\-−]?\s*\d+(?:\.\d+)?)", txt)
        if m:
            base[key] = num(m.group(1))

    # "tears = +0.5; x0.267" also carries an innate fire rate multiplier.
    tears_raw = box.get("tears" + suffix)
    if tears_raw:
        mult = parse_fire_rate_mult(tears_raw)
        if mult is not None:
            base["fireRateMultiplier"] = mult

    # Eden-style "3.5 +/- 1.0" / "+0.75 to -0.515" cannot be one number.
    spread = "".join(
        clean(box.get(f + suffix, ""))
        for f in ("damage", "tears", "luck", "shot speed", "speed", "range")
    )
    return {
        "base": base,
        "health": clean(box.get("health" + suffix, "")),
        "variableStats": bool(SPREAD_RE.search(spread)),
    }


def parse_character(title, text):
    # Dual characters use the plural infobox; check it first because
    # "{{infobox character" is a prefix of "{{infobox characters".
    box = infobox(text, "characters") or infobox(text, "character")
    if not box:
        # Never fall through to defaults here: a silently-defaulted character
        # looks plausible and is entirely wrong.
        raise ValueError(f"no character infobox found on page {title!r}")

    page_name = display_name(title)
    primary = parse_form(box, "")
    forms = [dict(name=clean(box.get("name", "")) or page_name, **primary)]
    if box.get("name 2"):
        forms.append(dict(name=clean(box["name 2"]), **parse_form(box, " 2")))

    # Fill in innate fire rate multipliers the infoboxes omit.
    for form in forms:
        for key in (page_name, form["name"]):
            if key in CHARACTER_FIRE_RATE_MULT:
                form["base"]["fireRateMultiplier"] = CHARACTER_FIRE_RATE_MULT[key]
                CHARACTER_MULT_USED.add(key)
                break

    # Innate multi-shot (Keeper's triple, Tainted Keeper's quadruple).
    for form in forms:
        for key in (page_name, form["name"]):
            if key in CHARACTER_SHOTS:
                form["base"]["shotsPerVolley"] = CHARACTER_SHOTS[key]
                CHARACTER_SHOTS_USED.add(key)
                break

    return {
        "id": int(box["id"]) if box.get("id", "").strip().isdigit() else None,
        "name": page_name,
        "page": title,
        "sprite": sprite_for("characters", title),
        # Primary form promoted for convenience; forms[] is the full truth.
        "base": forms[0]["base"],
        "health": forms[0]["health"],
        "forms": forms,
        "dual": len(forms) > 1,
        "startingItems": [
            c for c in (
                clean(s)
                for s in re.split(r"<br\s*/?>|,", box.get("collectibles", ""))
            ) if c
        ],
        "pickups": clean(box.get("pickups", "")),
        "variableStats": any(f["variableStats"] for f in forms),
        "conditionalFireRate": CONDITIONAL_FIRE_RATE.get(page_name),
        "tainted": page_name.startswith("Tainted"),
        "dlc": clean(box.get("dlc", "")) or None,
    }


# Items that replace Isaac's tears outright. Detected from the Effects text
# rather than curated, since the phrasing is consistent.
REPLACES_TEARS_RE = re.compile(
    r"\b(isaac's )?tears\b[^.]{0,40}\breplaced\b|\breplaces\b[^.]{0,20}\btears\b",
    re.I,
)

# Items where damage x fire rate does NOT describe real damage output, with
# the reason shown to the user.
#
# Not every tear-replacement item lands here: 8 Inch Nails, Death's Touch and
# Terra swap the projectile's appearance and behaviour but still fire one
# discrete shot per tear, so DPS remains roughly meaningful for them. These
# are the ones where the arithmetic is actively misleading.
DPS_UNRELIABLE = {
    "Brimstone": "continuous laser that ticks ~15x/second while held",
    "Technology": "continuous piercing laser, not discrete shots",
    "Technology 2": "continuous low-damage laser on one eye",
    "Tech X": "ring lasers deal damage over time, scaled by charge",
    "Mom's Knife": "contact damage ~20x/second, scaled by charge",
    "Dr. Fetus": "bomb damage uses its own formula, not tear damage",
    "Epic Fetus": "missile damage uses its own formula",
    "Ipecac": "explosion damage, not tear contact damage",
    "C Section": "fetuses deal contact damage",
    "Monstro's Lung": "fires a burst of 14 tears per charged shot",
    "Trisagion": "beams can hit the same enemy repeatedly",
    "Haemolacria": "tears burst into a spread on impact",
    "Azazel": "short-range Brimstone laser, ticks rather than shoots",
}


DISAMBIG_RE = re.compile(r"\s*\((?:Item|Trinket|Character|Pill|Card)\)$", re.I)


def display_name(name: str) -> str:
    """Drop the wiki's disambiguation suffix: 'Cancer (Trinket)' -> 'Cancer'."""
    return DISAMBIG_RE.sub("", name).strip()


def parse_item(title: str, text: str, kind: str) -> dict | None:
    box = infobox(text, "passive collectible") or \
          infobox(text, "activated collectible") or \
          infobox(text, "trinket")
    if not box:
        return None

    is_active = bool(infobox(text, "activated collectible")) or "recharge" in box
    effect_lines = bullets(section(text, "Effects", "Effect"))
    mods, unmatched = extract_mods(effect_lines)
    item_name = display_name(clean(box.get("name", "")) or title)
    if item_name in SHOT_MULTIPLIER:
        mods["shotMultipliers"].append(SHOT_MULTIPLIER[item_name])
        SHOT_MULT_USED.add(item_name)
    mods, override_reason = apply_override(item_name, mods)
    stack_rule, repeat_spec = stacking_for(item_name, effect_lines)
    repeat = repeat_mods_for(stack_rule, mods, repeat_spec)

    quality = box.get("quality", "").strip()
    return {
        "id": int(box["id"]) if box.get("id", "").strip().isdigit() else None,
        "name": item_name,
        "page": title,
        "sprite": sprite_for(kind, title),
        "kind": "trinket" if kind == "trinkets" else ("active" if is_active else "passive"),
        "quote": clean(box.get("quote", "")),
        "description": clean(box.get("description", "")),
        "quality": int(quality) if quality.isdigit() else None,
        "tags": [
            t for t in re.split(r"\s+", clean(box.get("tags", ""))) if t
        ],
        "recharge": clean(box.get("recharge", "")) or None,
        "pools": [
            c for c in (
                clean(s) for s in re.split(r"<br\s*/?>|,", box.get("pool", ""))
            ) if c
        ],
        "devilPrice": clean(box.get("devil price", "")) or None,
        "shopPrice": clean(box.get("shop price", "")) or None,
        "effects": [b["text"] for b in effect_lines],
        "synergies": [
            {"group": b["group"], "text": b["text"]}
            for b in grouped_bullets(section(text, "Synergies"))
        ],
        "interactions": [
            {"group": b["group"], "text": b["text"]}
            for b in grouped_bullets(section(text, "Interactions"))
        ],
        "mods": mods,
        "replacesTears": bool(
            REPLACES_TEARS_RE.search(
                " ".join([clean(box.get("description", ""))]
                         + [b["text"] for b in effect_lines[:4]])
            )
        ),
        "dpsNote": note_dps(item_name),
        "stacking": stack_rule,
        "repeatMods": repeat,
        "variants": variants_for(item_name, mods),
        "scaled": scaled_for(item_name, mods),
        "conditionalEffects": conditional_effects(effect_lines),
        "hasStats": has_any_mod(mods),
        "needsReview": unmatched,
        "overrideReason": override_reason,
    }


# ---------------------------------------------------------------------- main


def load_group(group: str) -> dict[str, str]:
    idx = json.loads(io.open(RAW / group / "_index.json", encoding="utf-8").read())
    out = {}
    for title, fname in idx.items():
        if title in NON_ITEM_PAGES:
            continue
        out[title] = io.open(RAW / group / fname, encoding="utf-8").read()
    return out


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    print(f"  wrote {path.relative_to(ROOT)}")


def main() -> int:
    print("characters:")
    chars = [parse_character(t, x) for t, x in sorted(load_group("characters").items())]
    chars.sort(key=lambda c: (c["tainted"], c["id"] if c["id"] is not None else 999))
    write_json(OUT_TS / "characters.json", chars)
    print(f"  {len(chars)} characters, "
          f"{sum(1 for c in chars if c['variableStats'])} with variable stats")

    all_review: list[tuple[str, list[str]]] = []
    for group, out_name in (("collectibles", "items.json"), ("trinkets", "trinkets.json")):
        print(f"{group}:")
        parsed = []
        skipped = []
        for title, text in sorted(load_group(group).items()):
            rec = parse_item(title, text, group)
            if rec is None:
                skipped.append(title)
                continue
            if rec["needsReview"]:
                all_review.append((rec["name"], rec["needsReview"]))
            parsed.append(rec)
        parsed.sort(key=lambda r: r["id"] if r["id"] is not None else 99999)
        write_json(OUT_TS / out_name, parsed)
        with_stats = sum(1 for r in parsed if r["hasStats"])
        print(f"  {len(parsed)} parsed, {with_stats} with stat mods, "
              f"{len(parsed) - with_stats} without")
        if skipped:
            print(f"  ! no infobox ({len(skipped)}): {skipped[:8]}")

    lines = [
        "# Stat lines needing review",
        "",
        "Numeric effect bullets the extractor did not recognise. Each is a",
        "potential missing stat modifier. Filtered to Repentance+ already.",
        "",
        f"Total: {sum(len(v) for _, v in all_review)} lines "
        f"across {len(all_review)} items.",
        "",
    ]
    for name, items in sorted(all_review):
        lines.append(f"## {name}")
        lines += [f"- {x}" for x in items]
        lines.append("")
    with io.open(REVIEW, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    print(f"  wrote {REVIEW.relative_to(ROOT)} "
          f"({sum(len(v) for _, v in all_review)} lines to review)")

    if MISSING_SPRITES:
        print(f"! no sprite for {len(MISSING_SPRITES)} entries: "
              f"{MISSING_SPRITES[:8]}")
    # "Azazel" is a character, not an item; it is listed so the UI can warn on
    # his innate Brimstone. Exclude it from the item-name check.
    unused_dps = sorted(set(DPS_UNRELIABLE) - DPS_NOTE_USED - {"Azazel"})
    if unused_dps:
        print(f"! dps notes matched no item (typo or rename?): {unused_dps}")
    for label, table, used in (
        ("variant", VARIANTS, VARIANTS_USED),
        ("scaled", SCALED, SCALED_USED),
    ):
        missing = sorted(set(table) - used)
        if missing:
            print(f"! {label} rules matched no item: {missing}")
    unused_repeat = sorted(set(REPEAT_MODS) - REPEAT_USED)
    if unused_repeat:
        print(f"! repeat-mod rules matched no item: {unused_repeat}")
    unused_shots = sorted(set(SHOT_MULTIPLIER) - SHOT_MULT_USED)
    if unused_shots:
        print(f"! shot multipliers matched no item: {unused_shots}")
    unused_cs = sorted(set(CHARACTER_SHOTS) - CHARACTER_SHOTS_USED)
    if unused_cs:
        print(f"! character shot counts matched nobody: {unused_cs}")
    unused_chars = sorted(set(CHARACTER_FIRE_RATE_MULT) - CHARACTER_MULT_USED)
    if unused_chars:
        print(f"! character fire-rate overrides matched nobody: {unused_chars}")
    unused = sorted(set(OVERRIDES) - OVERRIDES_USED)
    if unused:
        print(f"! overrides that matched no item (typo or rename?): {unused}")
    if UNKNOWN_DLC:
        print(f"! unknown dlc codes encountered: {sorted(UNKNOWN_DLC)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
