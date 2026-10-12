# Isaac Build Calculator

A stat calculator and build planner for *The Binding of Isaac: Repentance+*.

Nothing equivalent exists for Rebirth or its DLCs — Platinum God's
[damage calculator](https://www.tboi.com/calculator) is explicitly labelled
"Original Game" and covers only the seven flash-game characters. This covers
all 34 Repentance+ characters, all six stats, and the full item pool.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 89 tests
npm run validate   # cross-check stats against independent wiki pages
npm run build
```

The committed JSON in `src/data/` is all the app needs. Regenerating it from
the wiki is only necessary when the game or wiki changes:

```bash
npm run data       # fetch_wiki -> fetch_sprites -> parse_data
```

## How the data works

| Step | Script | Output |
|---|---|---|
| Mirror raw wikitext | `scripts/fetch_wiki.py` | `data/raw/**` |
| Resolve DLC version codes | `scripts/resolve_dlc.py` | `data/dlc_codes.json` |
| Download sprites | `scripts/fetch_sprites.py` | `public/sprites/**` |
| Parse to JSON | `scripts/parse_data.py` | `src/data/*.json` |
| Cross-validate | `scripts/validate.py` | exit code / report |

Everything comes from the
[Binding of Isaac wiki](https://bindingofisaacrebirth.wiki.gg)'s MediaWiki
API as raw wikitext. Caching and parsing are separate steps so fixing a
parser bug never means re-fetching ~950 pages.

### Why the pipeline is shaped this way

**No prose summarisation, ever.** Early on, an LLM-summarised fetch of the
character table produced confidently wrong numbers — ??? at ×2.00 damage
(actually ×1.05), 1.31 shot speed attributed to Azazel (actually Samson), and
a roster shifted by one row. Every number here is parsed from wikitext and
spot-checked against the source. For a calculator, a plausible wrong number
is worse than a visible gap.

**DLC codes are resolved, not assumed.** The wiki tags version-specific
content with codes like `{{dlc|r}}`. These are composed version *ranges*, and
some are counterintuitive: `{{dlc|rnr+}}` means "added in Repentance, removed
in Repentance+", so treating it like `r` would inject stale values.
`resolve_dlc.py` renders all 30 codes through the wiki's own template and
reads the applicable version set out of the output. 15 apply to Repentance+,
15 don't.

**Character stats are cross-validated, not spot-checked.** The parser reads
each character's own infobox, so checking against that same infobox proves
nothing. `validate.py` instead compares all 34 against the wiki's separately
maintained Speed, Luck, Shot Speed and Tear delay pages — 36 speed entries,
6 luck, 3 shot speed, 32 tears and 26 fire rate multipliers — and also
asserts the inverse: any character *not* listed as an exception must sit at
the default. This caught a real omission (see below).

**Variants are chosen, not summed.** Purity grants one of four colour
bonuses, Abyss scales by absorbed-item quality, Playdough Cookie rolls per
tear. Summing them would describe a state that never exists, so these carry a
`variants` list and the builder shows a picker.

**Scaled bonuses take an input.** Six items scale with a game quantity rather
than granting a fixed amount — Money = Power (+0.04 damage per coin, capped at
99), Brittle Bones (+0.4 fire rate per Bone Heart lost), False PHD, Bloody
Gust, Keeper's Sack. Each carries a `scaled` spec and the builder asks for the
driving number, defaulting to zero.

**Duplicates are disabled in the picker.** The wiki only documents duplicate
behaviour for three items, so rather than quietly summing copies the UI
prevents picking an item twice. The three sourced `stacking` rules remain in
the data for when an "allow duplicates" toggle is added. Note the trade-off:
duplicates are reachable in game via Diplopia, Crooked Penny, Damocles and
Glitched Crown, and those builds currently can't be modelled.

**A missing Repentance value usually means the effect was removed.** Ten
items (Sacred Heart, Godhead, Crown of Light, ...) carry only a
pre-Repentance range line, which looked like a data hole for a while. It
isn't: the tag on those lines is `{{dlc|nr}}`, which resolves to "Removed in
Repentance", so the wiki is asserting the bonus no longer exists. Purity
proves the convention by carrying both — `{{dlc|nr}} Orange: +7.5 range` and
`{{dlc|r}} Orange: +3.0 range`. Showing no range for the others is correct.

**Conditional lines can never become flat modifiers.** This is enforced in
the extractor, not left to the patterns. It used to be implicit — every
pattern required the line to begin with a number — and widening them to read
"Gives Isaac +2.0 luck" promptly broke it: False PHD's "Grants +0.6 damage
for each stat down pill" started applying one pill's worth as a constant.
A line matching the condition vocabulary is now refused outright and reported
through `conditionalEffects` instead.

**Gaps are visible.** The stat extractor only emits a modifier for bullet
shapes it actually recognises. Anything numeric it can't parse goes to
`data/review_stats.md` instead of being guessed at. Items whose numbers can't
be read from text at all (Polyphemus states damage only as a formula) get a
hand-verified entry in `data/overrides.json`, each with a `reason`. The parser
warns about overrides that stop matching an item, so a rename can't silently
disable one.

## Accuracy notes

Three classes of problem, handled differently.

**Innate character fire rate multipliers.** Several characters carry a large
one that the infobox hides inside the tears field: Azazel ×0.267, Tainted
Azazel ×1/3, both Forgottens ×0.5, Tainted Eve ×0.66. Missing these inflated
Azazel's fire rate and DPS by nearly 4×. Tainted Samson and Tainted Bethany
have *conditional* multipliers, which are surfaced in the UI rather than
applied.

**DPS is suppressed where it lies.** `damage x fireRate` doesn't describe a
continuous laser (Brimstone, Technology, Tech X), contact damage (Mom's
Knife, C Section), or explosions (Dr. Fetus, Ipecac). Those items carry a
`dpsNote`; when one is in the build the DPS row is struck through with the
reason. Damage and tears remain correct and are still shown. Items that swap
the projectile but still fire one discrete shot per tear (8 Inch Nails,
Death's Touch, Terra) keep a normal DPS.

**Conditional effects are listed, not applied.** Mega Mush's ×4 damage lasts
30 seconds; Sulfur is one room; Succubus and Star of Bethlehem only apply
inside an aura; Adrenaline scales with empty heart containers; Red Stew decays
over three minutes. Treating any of these as permanent modifiers would be
wrong, so 69 items record them in `conditionalEffects` and the UI says what
was left out.

## Current coverage

- **34/34 characters**, including dual forms (Jacob/Esau, Forgotten/Soul,
  Tainted Lazarus) parsed as separate stat sets
- **720 collectibles + 188 trinkets** with full metadata: name, id, quote,
  description, quality, tags, recharge, pools, prices, effects, synergies
- **941 sprites**, zero missing
- **146 collectibles + 14 trinkets** have modelled stat modifiers
- **69 items** carry conditional stat effects, listed but deliberately not applied
- **12 items** are marked as having a meaningless DPS figure

That last number is the honest limit. Most items genuinely don't touch the six
stats — they grant flight, familiars, or room effects — but roughly 630
unparsed numeric lines remain in `data/review_stats.md`, and some of those are
real modifiers still to be captured. Most are familiar damage, creep ticks and
luck-scaled proc chances rather than player stats.

## The stat formulas

Transcribed from the wiki's mechanics pages, not reimplemented from intuition.
See `src/engine/stats.ts`.

**Damage** — damage ups feed a square root, so each one is worth less than the
last. Flat damage ups bypass it entirely, which is why they feel so strong:

```
EffectiveDamage = (CharBaseDmg * sqrt(TotalDmgUps * 1.2 + 1) + FlatDmgUps) * Multipliers
```

**Fire rate** — most items modify a hidden `Tears` stat that feeds a
four-case piecewise tear delay function; a few modify fire rate directly:

```
FireRate = (30 / (TearDelay + 1) + S) * P
```

One correction to the wiki here: it gives the sqrt/linear branch point as
`-0.77`, but that's a rounded value. The real boundary is `-1/1.3`
(`-0.76923…`), and taking `-0.77` literally produces `NaN` for tears values in
between. Both branches meet at exactly `20.6154` at `-1/1.3`, which confirms
it. There's a regression test for this.

**Order of operations.** Documented for fire rate: *"Fire rate increases are
applied before fire rate multipliers, so with a multiplier of 2, a +1 fire
rate addition will increase fire rate by 2."* Tear delay goes the other way —
the wiki states Haemolacria as `Tear Delay x 2 + 11`, which only works if the
multiplier applies first (31 at base, not 42). Range, speed and shot speed
ordering is **not documented anywhere**; we follow the fire rate precedent
(adds, then multipliers). That remains the least-supported assumption in the
engine and is flagged in `stats.ts`.

**Shots per volley.** Damage is reported **per tear** and Tears as **volleys
per second** — both as the in-game stat screen shows them. Projectile count is
a third, separate quantity that enters only DPS:

```
DPS = damage * fireRate * shotsPerVolley
```

This matters because multi-shot items pay their cost in the stats and deliver
their benefit in the count. 20/20 is a 0.8x damage multiplier, so damage per
tear correctly drops 3.50 -> 2.80 — but it fires two tears, making it a 1.60x
DPS *gain*. Folding the count into the damage row instead would break
agreement with the stat screen.

Counts are curated (`SHOT_MULTIPLIER` in `parse_data.py`), since they appear
only in prose: 20/20 fires 2, The Inner Eye 3, Mutant Spider 4, The Wiz 2.
Keeper has an innate triple shot and Tainted Keeper a quadruple. They combine
multiplicatively — the wiki notes Diplopia + The Inner Eye gives 6 — capped at
16 tears per volley.

Split-on-impact items are deliberately excluded: The Parasite, Cricket's Body
and Haemolacria create extra tears that are weaker and conditional on hitting
something, so a flat multiplier would overstate them. Monstro's Lung is
excluded too, since its 14 tears come per *charged* shot; it keeps its
`dpsNote` instead.

**Duplicate pickups.** Copies are reachable in normal play (Diplopia, Crooked
Penny, Damocles, Glitched Crown), and summing them blindly is wrong for items
that say so. Each item carries a `stacking` rule:

| rule | behaviour | example |
|---|---|---|
| `full` | extra copies add their mods again | The Sad Onion |
| `none` | extra copies contribute nothing | Immaculate Heart, Magic 8 Ball |
| `diminished` | extra copies contribute `repeatMods` | Odd Mushroom (Thin) |

Immaculate Heart states "x1.2 damage multiplier. This multiplier does not
stack with multiple Immaculate Hearts" — three copies previously read as
x1.728 damage (4.20 → 6.05), a 44% overstatement. Odd Mushroom (Thin) grants
+1.7 fire rate but "additional copies only grant +0.7", and its speed and
damage changes don't repeat at all.

`none` is detected from the effects text; `diminished` is curated, since the
reduced amount only appears in prose. The inventory labels extra copies that
are ignored or reduced rather than silently collapsing them.

This also closed a latent crash: stacking damage-down items could push total
damage ups below `-1/1.2`, making `sqrt(damageUps * 1.2 + 1)` imaginary and
turning damage into `NaN`. Six Odd Mushrooms did it. The sqrt argument is now
clamped at zero — the wiki documents no damage floor, so that clamp is ours.
The earlier "every item stays finite" test only ever tried one item at a time;
it now also tries every item six times over.

**Non-stacking multipliers** — Cricket's Head, Magic Mushroom, and Blood of
the Martyr + Book of Belial each grant ×1.5 damage, but holding several still
yields ×1.5 total. Modelled as a separate channel that collapses to its
largest member.

## Interactions

The wiki documents synergies and interactions as prose on item pages. We
capture 3,474 synergy lines and 3,635 interaction lines, and the builder
surfaces the ones that concern two items **actually in your build** under
"Interactions" in the left panel.

Three things were needed to make that trustworthy:

**Version filtering.** These sections tag their partner item as
`{{I|Name|code}}`, where the code is a DLC range for the interaction itself.
464 entries don't apply to Repentance+ — only 33 of those were removed by
Repentance+, the other 431 by Repentance — and they were previously shown as
current. `Anti-Gravity + Tiny Planet` and `Apple! + Brimstone` are two that
no longer exist.

**Group headings.** An Interactions section is organised under plain-text
labels that carry the meaning, and flattening them destroys it:

```
Overridden by Brimstone:                               <- behaviour replaced
  * Cursed Eye, Evil Eye, Flat Stone, ...
Only stat effects are applied; otherwise overridden:   <- stats still count
  * Compound Fracture, Cricket's Body, Death's Touch
Other interactions:
  * 8 Inch Nails: Beams gain knockback...
```

That middle group matters directly to a stat calculator. Headings are now
preserved on every line.

**Subject-preferred matching.** Most lines name their subject before a colon.
Matching anywhere in the text produced false pairs — `"Azazel: Increases
Azazel's range with Brimstone"` was being reported as a Tiny Planet +
Brimstone interaction. When a line has a subject it decides what the line is
about; if that subject names no item in the build, the line concerns some
third item and is skipped.

Residual limitations: entries are **one-directional** (they live on whichever
page an editor wrote them, so A may reference B without B mentioning A), lines
with no subject still match on body text and can occasionally mis-pair, and
short names (`Tick`, `Terra`, `Pop!`) can match incidental prose. These are
presented as references to read, never folded into the numbers.

## Verification

`data/verification_checklist.md` holds 16 builds with the stats this
calculator predicts, ready to be checked against a real stat screen. Three
are marked ORDERING TEST because they discriminate between the two possible
multiplier orderings — Cricket's Body + Mom's Pearls gives 7.20 range under
add-then-multiply and 7.70 under multiply-then-add, and nothing in the wiki
says which is right.

This is the only check that reaches past the wiki. Everything else in the
project, including `npm run validate`, proves internal consistency only.

## Not modelled

- **Synergy effects.** Interactions are displayed, never simulated. Brimstone
  + Tech X can't be expressed as a stat delta, and there are thousands of
  pairs. Nothing in the Interactions panel affects the computed stats.
- **Conditional effects.** Eve's ×1.00 damage at one Red Heart, Azazel's
  ×0.267 Brimstone fire rate component, floor-dependent charge costs.
- **The `shotSpeed` floor of 0.1 is invented**, not documented anywhere.
- **`x0.9 total damage up multiplier`** (Odd Mushroom (Thin)) multiplies the
  damage-up *sum* rather than final damage — a channel the engine lacks.
- **Eden / Tainted Eden randomised stats.** Flagged in the UI; shown values
  use the wiki's listed midpoint.
- **Multiplier interaction order.** Haemolacria documents that its tear delay
  adjustment lands after sub-1 multipliers but before Soy Milk's. We apply
  multipliers as a flat product, so exotic combinations can drift.
- Health, cards, pills, and Birthright.
