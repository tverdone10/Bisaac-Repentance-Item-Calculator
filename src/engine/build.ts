/** Build state -> computed stats, plus transformation detection. */

import {
  TRANSFORMATIONS,
  TRANSFORMATION_THRESHOLD,
} from "../data";
import type { Character, Hearts, Item } from "../types";
import {
  computeStats,
  emptyMods,
  mergeMods,
  type ComputedStats,
  type StatMods,
} from "./stats";

export interface Build {
  character: Character;
  /** Which form of a dual character the stats are shown for. */
  formIndex: number;
  /**
   * Item pages in pickup order. Duplicates are kept, and how they combine
   * depends on each item's `stacking` rule -- see buildMods.
   */
  picked: string[];
  /**
   * For items with mutually exclusive variants (Purity's colour, Abyss'
   * absorbed quality): item page -> chosen index. Missing means index 0.
   */
  variants: Record<string, number>;
  /**
   * For items whose bonus scales with a game quantity (coins held, Bone
   * Hearts lost): item page -> that quantity. Missing means 0.
   */
  scaled: Record<string, number>;
  /**
   * Manual health adjustment per heart kind, so you can spend containers on
   * Devil deals or account for damage taken. Added on top of the computed
   * starting + item total.
   */
  healthDelta: Partial<Record<keyof Hearts, number>>;
}

/** Character start + item grants + your manual adjustment. */
export function buildHealth(build: Build, picked: Item[]): Hearts {
  const form =
    build.character.forms[build.formIndex] ?? build.character.forms[0];
  const out: Hearts = { ...form.hearts };

  // Eden's start is randomised; the wiki gives an image, not values.
  const randomised = out.unknown === -1;
  if (randomised) out.unknown = 0;

  // Duplicates are disabled in the picker, so count each item once.
  for (const item of new Map(picked.map((i) => [i.page, i])).values()) {
    out.red += item.health.redContainers + item.health.emptyContainers;
    out.soul += item.health.soulHearts;
    out.black += item.health.blackHearts;
    out.bone += item.health.boneHearts;
    out.rotten += item.health.rottenHearts;
    out.eternal += item.health.eternalHearts;
    out.broken += item.health.brokenHearts;
  }

  for (const [kind, delta] of Object.entries(build.healthDelta)) {
    const key = kind as keyof Hearts;
    out[key] = Math.max(0, out[key] + (delta ?? 0));
  }
  return out;
}

export interface TransformationProgress {
  tag: string;
  name: string;
  count: number;
  active: boolean;
}

/**
 * Fold a pickup list into one modifier bag, respecting duplicate rules.
 *
 * A naive sum is wrong for items that say they don't stack: three Immaculate
 * Hearts would read as x1.728 damage instead of the x1.2 the wiki states.
 * Each item contributes its full mods once, then `repeatMods` for every
 * additional copy ("none" items supply zeroes there, "full" items supply
 * their own mods again).
 */
export interface BuildTuning {
  variants?: Record<string, number>;
  scaled?: Record<string, number>;
}

export function buildMods(picked: Item[], tuning: BuildTuning = {}): StatMods {
  if (picked.length === 0) return emptyMods();

  const counts = new Map<string, { item: Item; n: number }>();
  for (const item of picked) {
    const entry = counts.get(item.page);
    if (entry) entry.n += 1;
    else counts.set(item.page, { item, n: 1 });
  }

  const parts: Partial<StatMods>[] = [];
  for (const { item, n } of counts.values()) {
    parts.push(item.mods);
    for (let k = 1; k < n; k++) parts.push(item.repeatMods);

    // Exactly one variant contributes, never the sum of them.
    if (item.variants.length > 0) {
      const idx = tuning.variants?.[item.page] ?? 0;
      const chosen = item.variants[idx] ?? item.variants[0];
      parts.push(chosen.mods);
    }

    // Scaled bonuses contribute per unit of their driving quantity.
    if (item.scaled) {
      const raw = tuning.scaled?.[item.page] ?? 0;
      const units = item.scaled.max === null
        ? Math.max(0, raw)
        : Math.min(Math.max(0, raw), item.scaled.max);
      for (let k = 0; k < units; k++) parts.push(item.scaled.per);
    }
  }
  return mergeMods(parts);
}

export function buildStats(build: Build, picked: Item[]): ComputedStats {
  const form = build.character.forms[build.formIndex] ?? build.character.forms[0];
  return computeStats(
    form.base,
    buildMods(picked, { variants: build.variants, scaled: build.scaled }),
  );
}

