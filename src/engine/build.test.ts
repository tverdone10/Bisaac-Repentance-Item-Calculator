/** Integration tests: real parsed data through the real engine. */

import { describe, expect, it } from "vitest";
import { characters, items } from "../data";
import {
  buildInteractions,
  buildMods,
  buildStats,
  transformations,
  type Build,
} from "./build";
import type { Item } from "../types";

const byName = (n: string): Item => {
  const found = items.find((i) => i.name === n);
  if (!found) throw new Error(`no item named ${n}`);
  return found;
};

const charByName = (n: string) => {
  const found = characters.find((c) => c.name === n);
  if (!found) throw new Error(`no character named ${n}`);
  return found;
};

/** Same as buildFor, named for spreading into buildStats(...). */
const swap = (name: string, itemNames: string[]): [Build, Item[]] =>
  buildFor(name, itemNames);

const buildFor = (name: string, itemNames: string[]): [Build, Item[]] => {
  const picked = itemNames.map(byName);
  return [
    {
      character: charByName(name),
      formIndex: 0,
      picked: picked.map((i) => i.page),
      variants: {},
      scaled: {},
    },
    picked,
  ];
};

describe("dataset shape", () => {
  it("has the full Repentance+ roster", () => {
    expect(characters).toHaveLength(34);
    expect(characters.filter((c) => c.tainted)).toHaveLength(17);
  });

  it("has every collectible and trinket", () => {
    expect(items.filter((i) => i.kind !== "trinket")).toHaveLength(720);
    expect(items.filter((i) => i.kind === "trinket")).toHaveLength(188);
  });

  it("has a sprite for every entry", () => {
    expect(items.filter((i) => !i.sprite)).toEqual([]);
    expect(characters.filter((c) => !c.sprite)).toEqual([]);
  });

  it("has a description for effectively every item", () => {
    const missing = items.filter((i) => !i.description);
    expect(missing.length).toBeLessThan(5);
  });

  it("gives every item a complete mods object", () => {
    // A missing channel would silently read as undefined in the engine.
    const keys = Object.keys(byName("The Sad Onion").mods).sort();
    for (const item of items) {
      expect(Object.keys(item.mods).sort()).toEqual(keys);
    }
  });
});

describe("character base stats match the wiki", () => {
  const cases: [string, Partial<Record<string, number>>][] = [
    ["Isaac", { damageMultiplier: 1.0, speed: 1.0, range: 6.5, luck: 0 }],
    ["Judas", { damageMultiplier: 1.35 }],
    ["Eve", { damageMultiplier: 0.75, speed: 1.23 }],
    ["???", { damageMultiplier: 1.05, speed: 1.1 }],
    ["Azazel", { damageMultiplier: 1.5, range: 4.5, speed: 1.25 }],
    ["Samson", { shotSpeed: 1.31, tears: -0.1, range: 5.0 }],
    ["Keeper", { damageMultiplier: 1.2, luck: -2, speed: 0.9 }],
    ["Lazarus", { luck: -1, range: 4.5 }],
  ];

  for (const [name, expected] of cases) {
    it(name, () => {
      const base = charByName(name).base as unknown as Record<string, number>;
      for (const [key, value] of Object.entries(expected)) {
        expect(base[key], `${name}.${key}`).toBeCloseTo(value as number, 6);
      }
    });
  }

  it("models Jacob and Esau as two forms with different stats", () => {
    const je = charByName("Jacob and Esau");
    expect(je.dual).toBe(true);
    expect(je.forms.map((f) => f.name)).toEqual(["Jacob", "Esau"]);
    expect(je.forms[0].base.damage).toBeCloseTo(2.75, 6);
    expect(je.forms[1].base.damage).toBeCloseTo(3.75, 6);
    expect(je.forms[0].base.luck).toBeCloseTo(1, 6);
    expect(je.forms[1].base.luck).toBeCloseTo(-1, 6);
  });
});

