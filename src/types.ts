import type { BaseStats, StatMods } from "./engine/stats";

/** One form of a character. Dual characters (Jacob/Esau) have two. */
export interface CharacterForm {
  name: string;
  base: BaseStats;
  health: string;
  /** True for Eden-style randomised stats, which can't be one number. */
  variableStats: boolean;
}

export interface Character {
  /**
   * The wiki infobox's "id" field, which is an internal file index rather
   * than the game's PlayerType -- Isaac reads 14, Cain and Magdalene both
   * read 2. Kept for traceability; do not sort or identify by it.
   */
  wikiFileId: number | null;
  /** Character-select order as the game presents it. */
  order: number;
  name: string;
  page: string;
  sprite: string | null;
  /** Primary form's stats, promoted for convenience. */
  base: BaseStats;
  health: string;
  forms: CharacterForm[];
  dual: boolean;
  startingItems: string[];
  pickups: string;
  variableStats: boolean;
  /** Set when the character's innate fire rate multiplier is conditional. */
  conditionalFireRate: string | null;
  tainted: boolean;
  dlc: string | null;
}

export interface InteractionLine {
  /** The wiki's group heading, e.g. "Overridden by Brimstone". */
  group: string | null;
  text: string;
}

/**
 * How an item behaves when held more than once.
 *
 * "full" adds its mods again, "none" means extra copies do nothing, and
 * "diminished" means extra copies contribute `repeatMods` instead.
 */
export type Stacking = "full" | "none" | "diminished";

export type ItemKind = "passive" | "active" | "trinket";

/** A mutually exclusive variant of an item's effect (Purity's colours). */
export interface ItemVariant {
  /** "Red", "Quality 3", ... */
  label: string;
  mods: StatMods;
}

/** An item whose bonus scales with a countable game quantity. */
export interface ScaledEffect {
  /** What the player must tell us: "coins held", "Bone Hearts lost", ... */
  quantity: string;
  /** Mods granted per unit of that quantity. */
  per: StatMods;
  /** Maximum units that count, if the wiki states one. */
  max: number | null;
  /** The wiki line this came from. */
  source: string;
}

export interface Item {
  id: number | null;
  name: string;
  page: string;
  sprite: string | null;
  kind: ItemKind;
  /** The in-game flavour text shown on pickup. */
  quote: string;
  description: string;
  quality: number | null;
  tags: string[];
  recharge: string | null;
  pools: string[];
  devilPrice: string | null;
  shopPrice: string | null;
  effects: string[];
  /**
   * Documented synergies and interactions, filtered to Repentance+ and
   * tagged with the wiki's group heading where there is one. The heading
   * carries the meaning: a bare item name under "Overridden by Brimstone"
   * means something very different from one under "Other interactions".
   */
  synergies: InteractionLine[];
  interactions: InteractionLine[];
  mods: StatMods;
  stacking: Stacking;
  /** Mutually exclusive variants; pick one rather than summing. */
  variants: ItemVariant[];
  /** Set when the item's bonus scales with a game quantity. */
  scaled: ScaledEffect | null;
  /** What each copy beyond the first contributes. */
  repeatMods: StatMods;
  /** True when the item replaces Isaac's tears outright. */
  replacesTears: boolean;
  /**
   * Set when damage x fire rate doesn't describe this item's real output
   * (continuous lasers, contact damage, explosions). Explains why.
   */
  dpsNote: string | null;
  /**
   * Stat changes that only apply under some condition, so they are
   * deliberately NOT in `mods`. Surfaced so the omission is visible.
   */
  conditionalEffects: string[];
  /** False for items with no effect on any tracked stat. */
  hasStats: boolean;
  /** Numeric effect lines the parser couldn't interpret. */
  needsReview: string[];
  /** Set when a hand-verified override supplied the mods. */
  overrideReason: string | null;
}
