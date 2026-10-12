"""Download item / trinket / character sprites from the Isaac wiki.

Resolves each entity name to a File: title using the wiki's naming
conventions (with fallbacks), then downloads the PNG into
public/sprites/<group>/. A manifest maps entity name -> local filename so the
app never has to guess a path at runtime.

Anything that can't be resolved is written to the manifest's "missing" list
rather than silently dropped, so gaps are visible instead of mysterious.

Usage:
    python scripts/fetch_sprites.py
    python scripts/fetch_sprites.py --force
"""

from __future__ import annotations

import argparse
import io
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://bindingofisaacrebirth.wiki.gg/api.php"
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "sprites"
USER_AGENT = "bisaac-calc/0.1 (local stat calculator)"

# Candidate File: title patterns per group, tried in order.
PATTERNS = {
    "collectibles": [
        "File:Collectible {n} icon.png",
        "File:Collectible {n}  icon.png",
        "File:Collectible{n} icon.png",
    ],
    "trinkets": [
        "File:Trinket {n} icon.png",
        "File:Collectible {n} icon.png",
    ],
    # Characters get two passes: a big portrait for the carousel, and the
    # small icon as a fallback / list view.
    "characters": [
        "File:Character {n} icon.png",
        "File:{n} App.png",
        "File:{n}.png",
    ],
}

NON_ITEM_PAGES = {
    "Collection Page",
    "Item Tags",
    "Unlocking Super Meat Boy & Super Bandage Girl",
    # Mechanic pages that sit in Category:Trinkets but aren't trinkets.
    "Golden Trinket",
}

# Items whose sprite title doesn't follow from the page title by rule alone.
SPRITE_OVERRIDES = {
    # Broken Shovel is two separate halves with no combined icon.
    "Broken Shovel": "File:Collectible Broken Shovel 1 icon.png",
}


def file_name_variants(group: str, name: str) -> list[str]:
    """Page title -> candidate File: titles.

    The wiki's file titles differ from page titles in a few consistent ways:
      * disambiguation suffixes are dropped       "Dogma (Item)"   -> "Dogma"
      * "???" is spelled out                      "???'s Soul"     -> "Blue Baby's Soul"
      * slashes become spaces                     "20/20"          -> "20 20"
      * trailing "?" is dropped                   "Wait What?"     -> "Wait What"
    """
    if name in SPRITE_OVERRIDES:
        return [SPRITE_OVERRIDES[name]]

    bases = {name}
    for base in list(bases):
        # "Dogma (Item)" / "Cancer (Trinket)" -> "Dogma" / "Cancer"
        if "(" in base:
            bases.add(base.split("(")[0].strip())
    for base in list(bases):
        if "???" in base:
            bases.add(base.replace("???", "Blue Baby"))
    for base in list(bases):
        if "/" in base:
            bases.add(base.replace("/", " "))
    for base in list(bases):
        if "?" in base:
            bases.add(base.replace("?", "").strip())

    out: list[str] = []
    for pattern in PATTERNS[group]:
        for base in bases:
            title = pattern.format(n=base)
            if title not in out:
                out.append(title)
    return out


def api(params: dict) -> dict:
    params = {**params, "format": "json", "formatversion": "2"}
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:  # noqa: BLE001 - retry network flake
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed: {url}")


def resolve(group: str, names: list[str]) -> tuple[dict[str, dict], list[str]]:
    """Map name -> {'file','url','width','height'}.

    Each name expands to several candidate File: titles; we query them in
    rounds (round 0 = every name's first candidate, round 1 = second, ...) so a
    name only falls through to a less-likely spelling if the better one misses.
    """
    found: dict[str, dict] = {}
    variants = {n: file_name_variants(group, n) for n in names}
    max_rounds = max((len(v) for v in variants.values()), default=0)

    for rnd in range(max_rounds):
        want: dict[str, str] = {}
        for name, cands in variants.items():
            if name in found or rnd >= len(cands):
                continue
            # first writer wins; a title shared by two names is vanishingly rare
            want.setdefault(cands[rnd], name)
        if not want:
            continue

        titles = list(want)
        for i in range(0, len(titles), 50):
            chunk = titles[i:i + 50]
            data = api({
                "action": "query",
                "titles": "|".join(chunk),
                "prop": "imageinfo",
                "iiprop": "url|size",
            })
            for page in data.get("query", {}).get("pages", []):
                info = page.get("imageinfo")
                if not info:
                    continue
                name = want.get(page["title"])
                if name and name not in found:
                    found[name] = {
                        "file": page["title"],
                        "url": info[0]["url"],
                        "width": info[0].get("width"),
                        "height": info[0].get("height"),
                    }
            time.sleep(0.2)
        pending = [n for n in names if n not in found]
        print(f"    round {rnd}: {len(found)} resolved, {len(pending)} left")
        if not pending:
            break

    return found, [n for n in names if n not in found]


def slug(name: str) -> str:
    out = "".join(c if c.isalnum() else "-" for c in name.lower())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "unnamed"


def download(group: str, resolved: dict[str, dict], force: bool) -> dict[str, str]:
    outdir = OUT / group
    outdir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}
    n = 0
    for name, info in sorted(resolved.items()):
        fname = f"{slug(name)}.png"
        path = outdir / fname
        manifest[name] = fname
        if path.exists() and not force:
            continue
        try:
            req = urllib.request.Request(info["url"], headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                path.write_bytes(r.read())
            n += 1
            if n % 100 == 0:
                print(f"    downloaded {n}")
            time.sleep(0.08)
        except Exception as exc:  # noqa: BLE001
            print(f"    ! download failed {name}: {exc}")
            manifest.pop(name, None)
    print(f"    downloaded {n} new file(s); {len(manifest)} total in manifest")
    return manifest


def names_for(group: str) -> list[str]:
    idx = RAW / group / "_index.json"
    names = sorted(json.loads(io.open(idx, encoding="utf-8").read()).keys())
    return [n for n in names if n not in NON_ITEM_PAGES]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", help="comma-separated groups")
    args = ap.parse_args()

    groups = args.only.split(",") if args.only else list(PATTERNS)
    OUT.mkdir(parents=True, exist_ok=True)

    # Merge into any existing manifest so --only doesn't drop other groups.
    path = OUT / "manifest.json"
    full: dict[str, dict] = {}
    if path.exists():
        try:
            full = json.loads(io.open(path, encoding="utf-8").read())
        except Exception:  # noqa: BLE001 - corrupt manifest, rebuild it
            full = {}

    for group in groups:
        print(f"{group}:")
        names = names_for(group)
        print(f"  {len(names)} names")
        resolved, missing = resolve(group, names)
        manifest = download(group, resolved, args.force)
        full[group] = {"sprites": manifest, "missing": missing}
        if missing:
            print(f"  ! unresolved ({len(missing)}): {missing[:12]}")

    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(full, fh, indent=2, ensure_ascii=False)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