describe("known builds", () => {
  it("leaves a bare Isaac at base stats", () => {
    const [build, picked] = buildFor("Isaac", []);
    const s = buildStats(build, picked);
    expect(s.damage).toBeCloseTo(3.5, 6);
    expect(s.fireRate).toBeCloseTo(2.7273, 3);
  });

  it("does not stack Cricket's Head with Magic Mushroom", () => {
    const [b1, p1] = buildFor("Isaac", ["Cricket's Head"]);
    const [b2, p2] = buildFor("Isaac", ["Cricket's Head", "Magic Mushroom"]);

    // Both hold a 1.5x from the non-stacking group. The second item should
    // contribute its damage-up and other stats but NOT a second 1.5x.
    const one = buildStats(b1, p1);
    const two = buildStats(b2, p2);

    // 0.5 + 0.3 = 0.8 damage ups, still a single 1.5x multiplier.
    expect(two.damage).toBeCloseTo(
      3.5 * Math.sqrt(0.8 * 1.2 + 1) * 1.5,
      6,
    );
    // Sanity: if they had stacked we'd see 2.25x, so well above this.
    expect(two.damage).toBeLessThan(one.damage * 1.5);
  });

  it("applies Soy Milk as a big fire rate gain and damage loss", () => {
    const [build, picked] = buildFor("Isaac", ["Soy Milk"]);
    const s = buildStats(build, picked);
    expect(s.damage).toBeCloseTo(0.7, 6);
    expect(s.fireRate).toBeCloseTo(2.7273 * 5.5, 2);
  });

  it("applies Polyphemus' flat damage via its override", () => {
    const poly = byName("Polyphemus");
    expect(poly.overrideReason).toBeTruthy();
    const [build, picked] = buildFor("Isaac", ["Polyphemus"]);
    const s = buildStats(build, picked);
    expect(s.damage).toBeCloseTo(15, 6); // (3.5 + 4) * 2
  });

  it("gives Cricket's Body a range multiplier, not a range add", () => {
    const body = byName("Cricket's Body");
    expect(body.mods.rangeMultipliers).toEqual([0.8]);
    const [build, picked] = buildFor("Isaac", ["Cricket's Body"]);
    expect(buildStats(build, picked).range).toBeCloseTo(6.5 * 0.8, 6);
  });

  it("keeps stats finite for every single item on its own", () => {
    // Guards against a parsed NaN/undefined sneaking into any channel.
    for (const item of items) {
      const build: Build = {
        character: charByName("Isaac"),
        formIndex: 0,
        picked: [item.page],
        variants: {},
        scaled: {},
      };
      const s = buildStats(build, [item]);
      for (const [key, value] of Object.entries(s)) {
        expect(Number.isFinite(value), `${item.name}.${key}`).toBe(true);
      }
    }
  });
});

describe("accuracy guards", () => {
  it("gives Azazel his x0.267 innate fire rate multiplier", () => {
    const azazel = charByName("Azazel");
    expect(azazel.base.fireRateMultiplier).toBeCloseTo(0.267, 6);
    // and it actually reaches the computed fire rate
    const [build, picked] = buildFor("Azazel", []);
    const isaac = buildFor("Isaac", []);
    expect(buildStats(build, picked).fireRate).toBeLessThan(
      buildStats(isaac[0], isaac[1]).fireRate * 0.5,
    );
  });

  it("defaults every other character to a x1 fire rate multiplier", () => {
    const named = new Set([
      "Azazel", "Tainted Azazel", "The Forgotten",
      "Tainted Forgotten", "Tainted Eve",
    ]);
    for (const c of characters) {
      if (named.has(c.name)) continue;
      expect(c.base.fireRateMultiplier, c.name).toBeCloseTo(1, 6);
    }
  });

  it("reads Haemolacria's full tear delay formula", () => {
    const h = byName("Haemolacria");
    expect(h.mods.tearDelayMultipliers).toEqual([2]);
    expect(h.mods.tearDelay).toBeCloseTo(11, 6); // the "+ 11" half
    expect(h.mods.damageMultipliers).toEqual([1.5]);
    expect(h.mods.rangeMultipliers).toEqual([0.8]);
  });

  it("flags items where DPS is not meaningful", () => {
    for (const n of ["Brimstone", "Tech X", "Mom's Knife", "Dr. Fetus"]) {
      expect(byName(n).dpsNote, n).toBeTruthy();
    }
    // ...but not items that still fire discrete shots
    expect(byName("The Sad Onion").dpsNote).toBeNull();
    expect(byName("Terra").dpsNote).toBeNull();
  });

  it("surfaces conditional effects instead of applying them", () => {
    const mega = byName("Mega Mush");
    expect(mega.conditionalEffects.length).toBeGreaterThan(0);
    // The 4x damage is time-limited, so it must NOT be a flat multiplier.
    expect(mega.mods.damageMultipliers).toEqual([]);
  });
});

