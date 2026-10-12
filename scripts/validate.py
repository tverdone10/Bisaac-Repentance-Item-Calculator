"""Cross-check parsed character stats against independent wiki sources.

The parser reads each character's own infobox. The wiki *also* documents
speed and luck in dedicated tables on the Speed and Luck mechanics pages,
maintained separately. Comparing the two catches both parser bugs and
genuine wiki self-inconsistency -- neither of which a spot-check of the same
infobox the parser already read would find.

Exit code is non-zero if any mismatch is found, so this can gate the build.

Usage:
    python scripts/validate.py
"""

from __future__ import annotations

import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CHARS = ROOT / "src" / "data" / "characters.json"

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Names the mechanics tables use that we don't model as their own entry.
# Alternate forms triggered by items (rather than being part of the
# character's own stat line) are out of scope for now.
SKIP = {
    "Black Judas",            # Judas' Dark Arts / Birthright form
    "Lazarus Risen",
    "Tainted Lazarus Risen",
    "Dead Tainted Lazarus",   # revived form, item-dependent
}


def load_chars() -> dict[str, dict]:
    """name -> record, keyed by both roster name and each form's name.

    Dual characters appear in the mechanics tables under their form names
    ("Jacob", "Esau") rather than the roster name ("Jacob and Esau"), so
    both spellings resolve -- and each form is checked against its own stats.
    """
    records = json.loads(io.open(CHARS, encoding="utf-8").read())
    out: dict[str, dict] = {}
    for rec in records:
        for i, form in enumerate(rec["forms"]):
            entry = {
                "base": form["base"],
                "variableStats": form["variableStats"],
                "label": f"{rec['name']}[{form['name']}]" if rec["dual"] else rec["name"],
            }
            # Form name wins for duals; the roster name maps to form 0.
            out.setdefault(form["name"], entry)
            if i == 0:
                out[rec["name"]] = entry
    return out


def parse_stat_table(page: str, stat_name: str) -> dict[str, float]:
    """Read a 'value -> characters' wikitable off a mechanics page.

    Rows look like:
        | {{C|Isaac}} {{C|Judas}} {{Dlc|r}}{{C|Keeper}}
        | 1.0
    """
    text = io.open(RAW / "mechanics" / f"{page}.wiki", encoding="utf-8").read()
    out: dict[str, float] = {}

    for table in re.findall(r"\{\|.*?\|\}", text, re.S):
        # Split into rows on |- separators
        for row in re.split(r"^\s*\|-\s*$", table, flags=re.M):
            cells = re.split(r"^\s*\|\s", row, flags=re.M)[1:]
            if len(cells) < 2:
                continue
            names = re.findall(r"\{\{[Cc]\|([^}|]+)\}\}", cells[0])
            if not names:
                continue
            value_m = re.search(r"(-?\d+(?:\.\d+)?)", cells[1])
            if not value_m:
                continue
            value = float(value_m.group(1))
            for n in names:
                out[n.strip()] = value

    if not out:
        print(f"  ! no {stat_name} table rows parsed from {page}")
    return out


def check(stat_key: str, table: dict[str, float], chars: dict[str, dict]) -> list[str]:
    problems = []
    for name, expected in sorted(table.items()):
        if name in SKIP:
            continue
        rec = chars.get(name)
        if rec is None:
            problems.append(f"{stat_key}: table lists {name!r}, not in our roster")
            continue
        if rec["variableStats"]:
            continue  # Eden-style ranges can't match a single number
        actual = rec["base"][stat_key]
        if abs(actual - expected) > 1e-6:
            problems.append(
                f"{stat_key}: {rec['label']} -> infobox {actual}, "
                f"mechanics table {expected}"
            )
    return problems


