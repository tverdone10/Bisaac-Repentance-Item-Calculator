/**
 * Isaac stat engine (Repentance+).
 *
 * Every formula here is transcribed from the wiki's mechanics pages rather
 * than reimplemented from intuition. Sources, for when these need auditing:
 *
 *   Damage:   EffectiveDamage = (CharBaseDmg * sqrt(TotalDmgUps * 1.2 + 1)
 *                                + FlatDmgUps) * Multipliers
 *             https://bindingofisaacrebirth.wiki.gg/wiki/Damage
 *
 *   Tears:    FireRate = (30 / (TearDelay + 1) + S) * P
 *             TearDelay is a four-case piecewise function of the hidden
 *             Tears stat T (see tearDelayFromTears below).
 *             https://bindingofisaacrebirth.wiki.gg/wiki/Tears
 *
 * The important non-obvious bits:
 *   - "Damage up" is NOT additive to final damage. It feeds the sqrt, so the
 *     same +1 is worth less the more you already have.
 *   - Flat damage ups (Polyphemus-style) bypass the sqrt entirely, which is
 *     why they feel disproportionately strong.
 *   - Fire rate items split into two unrelated channels: most items add to
 *     the hidden Tears stat T, a few modify fire rate directly (S / P).
 *     Soy Milk is the famous P case.
 */

/**
 * Hard cap on tears per volley.
 *
 * Wiki (20/20, The Inner Eye, Mutant Spider, The Wiz): "The maximum amount of
 * tears per volley that can be reached by combining and/or duplicating 20/20,
 * The Inner Eye, Mutant Spider, and The Wiz is 16."
 */
export const MAX_SHOTS_PER_VOLLEY = 16;

/** The hidden Tears value that floors tear delay at 5 in Repentance+. */
export const TEARS_CAP = 1.816239316;

/**
 * Where tear delay switches from the sqrt branch to the linear branch.
 *
 * The wiki writes this boundary as -0.77, but that is a rounded value: the
 * sqrt term `sqrt(T * 1.3 + 1)` goes imaginary below exactly -1/1.3, so
 * taking -0.77 literally yields NaN for T in (-0.77, -0.76923...). Both
 * branches evaluate to 20.6154 at -1/1.3, confirming it as the real
 * switchover point.
 */
export const TEARS_LINEAR_BOUNDARY = -1 / 1.3;

/** Clamps used by the game on final stat values. */
export const LIMITS = {
  speed: { min: 0.1, max: 2.0 },
  /** Repentance range is in tiles, floored at 1.0, no upper bound. */
  range: { min: 1.0, max: Infinity },
  /** Not documented as clamped, but negative shot speed is nonsensical. */
  shotSpeed: { min: 0.1, max: Infinity },
  luck: { min: -Infinity, max: Infinity },
  /** Delay floor implied by the T > TEARS_CAP case. */
  tearDelay: { min: 5, max: Infinity },
} as const;

export interface BaseStats {
  /** Pre-multiplier base damage, almost always 3.5. */
  damage: number;
  /** Character damage multiplier (Judas 1.35, Eve 0.75, ...). */
  damageMultiplier: number;
  /** Starting value of the hidden Tears stat T. */
  tears: number;
  /**
   * Innate fire rate multiplier. Usually 1, but several characters carry a
   * large one: Azazel 0.267, Tainted Azazel 1/3, both Forgottens 0.5,
   * Tainted Eve 0.66. It multiplies into P alongside item multipliers, so it
   * applies after additive fire rate modifiers.
   */
  fireRateMultiplier: number;
  /**
   * Projectiles fired per volley. 1 for almost everyone, but Keeper has an
   * innate triple shot and Tainted Keeper a quadruple.
   */
  shotsPerVolley: number;
  speed: number;
  range: number;
  shotSpeed: number;
  luck: number;
}

/**
 * Accumulated modifiers from every item in a build.
 *
 * Kept as a flat bag of channels so that adding an item is a pure fold and
 * the order items were picked up in cannot change the result.
 */