describe("documented interactions", () => {
  it("filters out entries removed before Repentance+", () => {
    // "Anti-Gravity: Tiny Planet" and "Apple!: Brimstone" were removed in
    // Repentance. 431 such entries existed; none should survive.
    const anti = byName("Anti-Gravity");
    const all = [...anti.synergies, ...anti.interactions]
      .map((l) => l.text)
      .join(" ");
    expect(all).not.toContain("Tiny Planet");
  });

  it("keeps the wiki's group headings", () => {
    const brim = byName("Brimstone");
    const groups = new Set(brim.interactions.map((l) => l.group));
    expect(groups.has("Overridden by Brimstone")).toBe(true);
    // The group that matters for a stat calculator.
    expect(
      [...groups].some((g) => g?.startsWith("Only stat effects are applied")),
    ).toBe(true);
  });

  it("finds interactions between items actually in the build", () => {
    const [, picked] = buildFor("Isaac", ["Brimstone", "Cricket's Body"]);
    const found = buildInteractions(picked);
    expect(found.length).toBeGreaterThan(0);
    // Brimstone's page documents Cricket's Body under the stats-only group.
    const pair = found.find((f) => f.with === "Cricket's Body");
    expect(pair).toBeTruthy();
    expect(pair!.from).toBe("Brimstone");
  });

  it("returns nothing for a build with fewer than two items", () => {
    const [, one] = buildFor("Isaac", ["Brimstone"]);
    expect(buildInteractions(one)).toEqual([]);
    expect(buildInteractions([])).toEqual([]);
  });

  it("does not report an item interacting with itself", () => {
    const [, dup] = buildFor("Isaac", ["Brimstone", "Brimstone"]);
    expect(buildInteractions(dup)).toEqual([]);
  });

  it("gives every interaction line a text body", () => {
    for (const item of items) {
      for (const line of [...item.synergies, ...item.interactions]) {
        expect(line.text.length, item.name).toBeGreaterThan(0);
      }
    }
  });
});

describe("multi-shot", () => {
  it("gives the multi-shot items their shot counts", () => {
    expect(byName("20/20").mods.shotMultipliers).toEqual([2]);
    expect(byName("The Inner Eye").mods.shotMultipliers).toEqual([3]);
    expect(byName("Mutant Spider").mods.shotMultipliers).toEqual([4]);
  });

  it("reports 20/20 as a DPS gain while damage per tear still drops", () => {
    const [bare, bareItems] = buildFor("Isaac", []);
    const [build, picked] = buildFor("Isaac", ["20/20"]);
    const b = buildStats(bare, bareItems);
    const s = buildStats(build, picked);

    expect(s.damage).toBeLessThan(b.damage); // per tear: 3.50 -> 2.80
    expect(s.shotsPerVolley).toBe(2);
    expect(s.dps).toBeGreaterThan(b.dps); // but 1.6x the output
  });

  it("gives Keeper his innate triple shot", () => {
    expect(charByName("Keeper").base.shotsPerVolley).toBe(3);
    expect(charByName("Tainted Keeper").base.shotsPerVolley).toBe(4);
  });

  it("defaults everyone else to a single shot", () => {
    for (const c of characters) {
      if (c.name === "Keeper" || c.name === "Tainted Keeper") continue;
      expect(c.base.shotsPerVolley, c.name).toBe(1);
    }
  });

  it("does not apply a flat multiplier to split-on-impact items", () => {
    // These produce weaker tears conditional on hitting something, so a
    // clean shot multiplier would overstate them.
    for (const n of ["The Parasite", "Cricket's Body", "Haemolacria"]) {
      expect(byName(n).mods.shotMultipliers, n).toEqual([]);
    }
  });
});

