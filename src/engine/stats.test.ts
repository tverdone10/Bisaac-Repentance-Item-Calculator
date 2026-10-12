import { describe, expect, it } from "vitest";
import {
  MAX_SHOTS_PER_VOLLEY,
  TEARS_CAP,
  TEARS_LINEAR_BOUNDARY,
  computeStats,
  damageMultiplier,
  emptyMods,
  mergeMods,
  tearDelayFromTears,
  type BaseStats,
  type StatMods,
} from "./stats";

/** Isaac: the reference character, all multipliers 1.0. */
const ISAAC: BaseStats = {
  damage: 3.5,
  damageMultiplier: 1.0,
  tears: 0,
  fireRateMultiplier: 1.0,
  shotsPerVolley: 1,
  speed: 1.0,
  range: 6.5,
  shotSpeed: 1.0,
  luck: 0,
};

function mods(p: Partial<StatMods>): StatMods {
  return mergeMods([p]);
}

describe("tear delay", () => {
  it("gives the documented base delay of 10 at T=0", () => {
    // 16 - 6*sqrt(1) = 10
    expect(tearDelayFromTears(0)).toBeCloseTo(10, 10);
  });

  it("produces the known 2.73 base fire rate for an unmodified character", () => {
    // 30 / (10 + 1) = 2.7272...  This is the number on the stat screen.
    const s = computeStats(ISAAC, emptyMods());
    expect(s.fireRate).toBeCloseTo(2.7273, 4);
  });

  it("floors at 5 delay once T exceeds the cap", () => {
    expect(tearDelayFromTears(TEARS_CAP + 0.001)).toBe(5);
    expect(tearDelayFromTears(99)).toBe(5);
    // Just under the cap should be essentially 5 but reached via the sqrt.
    expect(tearDelayFromTears(TEARS_CAP - 0.0001)).toBeCloseTo(5, 3);
  });

  it("caps fire rate at 5 tears/sec with no direct modifiers", () => {
    // The wiki states T_max corresponds to exactly 5 tears per second.
    const s = computeStats(ISAAC, mods({ tears: 50 }));
    expect(s.fireRate).toBeCloseTo(5, 10);
  });

  it("applies the extra -6T penalty in the shallow-negative case", () => {
    // T = -0.5 is in the (-0.77, 0) branch: 16 - 6*sqrt(0.35) + 3
    const expected = 16 - 6 * Math.sqrt(-0.5 * 1.3 + 1) - 6 * -0.5;
    expect(tearDelayFromTears(-0.5)).toBeCloseTo(expected, 10);
    // and it is strictly worse than the naive sqrt-only reading
    expect(tearDelayFromTears(-0.5)).toBeGreaterThan(
      16 - 6 * Math.sqrt(-0.5 * 1.3 + 1),
    );
  });

  it("switches to the linear branch at T <= -0.77", () => {
    expect(tearDelayFromTears(-1)).toBeCloseTo(22, 10);
    expect(tearDelayFromTears(-2)).toBeCloseTo(28, 10);
  });

  it("has both branches agree exactly at the sqrt/linear boundary", () => {
    // This is what identifies -1/1.3 as the true branch point: the sqrt term
    // is exactly zero there, so the two expressions coincide.
    const t = TEARS_LINEAR_BOUNDARY;
    const sqrtBranch = 16 - 6 * Math.sqrt(t * 1.3 + 1) - 6 * t;
    const linearBranch = 16 - 6 * t;
    expect(sqrtBranch).toBeCloseTo(linearBranch, 10);
    expect(tearDelayFromTears(t)).toBeCloseTo(20.6154, 4);

    // No epsilon-neighbourhood assertion here on purpose: sqrt has a vertical
    // tangent at the boundary, so the function is continuous but not
    // Lipschitz. Monotonicity (tested below) is the meaningful guarantee
    // against an actual jump discontinuity.
  });

  it("never returns NaN, including in the rounded -0.77 dead zone", () => {
    // Regression: the wiki's -0.77 branch point is a rounded -1/1.3, so
    // taking it literally sends sqrt() imaginary just above the boundary.
    for (const t of [-0.7695, -0.7699, -0.76923, -0.7692, -0.77, -0.7701]) {
      expect(Number.isNaN(tearDelayFromTears(t))).toBe(false);
    }
    for (let t = -5; t <= 5; t += 0.001) {
      if (Number.isNaN(tearDelayFromTears(t))) {
        throw new Error(`tearDelayFromTears(${t}) returned NaN`);
      }
    }
  });

  it("is monotonically non-increasing in the tears stat", () => {
    let prev = Infinity;
    for (let t = -5; t <= 3; t += 0.01) {
      const d = tearDelayFromTears(t);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
  });
});

describe("damage", () => {
  it("returns character base damage with no items", () => {
    expect(computeStats(ISAAC, emptyMods()).damage).toBeCloseTo(3.5, 10);
  });

  it("applies the sqrt so damage ups have diminishing returns", () => {
    const one = computeStats(ISAAC, mods({ damageUps: 1 })).damage;
    const two = computeStats(ISAAC, mods({ damageUps: 2 })).damage;
    const three = computeStats(ISAAC, mods({ damageUps: 3 })).damage;
    // 3.5 * sqrt(1*1.2+1) = 3.5 * sqrt(2.2)
    expect(one).toBeCloseTo(3.5 * Math.sqrt(2.2), 10);
    // each successive +1 is worth strictly less than the last
    expect(two - one).toBeLessThan(one - 3.5);
    expect(three - two).toBeLessThan(two - one);
  });

  it("treats flat damage as bypassing the sqrt", () => {
    const flat = computeStats(ISAAC, mods({ flatDamage: 4 })).damage;
    expect(flat).toBeCloseTo(7.5, 10); // 3.5 + 4, untouched by sqrt
  });

  it("gives flat damage constant marginal value, unlike normal ups", () => {
    const flatGain = (at: number) =>
      computeStats(ISAAC, mods({ damageUps: at, flatDamage: 1 })).damage -
      computeStats(ISAAC, mods({ damageUps: at })).damage;
    // A flat +1 is worth exactly 1 damage no matter what else you hold.
    expect(flatGain(0)).toBeCloseTo(1, 10);
    expect(flatGain(10)).toBeCloseTo(1, 10);
  });

  it("has a crossover: normal ups win early, flat ups win late", () => {
    const upGain = (at: number) =>
      computeStats(ISAAC, mods({ damageUps: at + 1 })).damage -
      computeStats(ISAAC, mods({ damageUps: at })).damage;

    // With nothing else, a normal damage up beats a flat +1 (1.69 vs 1.00) --
    // the sqrt is generous at the bottom of the curve.
    expect(upGain(0)).toBeGreaterThan(1);
    // Deep into a stack the marginal up is worth well under a flat +1.
    expect(upGain(10)).toBeLessThan(1);
  });

  it("respects the character damage multiplier", () => {
    const judas = computeStats(
      { ...ISAAC, damageMultiplier: 1.35 },
      emptyMods(),
    );
    expect(judas.damage).toBeCloseTo(4.725, 10);

    const eve = computeStats({ ...ISAAC, damageMultiplier: 0.75 }, emptyMods());
    expect(eve.damage).toBeCloseTo(2.625, 10);
  });

  it("stacks free multipliers multiplicatively", () => {
    expect(damageMultiplier(mods({ damageMultipliers: [2, 1.5] }))).toBeCloseTo(
      3,
      10,
    );
  });

  it("collapses the non-stacking 1.5x group to a single 1.5x", () => {
    // Cricket's Head + Magic Mushroom should be 1.5x, not 2.25x.
    const one = damageMultiplier(mods({ nonStackingMultipliers: [1.5] }));
    const two = damageMultiplier(mods({ nonStackingMultipliers: [1.5, 1.5] }));
    expect(one).toBeCloseTo(1.5, 10);
    expect(two).toBeCloseTo(1.5, 10);
  });

  it("still lets the non-stacking group combine with free multipliers", () => {
    const m = damageMultiplier(
      mods({ nonStackingMultipliers: [1.5, 1.5], damageMultipliers: [2] }),
    );
    expect(m).toBeCloseTo(3, 10);
  });
});

describe("known item behaviour", () => {
  it("models Soy Milk as a fire rate multiplier with a damage penalty", () => {
    // Wiki: divides tear delay by 5.5x (i.e. 5.5x fire rate), 0.2x damage.
    const base = computeStats(ISAAC, emptyMods());
    const soy = computeStats(
      ISAAC,
      mods({ fireRateMultipliers: [5.5], damageMultipliers: [0.2] }),
    );

    expect(soy.damage).toBeCloseTo(0.7, 10); // 3.5 * 0.2
    expect(soy.fireRate).toBeCloseTo(base.fireRate * 5.5, 10);
    // Net DPS gain is 5.5 * 0.2 = 1.1x, i.e. barely positive on its own.
    expect(soy.dps / base.dps).toBeCloseTo(1.1, 10);
  });

  it("models Polyphemus as (damage + 4) * 2", () => {
    const poly = computeStats(
      ISAAC,
      mods({ flatDamage: 4, damageMultipliers: [2] }),
    );
    expect(poly.damage).toBeCloseTo(15, 10); // (3.5 + 4) * 2
  });
});

describe("innate fire rate multiplier", () => {
  it("scales fire rate for characters that have one", () => {
    // Azazel: x0.267 innate. Easy to miss, and worth ~4x on DPS.
    const azazel = computeStats(
      { ...ISAAC, fireRateMultiplier: 0.267 },
      emptyMods(),
    );
    const isaac = computeStats(ISAAC, emptyMods());
    expect(azazel.fireRate).toBeCloseTo(isaac.fireRate * 0.267, 6);
  });

  it("applies after additive fire rate modifiers, per the wiki", () => {
    // "Fire rate increases are applied before fire rate multipliers, so with
    //  a multiplier of 2, a +1 fire rate addition will increase fire rate
    //  by 2."
    const base = computeStats(ISAAC, emptyMods()).fireRate;
    const s = computeStats(
      { ...ISAAC, fireRateMultiplier: 2 },
      mods({ fireRateAdd: 1 }),
    );
    expect(s.fireRate).toBeCloseTo((base + 1) * 2, 6);
  });
});

describe("tear delay ordering", () => {
  it("multiplies before adding, per Haemolacria's stated formula", () => {
    // Wiki states Haemolacria as "Tear Delay x 2 + 11". At base delay 10
    // that is 31, not the 42 an add-then-multiply order would give.
    const s = computeStats(
      ISAAC,
      mods({ tearDelayMultipliers: [2], tearDelay: 11 }),
    );
    expect(s.tearDelay).toBeCloseTo(31, 6);
  });

  it("treats a bare additive tear delay change as a simple offset", () => {
    // Cancer trinket is -1 tear delay with no multiplier involved.
    const s = computeStats(ISAAC, mods({ tearDelay: -1 }));
    expect(s.tearDelay).toBeCloseTo(9, 6);
  });
});

describe("shots per volley", () => {
  it("leaves damage and fire rate alone -- they are per tear / per volley", () => {
    // This is the whole point: 20/20's 0.8x belongs on damage-per-tear,
    // matching the in-game stat screen. The extra tear is a DPS term only.
    const plain = computeStats(ISAAC, mods({ damageMultipliers: [0.8] }));
    const twenty = computeStats(
      ISAAC,
      mods({ damageMultipliers: [0.8], shotMultipliers: [2] }),
    );
    expect(twenty.damage).toBeCloseTo(plain.damage, 10);
    expect(twenty.fireRate).toBeCloseTo(plain.fireRate, 10);
    expect(twenty.damage).toBeCloseTo(2.8, 10); // 3.5 * 0.8, per tear
  });

  it("turns 20/20 into a DPS gain rather than a loss", () => {
    const base = computeStats(ISAAC, emptyMods());
    const twenty = computeStats(
      ISAAC,
      mods({ damageMultipliers: [0.8], shotMultipliers: [2] }),
    );
    expect(twenty.dps / base.dps).toBeCloseTo(1.6, 10);
    expect(twenty.dps).toBeGreaterThan(base.dps);
  });

  it("combines shot multipliers multiplicatively", () => {
    // Wiki: Diplopia + The Inner Eye fires 6 tears (3 x 2).
    const s = computeStats(ISAAC, mods({ shotMultipliers: [3, 2] }));
    expect(s.shotsPerVolley).toBe(6);
  });

  it("caps the volley at 16", () => {
    const s = computeStats(ISAAC, mods({ shotMultipliers: [4, 4, 4] }));
    expect(s.shotsPerVolley).toBe(MAX_SHOTS_PER_VOLLEY);
    expect(s.shotsPerVolley).toBe(16);
  });

  it("respects an innate character shot count", () => {
    // Keeper has a triple shot.
    const keeper = computeStats({ ...ISAAC, shotsPerVolley: 3 }, emptyMods());
    const base = computeStats(ISAAC, emptyMods());
    expect(keeper.shotsPerVolley).toBe(3);
    expect(keeper.dps).toBeCloseTo(base.dps * 3, 10);
  });

  it("never drops below one shot", () => {
    const s = computeStats(ISAAC, mods({ shotMultipliers: [0] }));
    expect(s.shotsPerVolley).toBe(1);
  });
});

describe("clamps", () => {
  it("clamps speed to the documented 0.1 - 2.0 window", () => {
    expect(computeStats(ISAAC, mods({ speed: 99 })).speed).toBe(2.0);
    expect(computeStats(ISAAC, mods({ speed: -99 })).speed).toBe(0.1);
  });

  it("floors Repentance range at 1.0 and leaves it unbounded above", () => {
    expect(computeStats(ISAAC, mods({ range: -99 })).range).toBe(1.0);
    expect(computeStats(ISAAC, mods({ range: 100 })).range).toBeCloseTo(
      106.5,
      10,
    );
  });

  it("leaves luck unbounded in both directions", () => {
    expect(computeStats(ISAAC, mods({ luck: -20 })).luck).toBe(-20);
    expect(computeStats(ISAAC, mods({ luck: 40 })).luck).toBe(40);
  });
});

describe("mergeMods", () => {
  it("is order independent", () => {
    const a = mergeMods([{ damageUps: 1 }, { tears: 0.5 }, { speed: 0.2 }]);
    const b = mergeMods([{ speed: 0.2 }, { damageUps: 1 }, { tears: 0.5 }]);
    expect(computeStats(ISAAC, a)).toEqual(computeStats(ISAAC, b));
  });

  it("concatenates multiplier lists rather than summing them", () => {
    const m = mergeMods([
      { damageMultipliers: [2] },
      { damageMultipliers: [1.5] },
    ]);
    expect(m.damageMultipliers).toEqual([2, 1.5]);
    expect(damageMultiplier(m)).toBeCloseTo(3, 10);
  });
});
