import charactersRaw from "./characters.json";
import itemsRaw from "./items.json";
import trinketsRaw from "./trinkets.json";
import type { Character, Item } from "../types";

export const characters = charactersRaw as unknown as Character[];

/** Collectibles and trinkets in one list; `kind` distinguishes them. */
export const items = [
  ...(itemsRaw as unknown as Item[]),
  ...(trinketsRaw as unknown as Item[]),
];

export const itemsByPage = new Map(items.map((i) => [i.page, i]));

/**
 * Transformation groups, keyed by the item tag the game uses internally.
 *
 * Owning three items carrying the same tag triggers the transformation. The
 * tags come straight from the wiki's item metadata, so this needs no
 * per-item curation.
 */
export const TRANSFORMATIONS: Record<string, string> = {
  guppy: "Guppy",
  fly: "Beelzebub",
  mushroom: "Fun Guy",
  angel: "Seraphim",
  bob: "Bob",
  syringe: "Spun",
  mom: "Yes Mother?",
  devil: "Leviathan",
  poop: "Oh Crap",
  book: "Bookworm",
  spider: "Spider Baby",
  baby: "Conjoined",
};

export const TRANSFORMATION_THRESHOLD = 3;

/** Search haystack per item, built once. */
const haystack = new Map(
  items.map((i) => [
    i.page,
    [i.name, i.description, i.quote, i.tags.join(" ")]
      .join(" ")
      .toLowerCase(),
  ]),
);

export function searchItems(query: string, pool: Item[] = items): Item[] {
  const q = query.trim().toLowerCase();
  if (!q) return pool;
  const terms = q.split(/\s+/);
  return pool.filter((i) => {
    const hay = haystack.get(i.page) ?? "";
    return terms.every((t) => hay.includes(t));
  });
}