describe("verb-prefixed and comma-listed stat lines", () => {
  it('reads "Gives Isaac +N stat" lines', () => {
    // The stat patterns anchor on the number, so a leading verb used to make
    // the whole line slide past unparsed.
    expect(byName("Evil Charm").mods.luck).toBeCloseTo(2, 10);
    expect(byName("Perfection").mods.luck).toBeCloseTo(10, 10);
    expect(byName("Orphan Socks").mods.speed).toBeCloseTo(0.3, 10);
    expect(byName("Ring Worm").mods.tears).toBeCloseTo(0.4, 10);
  });

  it("reads a multi-stat comma list with a mixed multiplier and add", () => {
    // My Reflection: "2x + 1.5 range, +1.5 damage, -1 luck."
    const mr = byName("My Reflection");
    expect(mr.mods.rangeMultipliers).toEqual([2]);
    expect(mr.mods.range).toBeCloseTo(1.5, 10);
    expect(mr.mods.damageUps).toBeCloseTo(1.5, 10);
    expect(mr.mods.luck).toBeCloseTo(-1, 10);
    expect(mr.mods.shotSpeedMultipliers).toEqual([1.6]);
  });

  it("still declines state-scaled lines rather than applying them", () => {
    // "every 3 coins spent", "for each stat down pill", "rest of the floor"
    for (const n of ["Keeper's Sack", "False PHD", "Sol", "Stye"]) {
      const it = byName(n);
      expect(it.hasStats, n).toBe(false);
      expect(it.conditionalEffects.length, n).toBeGreaterThan(0);
    }
  });

  it("never derives a flat modifier from a conditional line", () => {
    // Regression: stripping leading verbs exposed "Grants +0.6 damage for
    // each stat down pill" to the flat-damage pattern, applying one pill's
    // worth as a constant. Extraction now refuses conditional lines outright.
    for (const item of items) {
      if (!item.hasStats) continue;
      // An item with modelled stats may still have conditional extras, but
      // no modelled channel may have come from a conditional-only item.
      if (item.conditionalEffects.length > 0) continue;
      expect(Number.isFinite(item.mods.damageUps), item.name).toBe(true);
    }
    expect(byName("False PHD").hasStats).toBe(false);
  });

  it("does not double-count a stat stated on more than one bullet", () => {
    // Guard for the widened patterns: an item's damage must come from one
    // line, not be summed across a restatement.
    expect(byName("The Sad Onion").mods.tears).toBeCloseTo(0.7, 10);
    expect(byName("Pentagram").mods.damageUps).toBeCloseTo(1, 10);
    expect(byName("Sacred Heart").mods.flatDamage).toBeCloseTo(1, 10);
  });
});

describe("duplicate pickups", () => {
  it("does not stack a multiplier the wiki says cannot stack", () => {
    // Immaculate Heart: "x1.2 damage multiplier. This multiplier does not
    // stack with multiple Immaculate Hearts." Summing gave x1.728 at three.
    const heart = byName("Immaculate Heart");
    expect(heart.stacking).toBe("none");

    const one = buildStats(...swap("Isaac", ["Immaculate Heart"]));
    const three = buildStats(
      ...swap("Isaac", [
        "Immaculate Heart",
        "Immaculate Heart",
        "Immaculate Heart",
      ]),
    );
    expect(three.damage).toBeCloseTo(one.damage, 10);
    expect(one.damage).toBeCloseTo(4.2, 10); // 3.5 * 1.2
  });

  it("does not stack a flat stat the wiki says cannot stack", () => {
    // Magic 8 Ball: "This effect doesn't stack with additional copies."
    const one = buildStats(...swap("Isaac", ["Magic 8 Ball"]));
    const two = buildStats(...swap("Isaac", ["Magic 8 Ball", "Magic 8 Ball"]));
    expect(two.shotSpeed).toBeCloseTo(one.shotSpeed, 10);
  });

  it("gives diminished items their reduced per-copy value", () => {
    // Odd Mushroom (Thin): +1.7 fire rate, "additional copies only grant
    // +0.7 fire rate". Speed and damage must not repeat at all.
    const odd = byName("Odd Mushroom (Thin)");
    expect(odd.stacking).toBe("diminished");
    expect(odd.repeatMods.fireRateAdd).toBeCloseTo(0.7, 10);
    expect(odd.repeatMods.speed).toBe(0);
    expect(odd.repeatMods.damageUps).toBe(0);

    const one = buildStats(...swap("Isaac", ["Odd Mushroom (Thin)"]));
    const two = buildStats(
      ...swap("Isaac", ["Odd Mushroom (Thin)", "Odd Mushroom (Thin)"]),
    );
    expect(two.fireRate - one.fireRate).toBeCloseTo(0.7, 10);
    expect(two.speed).toBeCloseTo(one.speed, 10);
  });

  it("still stacks ordinary items fully", () => {
    const one = buildStats(...swap("Isaac", ["The Sad Onion"]));
    const two = buildStats(...swap("Isaac", ["The Sad Onion", "The Sad Onion"]));
    expect(two.fireRate).toBeGreaterThan(one.fireRate);
  });

  it("never produces NaN damage from stacked damage-downs", () => {
    // Regression: three Odd Mushrooms summed to -1.2 damage ups, and
    // sqrt(-1.2 * 1.2 + 1) is imaginary.
    const many = Array(6).fill("Odd Mushroom (Thin)");
    const s = buildStats(...swap("Isaac", many));
    for (const [k, v] of Object.entries(s)) {
      expect(Number.isFinite(v), k).toBe(true);
    }
  });

  it("keeps every stat finite for any item taken six times", () => {
    for (const item of items) {
      const picked = Array(6).fill(item);
      const build: Build = {
        character: charByName("Isaac"),
        formIndex: 0,
        picked: picked.map((i) => i.page),
        variants: {},
        scaled: {},
      };
      const s = buildStats(build, picked);
      for (const [k, v] of Object.entries(s)) {
        expect(Number.isFinite(v), `${item.name}.${k}`).toBe(true);
      }
    }
  });
});

