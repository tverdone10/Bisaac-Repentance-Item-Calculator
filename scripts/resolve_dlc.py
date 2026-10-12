"""Work out which wiki {{dlc|...}} range codes apply to Repentance+.

The wiki marks version-specific content with codes like {{dlc|r}} or
{{dlc|nr+}}. The codes are composed version ranges, not flags, and some are
genuinely counterintuitive -- {{dlc|rnr+}} means "added in Repentance, removed
in Repentance+", i.e. it must NOT be used for current values.

Rather than hand-maintain that table, this renders every documented code via
the wiki's own template and reads the applicable version set out of the
rendered alt text ("(in Repentance and Repentance+)" /
"(except in Afterbirth)"). The result is cached to data/dlc_codes.json.

Usage:
    python scripts/resolve_dlc.py
"""

from __future__ import annotations

import io
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://bindingofisaacrebirth.wiki.gg/api.php"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "dlc_codes.json"
USER_AGENT = "bisaac-calc/0.1 (local stat calculator)"

TARGET = "Repentance+"

# Every value listed by Template:Dlc/doc.
CODES = [
    "a", "a+", "r", "r+", "na", "na+", "nr", "nr+", "ana+", "anr", "anr+",
    "a+nr", "a+nr+", "rnr+", "naa+", "nar", "nar+", "na+r", "na+r+", "nrr+",
    "ana+r", "ana+r+", "anrr+", "a+nrr+", "naa+nr", "naa+nr+", "narnr+",
    "na+rnr+", "ana+rnr+", "naa+nrr+",
]

ALL_VERSIONS = ["Rebirth", "Afterbirth", "Afterbirth +", "Repentance", "Repentance+"]


def render(wikitext: str) -> str:
    params = {
        "action": "parse",
        "text": wikitext,
        "contentmodel": "wikitext",
        "prop": "text",
        "format": "json",
        "formatversion": "2",
        "disablelimitreport": "1",
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))["parse"]["text"]


def split_versions(blob: str) -> list[str]:
    """'Rebirth and Afterbirth +' -> ['Rebirth', 'Afterbirth +']."""
    blob = blob.replace(" and ", ", ")
    parts = [p.strip() for p in blob.split(",")]
    return [p for p in parts if p]


def main() -> int:
    wikitext = "\n".join(
        f"* <code>{c}</code>: {{{{dlc|{c}}}}}" for c in CODES
    )
    html = render(wikitext)

    out: dict[str, dict] = {}
    for li in re.findall(r"<li>(.*?)</li>", html, re.S):
        code_m = re.search(r"<code>([^<]*)</code>", li)
        alt_m = re.search(r'alt="\(([^"]*)\)"', li)
        title_m = re.search(r'title="([^"]*)"', li)
        if not code_m or not alt_m:
            continue
        code = code_m.group(1)
        alt = alt_m.group(1)

        if alt.startswith("except in "):
            excluded = split_versions(alt[len("except in "):])
            applies = TARGET not in excluded
            versions = [v for v in ALL_VERSIONS if v not in excluded]
        elif alt.startswith("in "):
            included = split_versions(alt[len("in "):])
            applies = TARGET in included
            versions = included
        else:
            print(f"  ! unparsed alt for {code!r}: {alt!r}")
            continue

        out[code] = {
            "applies_to_target": applies,
            "versions": versions,
            "label": title_m.group(1) if title_m else "",
            "alt": alt,
        }

    missing = [c for c in CODES if c not in out]
    if missing:
        print(f"  ! unresolved codes: {missing}")

    payload = {"target": TARGET, "codes": out}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with io.open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)

    yes = sorted(c for c, v in out.items() if v["applies_to_target"])
    no = sorted(c for c, v in out.items() if not v["applies_to_target"])
    print(f"resolved {len(out)}/{len(CODES)} codes against {TARGET}")
    print(f"  applies     ({len(yes):2d}): {' '.join(yes)}")
    print(f"  not applies ({len(no):2d}): {' '.join(no)}")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