export interface StatMods {
  /** Damage ups that feed the sqrt (the overwhelming majority). */
  damageUps: number;
  /**
   * Scales the damage-up SUM before the square root, not final damage.
   *
   * Odd Mushroom (Thin) is "x0.9 total damage up multiplier", which the wiki
   * is explicit is "not a total damage multiplier" -- it applies only to
   * standard damage ups, i.e. inside the sqrt. Worth a distinct channel
   * because its effect shrinks as the sqrt flattens.
   */
  damageUpMultipliers: number[];
  /** Damage ups applied after the sqrt, e.g. Polyphemus' +4. */
  flatDamage: number;
  /** Freely multiplicative damage multipliers. */
  damageMultipliers: number[];
  /**
   * The 1.5x group (Cricket's Head, Magic Mushroom, Blood of the
   * Martyr + Book of Belial). These do NOT stack with each other: holding
   * several still yields 1.5x total.
   */
  nonStackingMultipliers: number[];
  /** Additive to the hidden Tears stat T. */
  tears: number;
  /** Additive directly to tear delay, bypassing T. */
  tearDelay: number;
  /** S in the fire rate formula: direct +/- tears per second. */
  fireRateAdd: number;
  /** P in the fire rate formula: direct fire rate multipliers. */
  fireRateMultipliers: number[];
  /** Multiplicative on tear delay, e.g. Brimstone's "Tear Delay x 3". */
  tearDelayMultipliers: number[];
  speed: number;
  range: number;
  shotSpeed: number;
  luck: number;
  /**
   * Multiplies projectiles per volley: 20/20 fires 2, The Inner Eye 3,
   * Mutant Spider 4. These combine multiplicatively (Diplopia + Inner Eye
   * gives 6) up to MAX_SHOTS_PER_VOLLEY.
   *
   * Deliberately NOT part of the damage or fire rate channels: damage is
   * reported per tear and fire rate per volley, which is what the in-game
   * stat screen shows. Shot count only enters DPS.
   */
  shotMultipliers: number[];
  /** Multiplicative channels. Cricket's Body is "0.8x range multiplier". */
  speedMultipliers: number[];
  rangeMultipliers: number[];
  shotSpeedMultipliers: number[];
}

export interface ComputedStats {
  /** Damage per tear, as shown on the stat screen. */
  damage: number;
  /** Volleys per second, as shown on the stat screen. */
  fireRate: number;
  /** Projectiles per volley. Multiplies DPS without changing damage/tears. */
  shotsPerVolley: number;
  /** Internal tear delay, in 1/30s units. */
  tearDelay: number;
  speed: number;
  range: number;
  shotSpeed: number;
  luck: number;
  /**
   * damage * fireRate * shotsPerVolley.
   *
   * The shot count matters: 20/20 is a 0.8x damage multiplier but fires two
   * tears, so it is a DPS gain despite each tear hitting softer.
   */
  dps: number;
}

export function emptyMods(): StatMods {
  return {
    damageUps: 0,
    damageUpMultipliers: [],
    flatDamage: 0,
    damageMultipliers: [],
    nonStackingMultipliers: [],
    tears: 0,
    tearDelay: 0,
    fireRateAdd: 0,
    fireRateMultipliers: [],
    tearDelayMultipliers: [],
    shotMultipliers: [],
    speed: 0,
    range: 0,
    shotSpeed: 0,
    luck: 0,
    speedMultipliers: [],
    rangeMultipliers: [],
    shotSpeedMultipliers: [],
  };
}

/** Sums a list of partial modifier bags into one. */
export function mergeMods(parts: Partial<StatMods>[]): StatMods {
  const out = emptyMods();
  for (const p of parts) {
    out.damageUps += p.damageUps ?? 0;
    out.flatDamage += p.flatDamage ?? 0;
    out.tears += p.tears ?? 0;
    out.tearDelay += p.tearDelay ?? 0;
    out.fireRateAdd += p.fireRateAdd ?? 0;
    out.speed += p.speed ?? 0;
    out.range += p.range ?? 0;
    out.shotSpeed += p.shotSpeed ?? 0;
    out.luck += p.luck ?? 0;
    if (p.damageUpMultipliers)
      out.damageUpMultipliers.push(...p.damageUpMultipliers);
    if (p.damageMultipliers) out.damageMultipliers.push(...p.damageMultipliers);
    if (p.nonStackingMultipliers)
      out.nonStackingMultipliers.push(...p.nonStackingMultipliers);
    if (p.fireRateMultipliers)
      out.fireRateMultipliers.push(...p.fireRateMultipliers);
    if (p.tearDelayMultipliers)
      out.tearDelayMultipliers.push(...p.tearDelayMultipliers);
    if (p.shotMultipliers) out.shotMultipliers.push(...p.shotMultipliers);
    if (p.speedMultipliers) out.speedMultipliers.push(...p.speedMultipliers);
    if (p.rangeMultipliers) out.rangeMultipliers.push(...p.rangeMultipliers);
    if (p.shotSpeedMultipliers)
      out.shotSpeedMultipliers.push(...p.shotSpeedMultipliers);
  }
  return out;
}