describe("variants and scaled effects", () => {
  it("applies exactly one variant, never the sum", () => {
    const purity = byName("Purity");
    expect(purity.variants.map((v) => v.label)).toEqual([
      "Red (damage)",
      "Blue (fire rate)",
      "Yellow (speed)",
      "Orange (range)",
    ]);

    const base = charByName("Isaac");
    const mk = (idx: number): Build => ({
      character: base,
      formIndex: 0,
      picked: [purity.page],
      variants: { [purity.page]: idx },
      scaled: {},
    });
    const red = buildStats(mk(0), [purity]);
    const orange = buildStats(mk(3), [purity]);

    // Red is +4 damage and no range; Orange is +3 range and no damage.
    expect(red.damage).toBeGreaterThan(3.5);
    expect(red.range).toBeCloseTo(6.5, 10);
    expect(orange.range).toBeCloseTo(9.5, 10);
    expect(orange.damage).toBeCloseTo(3.5, 10);
  });

  it("defaults to the first variant when none is chosen", () => {
    const purity = byName("Purity");
    const b: Build = {
      character: charByName("Isaac"),
      formIndex: 0,
      picked: [purity.page],
      variants: {},
      scaled: {},
    };
    expect(buildStats(b, [purity]).damage).toBeGreaterThan(3.5);
  });

  it("scales a per-unit bonus and respects its cap", () => {
    const mp = byName("Money = Power");
    expect(mp.scaled?.quantity).toBe("coins held");
    expect(mp.scaled?.max).toBe(99);

    const at = (coins: number) => {
      const b: Build = {
        character: charByName("Isaac"),
        formIndex: 0,
        picked: [mp.page],
        variants: {},
        scaled: { [mp.page]: coins },
      };
      return buildMods([mp], { scaled: b.scaled }).damageUps;
    };
    expect(at(0)).toBeCloseTo(0, 10);
    expect(at(25)).toBeCloseTo(1.0, 6);
    expect(at(99)).toBeCloseTo(3.96, 6);
    // past the cap it must not keep climbing
    expect(at(500)).toBeCloseTo(3.96, 6);
  });

  it("contributes nothing from a scaled item left at zero", () => {
    const bb = byName("Brittle Bones");
    expect(buildMods([bb], {}).fireRateAdd).toBeCloseTo(0, 10);
  });

  it("scales the damage-up sum, not final damage", () => {
    // Odd Mushroom (Thin): x0.9 total damage up multiplier, inside the sqrt.
    const om = byName("Odd Mushroom (Thin)");
    expect(om.mods.damageUpMultipliers).toEqual([0.9]);

    const pent = byName("Pentagram"); // +1 damage up
    const withBoth = buildMods([pent, om], {});
    // 1 damage up scaled to 0.9 before the sqrt
    expect(withBoth.damageUps * withBoth.damageUpMultipliers[0]).toBeCloseTo(
      (1 - 0.4) * 0.9,
      6,
    );
  });
});

describe("transformations", () => {
  it("counts distinct items toward a transformation", () => {
    const flies = items.filter((i) => i.tags.includes("fly")).slice(0, 3);
    expect(flies.length).toBe(3);
    const progress = transformations(flies);
    const bee = progress.find((p) => p.name === "Beelzebub");
    expect(bee?.count).toBe(3);
    expect(bee?.active).toBe(true);
  });

  it("does not let a duplicate pickup advance a transformation", () => {
    const fly = items.find((i) => i.tags.includes("fly"))!;
    const progress = transformations([fly, fly, fly]);
    const bee = progress.find((p) => p.name === "Beelzebub");
    expect(bee?.count).toBe(1);
    expect(bee?.active).toBe(false);
  });
});