def parse_tear_delay_page() -> tuple[dict[str, float], dict[str, float]]:
    """Read the Tear delay page's Characters section.

    An independent third source: it documents starting tears AND innate fire
    rate multipliers in prose, e.g.

        * {{C|Azazel}}: +0.5 tears, x0.267 fire rate
        * {{C|Tainted Azazel}}: x1/3 fire rate
        * {{C|The Forgotten}} / {{C|Tainted Forgotten}}: x0.5 fire rate

    Returns (tears, fireRateMultiplier) keyed by character name.
    """
    text = io.open(RAW / "mechanics" / "Tear delay.wiki", encoding="utf-8").read()
    m = re.search(r"^==\s*Characters\s*==\s*$(.*?)(?=^==[^=]|\Z)", text, re.M | re.S)
    if not m:
        print("  ! Tear delay Characters section not found")
        return {}, {}

    tears: dict[str, float] = {}
    mults: dict[str, float] = {}

    for line in m.group(1).splitlines():
        if not line.strip().startswith("*"):
            continue
        names = re.findall(r"\{\{[Cc]\|([^}|]+)\}\}", line)
        if not names:
            continue
        # Only take the part after the colon, so "+0 tears" style values
        # aren't picked up from surrounding prose.
        body = line.split(":", 1)[1] if ":" in line else ""

        # The catch-all sentence listing every default character.
        if "start with the base" in line:
            for n in names:
                tears.setdefault(n.strip(), 0.0)
                mults.setdefault(n.strip(), 1.0)
            continue

        t_m = re.search(r"([+-]?\d+(?:\.\d+)?)\s*tears", body)
        f_frac = re.search(r"x\s*(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)\s*fire rate", body)
        f_dec = re.search(r"x\s*(\d+(?:\.\d+)?)\s*fire rate", body)

        for raw in names:
            n = raw.strip()
            if t_m:
                tears.setdefault(n, float(t_m.group(1)))
            if f_frac and float(f_frac.group(2)):
                mults.setdefault(n, float(f_frac.group(1)) / float(f_frac.group(2)))
            elif f_dec:
                mults.setdefault(n, float(f_dec.group(1)))

    return tears, mults


def main() -> int:
    chars = load_chars()
    print(f"loaded {len(chars)} characters")

    all_problems: list[str] = []

    speed = parse_stat_table("Speed", "speed")
    print(f"Speed page: {len(speed)} character entries")
    all_problems += check("speed", speed, chars)

    luck = parse_stat_table("Luck", "luck")
    print(f"Luck page: {len(luck)} character entries")
    all_problems += check("luck", luck, chars)

    # Shot speed is documented in prose, not a table:
    # "All characters start with the same shot speed except for Samson, who
    #  has 1.31 shot speed, Jacob, who has 1.15 ..."
    ss_text = io.open(RAW / "mechanics" / "Shot Speed.wiki", encoding="utf-8").read()
    ss_claims = dict(
        (m.group(1).strip(), float(m.group(2)))
        for m in re.finditer(
            r"\{\{[Cc]\|([^}|]+)\}\}[^.]{0,40}?has\s+(\d+(?:\.\d+)?)\s+shot speed",
            ss_text,
        )
    )
    print(f"Shot Speed page: {len(ss_claims)} prose claims {ss_claims}")
    all_problems += check("shotSpeed", ss_claims, chars)

    td_tears, td_mults = parse_tear_delay_page()
    print(f"Tear delay page: {len(td_tears)} tears entries, "
          f"{len(td_mults)} fire rate multipliers")
    all_problems += check("tears", td_tears, chars)
    all_problems += check("fireRateMultiplier", td_mults, chars)

    # Every character NOT named by a stat page should sit at the default.
    # This is the half that catches silent parser drift: a wrong value the
    # stat pages never mention would otherwise go unnoticed.
    DEFAULTS = {"speed": 1.0, "luck": 0.0, "shotSpeed": 1.0}
    named = {"speed": set(speed), "luck": set(luck), "shotSpeed": set(ss_claims)}

    # One record is reachable under several keys (roster name + form names).
    # Group by label so an entry named under any alias counts as covered.
    by_label: dict[str, dict] = {}
    aliases: dict[str, set[str]] = {}
    for key, rec in chars.items():
        by_label[rec["label"]] = rec
        aliases.setdefault(rec["label"], set()).add(key)

    for stat, default in DEFAULTS.items():
        for label, rec in sorted(by_label.items()):
            keys = aliases[label]
            if keys & named[stat] or keys & SKIP or rec["variableStats"]:
                continue
            actual = rec["base"][stat]
            if abs(actual - default) > 1e-6:
                all_problems.append(
                    f"{stat}: {label} -> infobox {actual}, but no stat "
                    f"page lists it as an exception "
                    f"(expected default {default})"
                )

    print()
    if all_problems:
        print(f"{len(all_problems)} discrepancy/ies:")
        for p in all_problems:
            print(f"  - {p}")
        return 1
    print("all cross-checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