/**
 * Transformation progress from item tags.
 *
 * Counts distinct items, not pickups: taking the same fly item twice does not
 * advance Beelzebub.
 */
export function transformations(picked: Item[]): TransformationProgress[] {
  const seen = new Map<string, Set<string>>();
  for (const item of picked) {
    for (const tag of item.tags) {
      if (!(tag in TRANSFORMATIONS)) continue;
      if (!seen.has(tag)) seen.set(tag, new Set());
      seen.get(tag)!.add(item.page);
    }
  }
  return [...seen.entries()]
    .map(([tag, pages]) => ({
      tag,
      name: TRANSFORMATIONS[tag],
      count: pages.size,
      active: pages.size >= TRANSFORMATION_THRESHOLD,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface BuildInteraction {
  /** The item whose wiki page documents this. */
  from: string;
  /** The other item in the build that it refers to. */
  with: string;
  group: string | null;
  text: string;
  kind: "synergy" | "interaction";
}

/** Escapes a literal string for use inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Documented interactions between items actually in the build.
 *
 * The wiki records these as prose on one item's page naming the other, so we
 * match partner names against the (small) set of picked items. Matching is
 * whole-phrase and word-bounded to limit false hits, but short names ("Tick",
 * "Terra", "Pop!") can still match incidental prose -- these are presented as
 * references to read, not as computed effects.
 *
 * Entries are one-directional by nature: whichever page an editor wrote it on
 * is where it lives, so A may reference B without B mentioning A.
 */
export function buildInteractions(picked: Item[]): BuildInteraction[] {
  const unique = [...new Map(picked.map((i) => [i.page, i])).values()];
  if (unique.length < 2) return [];

  // Longest names first so "Cricket's Head" wins over a shorter substring.
  const partners = [...unique].sort((a, b) => b.name.length - a.name.length);
  const out: BuildInteraction[] = [];
  const seen = new Set<string>();

  for (const item of unique) {
    const lines: [InteractionLineLike, BuildInteraction["kind"]][] = [
      ...item.synergies.map((l) => [l, "synergy" as const] as const),
      ...item.interactions.map((l) => [l, "interaction" as const] as const),
    ].map(([l, k]) => [l, k]);

    for (const [line, kind] of lines) {
      const mentions = (hay: string, name: string) =>
        new RegExp(`(^|[^\\w'])${escapeRe(name)}($|[^\\w'])`).test(hay);

      // Most lines name their subject before a colon ("Tiny Planet: the beam
      // wraps..."). When a subject exists it decides what the line is about:
      // if it names no item in the build, the line is about some third item
      // and merely mentions ours in passing, so it isn't our pair.
      const subject = subjectOf(line.text);
      let other: Item | undefined;
      if (subject !== null) {
        other = partners.find(
          (p) => p.page !== item.page && mentions(subject, p.name),
        );
        if (!other) continue;
      } else {
        other = partners.find(
          (p) => p.page !== item.page && mentions(line.text, p.name),
        );
        if (!other) continue;
      }

      const key = `${item.page}|${other.page}|${line.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        from: item.name,
        with: other.name,
        group: line.group,
        text: line.text,
        kind,
      });
    }
  }
  return out;
}

/**
 * The item-naming prefix of an interaction line, if it has one.
 *
 * "Tiny Planet + My Reflection: the beam..." -> "Tiny Planet + My Reflection"
 * "Blood beam now does poison damage..."     -> null (no subject)
 *
 * Only a short prefix counts; a colon deep in a sentence is punctuation, not
 * a subject marker.
 */
function subjectOf(text: string): string | null {
  const idx = text.indexOf(":");
  if (idx < 0 || idx > 70) return null;
  const head = text.slice(0, idx);
  // A subject is a list of names, not a clause.
  if (/\b(?:the|a|is|are|will|when|if|and then)\b/i.test(head)) {
    return / \/ |\+/.test(head) ? head : null;
  }
  return head;
}

type InteractionLineLike = { group: string | null; text: string };

/** Per-stat delta vs. the character's bare base, for the readout arrows. */
export function statDeltas(
  build: Build,
  picked: Item[],
): Record<keyof ComputedStats, number> {
  const form = build.character.forms[build.formIndex] ?? build.character.forms[0];
  const bare = computeStats(form.base, emptyMods());
  const now = buildStats(build, picked);
  const out = {} as Record<keyof ComputedStats, number>;
  for (const key of Object.keys(now) as (keyof ComputedStats)[]) {
    out[key] = now[key] - bare[key];
  }
  return out;
}