const product = (xs: number[]): number => xs.reduce((a, b) => a * b, 1);

/**
 * The four-case piecewise tear delay function.
 *
 * Note the middle-negative case subtracts `6 * T` on top of the sqrt term,
 * which makes small tears-downs bite harder than the symmetric reading of
 * the formula would suggest.
 */
export function tearDelayFromTears(tears: number): number {
  if (tears > TEARS_CAP) return 5;
  if (tears >= 0) return 16 - 6 * Math.sqrt(tears * 1.3 + 1);
  if (tears > TEARS_LINEAR_BOUNDARY)
    return 16 - 6 * Math.sqrt(tears * 1.3 + 1) - 6 * tears;
  return 16 - 6 * tears;
}

function clamp(v: number, { min, max }: { min: number; max: number }): number {
  return Math.min(Math.max(v, min), max);
}

/** Product of the damage multiplier channels, applying the 1.5x group rule. */
export function damageMultiplier(mods: StatMods): number {
  const free = product(mods.damageMultipliers);
  // The non-stacking group collapses to its single largest member.
  const group = mods.nonStackingMultipliers.length
    ? Math.max(...mods.nonStackingMultipliers)
    : 1;
  return free * group;
}

export function computeStats(base: BaseStats, mods: StatMods): ComputedStats {
  const charBase = base.damage * base.damageMultiplier;

  // Guard the sqrt domain. The term goes negative once total damage ups fall
  // below -1/1.2, which is reachable by stacking damage-down items, and
  // Math.sqrt would return NaN and poison every downstream number. The wiki
  // documents no damage floor, so this clamp is ours: it bottoms the
  // multiplicative part out at zero, leaving flat damage intact.
  // The damage-up multiplier scales the ups themselves, before the sqrt.
  const effectiveUps = mods.damageUps * product(mods.damageUpMultipliers);
  const damageUpTerm = Math.max(0, effectiveUps * 1.2 + 1);

  const damage =
    (charBase * Math.sqrt(damageUpTerm) + mods.flatDamage) *
    damageMultiplier(mods);

  // Tear delay multiplies BEFORE adding. The wiki states Haemolacria as
  // "Tear Delay x 2 + 11", which is only consistent with that order --
  // add-then-multiply would give 42 instead of 31 at base.
  const tearDelay = clamp(
    tearDelayFromTears(base.tears + mods.tears) *
      product(mods.tearDelayMultipliers) +
      mods.tearDelay,
    LIMITS.tearDelay,
  );

  // Documented ordering (wiki "Tear delay"): "Fire rate increases are applied
  // before fire rate multipliers, so with a multiplier of 2, a +1 fire rate
  // addition will increase fire rate by 2." The character's innate multiplier
  // is part of P and so also lands after the additive modifiers.
  const fireRate = Math.max(
    0,
    (30 / (tearDelay + 1) + mods.fireRateAdd) *
      product(mods.fireRateMultipliers) *
      base.fireRateMultiplier,
  );

  const shotsPerVolley = Math.min(
    MAX_SHOTS_PER_VOLLEY,
    Math.max(1, base.shotsPerVolley * product(mods.shotMultipliers)),
  );

  return {
    damage,
    fireRate,
    shotsPerVolley,
    tearDelay,
    // Ordering for these three is NOT documented anywhere on the wiki. We
    // follow the one documented precedent (fire rate: adds, then multipliers)
    // rather than guessing differently per stat. If an item ever disagrees,
    // this is the assumption to revisit.
    speed: clamp(
      (base.speed + mods.speed) * product(mods.speedMultipliers),
      LIMITS.speed,
    ),
    range: clamp(
      (base.range + mods.range) * product(mods.rangeMultipliers),
      LIMITS.range,
    ),
    shotSpeed: clamp(
      (base.shotSpeed + mods.shotSpeed) * product(mods.shotSpeedMultipliers),
      LIMITS.shotSpeed,
    ),
    luck: clamp(base.luck + mods.luck, LIMITS.luck),
    dps: damage * fireRate * shotsPerVolley,
  };
}
