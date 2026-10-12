"""Build a local cache of raw wikitext from the Binding of Isaac: Rebirth wiki.

Fetches every page in the collectible/trinket/character categories via the
MediaWiki API and writes the raw wikitext to data/raw/<category>/<title>.wiki.

This is deliberately a dumb cache: no parsing happens here. Parsing is a
separate, re-runnable step (parse_items.py) so that fixing a parser bug never
means re-hammering the wiki.

Usage:
    python scripts/fetch_wiki.py            # fetch anything not already cached
    python scripts/fetch_wiki.py --force    # refetch everything
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://bindingofisaacrebirth.wiki.gg/api.php"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

USER_AGENT = "bisaac-calc/0.1 (local stat calculator; contact via repo)"

# Categories to mirror. Key becomes the subdirectory under data/raw/.
CATEGORIES = {
    "collectibles": "Category:Collectibles",
    "trinkets": "Category:Trinkets",
}

# Pages that aren't in a tidy category but we need anyway.
EXTRA_PAGES = {
    "characters": [
        # "???" alone is a disambiguation page; the character lives at
        # "??? (Character)". Same shape for the tainted version.
        "Isaac", "Magdalene", "Cain", "Judas", "??? (Character)", "Eve", "Samson",
        "Azazel", "Lazarus", "Eden", "The Lost", "Lilith", "Keeper",
        "Apollyon", "The Forgotten", "Bethany", "Jacob and Esau",
        "Tainted Isaac", "Tainted Magdalene", "Tainted Cain", "Tainted Judas",
        "Tainted ???", "Tainted Eve", "Tainted Samson", "Tainted Azazel",
        "Tainted Lazarus", "Tainted Eden", "Tainted Lost", "Tainted Lilith",
        "Tainted Keeper", "Tainted Apollyon", "Tainted Forgotten",
        "Tainted Bethany", "Tainted Jacob",
    ],
    # One page per item pool, listing its contents as {{pool items|...}}.
    # The per-item infobox only names a pool for 45 of 720 items, so these
    # pages are the real source.
    "pools": [
        f"{name} (Item Pool)" for name in [
            "Treasure Room", "Shop", "Boss", "Devil Room", "Angel Room",
            "Secret Room", "Ultra Secret Room", "Library", "Curse Room",
            "Golden Chest", "Red Chest", "Wooden Chest", "Old Chest",
            "Mom's Chest", "Planetarium", "Baby Shop", "Crane Game",
            "Shell Game", "Beggar", "Devil Beggar", "Battery Bum",
            "Bomb Bum", "Rotten Beggar", "Key Master",
        ]
    ] + [
        f"{name} (Greed Mode Item Pool)" for name in [
            "Treasure Room", "Shop", "Boss", "Devil Room", "Angel Room",
            "Secret Room", "Library", "Curse Room", "Golden Chest",
        ]
    ],
    "mechanics": [
        "Attributes", "Damage", "Tears", "Speed", "Range", "Shot Speed",
        "Luck", "Tear delay", "Transformations", "Items", "Trinkets",
        "Cards and Runes", "Pills",
    ],
}

RETRIES = 4


def get(params: dict) -> dict:
    """Call the API with retries. Returns parsed JSON."""
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - network flake, just retry
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"API call failed after {RETRIES} tries: {url}") from last


def category_members(category: str) -> list[str]:
    """All mainspace page titles in a category, following continuation."""
    titles: list[str] = []
    cont: dict = {}
    while True:
        data = get({
            "action": "query",
            "list": "categorymembers",
            "cmtitle": category,
            "cmlimit": "500",
            "cmnamespace": "0",
            **cont,
        })
        titles += [m["title"] for m in data["query"]["categorymembers"]]
        if "continue" not in data:
            return titles
        cont = data["continue"]


def fetch_wikitext(titles: list[str]) -> dict[str, str]:
    """Fetch raw wikitext for many titles, 50 per request (API limit)."""
    out: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        data = get({
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "titles": "|".join(chunk),
        })
        for page in data.get("query", {}).get("pages", []):
            if "missing" in page or page.get("missing"):
                print(f"  ! missing: {page['title']}", file=sys.stderr)
                continue
            revs = page.get("revisions")
            if not revs:
                print(f"  ! no revision: {page['title']}", file=sys.stderr)
                continue
            out[page["title"]] = revs[0]["slots"]["main"]["content"]
        print(f"  fetched {min(i + 50, len(titles))}/{len(titles)}")
        time.sleep(0.3)
    return out


def safe_name(title: str) -> str:
    """Filesystem-safe filename for a page title (Windows-safe)."""
    name = re.sub(r'[<>:"/\\|?*]', "_", title).strip().rstrip(".")
    return (name or "_untitled") + ".wiki"


def resolve_redirects(pages: dict[str, str], depth: int = 2) -> dict[str, str]:
    """Follow #REDIRECT pages so e.g. 'Sad Onion' lands on 'The Sad Onion'."""
    for _ in range(depth):
        targets: dict[str, str] = {}
        for title, text in pages.items():
            m = re.match(r"\s*#REDIRECT\s*\[\[([^\]|#]+)", text, re.I)
            if m:
                targets[title] = m.group(1).strip()
        if not targets:
            break
        print(f"  resolving {len(targets)} redirects")
        fetched = fetch_wikitext(sorted(set(targets.values())))
        for title, target in targets.items():
            if target in fetched:
                pages[title] = fetched[target]
    return pages


def write_group(group: str, pages: dict[str, str]) -> None:
    outdir = RAW / group
    outdir.mkdir(parents=True, exist_ok=True)
    for title, text in pages.items():
        path = outdir / safe_name(title)
        with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    index = {t: safe_name(t) for t in sorted(pages)}
    with io.open(outdir / "_index.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
    print(f"  wrote {len(pages)} pages -> {outdir}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="refetch groups that are already cached")
    args = ap.parse_args()

    for group, category in CATEGORIES.items():
        outdir = RAW / group
        if outdir.exists() and not args.force:
            print(f"{group}: cached, skipping (--force to refetch)")
            continue
        print(f"{group}: enumerating {category}")
        titles = category_members(category)
        print(f"{group}: {len(titles)} pages")
        pages = resolve_redirects(fetch_wikitext(titles))
        write_group(group, pages)

    for group, titles in EXTRA_PAGES.items():
        outdir = RAW / group
        if outdir.exists() and not args.force:
            print(f"{group}: cached, skipping (--force to refetch)")
            continue
        print(f"{group}: {len(titles)} pages")
        pages = resolve_redirects(fetch_wikitext(titles))
        write_group(group, pages)

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
