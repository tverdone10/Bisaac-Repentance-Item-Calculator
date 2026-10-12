import { useMemo, useState } from "react";
import { items as allItems, searchItems } from "../data";
import {
  buildHealth,
  buildInteractions,
  buildStats,
  statDeltas,
  transformations,
  type Build,
} from "../engine/build";
import type { Item, ItemKind } from "../types";
import { BuildHud } from "./BuildHud";
import { ItemTooltip, modSummary } from "./ItemTooltip";

interface Props {
  build: Build;
  setBuild: (b: Build) => void;
  onBack: () => void;
}

/**
 * Filters are two independent axes, not one list.
 *
 * "Passive / Active / Trinket" is how you hold an item; "stat-affecting" is
 * whether it moves the numbers. They were originally one mutually exclusive
 * row, which made the most useful query -- passives that actually affect
 * stats, 138 of them -- impossible to express. 25% of passives affect stats
 * and 5% of actives do, so neither implies the other.
 */
type KindFilter = "all" | ItemKind;

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "passive", label: "Passive" },
  { key: "active", label: "Active" },
  { key: "trinket", label: "Trinket" },
];

// Damage is per tear and Tears is volleys/second -- both as the in-game stat
// screen reports them. Shot count is kept separate and only enters DPS.
// Only the heart kinds worth showing a row for; the rest stay at zero for
// almost every build and would just be noise.
const HEART_ROWS: [keyof import("../types").Hearts, string, string][] = [
  ["red", "Red", "is-red"],
  ["soul", "Soul", "is-soul"],
  ["black", "Black", "is-black"],
  ["bone", "Bone", "is-bone"],
  ["coin", "Coin", "is-coin"],
  ["broken", "Broken", "is-broken"],
];

const STAT_ROWS = [
  { key: "damage", label: "Damage", decimals: 2, hint: "per tear" },
  { key: "fireRate", label: "Tears", decimals: 2, hint: "volleys/sec" },
  { key: "shotsPerVolley", label: "Shots", decimals: 0, hint: "per volley" },
  { key: "dps", label: "DPS", decimals: 2, emphasis: true },
  { key: "speed", label: "Speed", decimals: 2 },
  { key: "range", label: "Range", decimals: 2 },
  { key: "shotSpeed", label: "Shot Speed", decimals: 2 },
  { key: "luck", label: "Luck", decimals: 1 },
] as const;

export function Builder({ build, setBuild, onBack }: Props) {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statsOnly, setStatsOnly] = useState(false);
  const [pool, setPool] = useState<string>("");
  const [hovered, setHovered] = useState<Item | null>(null);

  const picked = useMemo(
    () =>
      build.picked
        .map((page) => allItems.find((i) => i.page === page))
        .filter((i): i is Item => Boolean(i)),
    [build.picked],
  );

  // Every pool label present in the data, for the dropdown.
  const poolNames = useMemo(
    () => [...new Set(allItems.flatMap((i) => i.pools))].sort(),
    [],
  );

  const results = useMemo(() => {
    let p = allItems;
    if (kindFilter !== "all") p = p.filter((i) => i.kind === kindFilter);
    if (statsOnly) p = p.filter((i) => i.hasStats);
    if (pool) p = p.filter((i) => i.pools.includes(pool));
    return searchItems(query, p);
  }, [query, kindFilter, statsOnly, pool]);

  const health = buildHealth(build, picked);
  const stats = buildStats(build, picked);
  const deltas = statDeltas(build, picked);
  const transforms = transformations(picked);
  const form = build.character.forms[build.formIndex] ?? build.character.forms[0];

  // Reasons the DPS figure shouldn't be trusted for this build. Azazel is
  // included because his innate Brimstone has the same problem as the item.
  const dpsCaveats = [
    ...(build.character.name.includes("Azazel")
      ? ["Azazel: short-range Brimstone laser, ticks rather than shoots"]
      : []),
    ...picked
      .filter((i) => i.dpsNote)
      .map((i) => `${i.name}: ${i.dpsNote}`),
  ];
  const uniqueCaveats = [...new Set(dpsCaveats)];

  // Stat changes we deliberately left out because they're conditional.
  const conditional = picked.filter((i) => i.conditionalEffects.length > 0);

  // How many copies of each item are held, for the duplicate flags.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of picked) m.set(i.page, (m.get(i.page) ?? 0) + 1);
    return m;
  }, [picked]);

  // Items in the build that need an input from the player.
  const tunable = useMemo(
    () =>
      [...new Map(picked.map((i) => [i.page, i])).values()].filter(
        (i) => i.variants.length > 0 || i.scaled,
      ),
    [picked],
  );

  // Documented interactions between items actually in the build.
  const interactions = useMemo(() => buildInteractions(picked), [picked]);

  const add = (item: Item) =>
    setBuild({ ...build, picked: [...build.picked, item.page] });

  const removeAt = (idx: number) =>
    setBuild({
      ...build,
      picked: build.picked.filter((_, i) => i !== idx),
    });

  return (
    <div className="builder">
      <aside className="panel panel--stats">
        <button className="btn btn--ghost btn--back" onClick={onBack}>
          &larr; Roster
        </button>

        <div className="who">
          {build.character.sprite && (
            <img src={build.character.sprite} alt="" className="who-sprite" />
          )}
          <div>
            <h2>{build.character.name}</h2>
            {build.character.dual && (
              <div className="form-switch">
                {build.character.forms.map((f, i) => (
                  <button
                    key={f.name}
                    className={`chip${i === build.formIndex ? " is-on" : ""}`}
                    onClick={() => setBuild({ ...build, formIndex: i })}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <BuildHud character={build.character} picked={picked} />

        {form.variableStats && (
          <p className="warn">
            This character's base stats are randomised; values shown use the
            wiki's listed midpoint.
          </p>
        )}

        <dl className="stats">
          {STAT_ROWS.map((row) => {
            const value = stats[row.key];
            const delta = deltas[row.key];
            return (
              <div
                key={row.key}
                className={`stat-row${
                  "emphasis" in row && row.emphasis ? " is-emphasis" : ""
                }${
                  row.key === "dps" && uniqueCaveats.length ? " is-unreliable" : ""
                }`}
              >
                <dt>
                  {row.label}
                  {"hint" in row && row.hint && (
                    <span className="stat-hint">{row.hint}</span>
                  )}
                </dt>
                <dd>
                  <span className="stat-value">
                    {value.toFixed(row.decimals)}
                  </span>
                  {Math.abs(delta) > 0.0001 && row.key !== "shotsPerVolley" && (
                    <span
                      className={`stat-delta ${delta > 0 ? "is-up" : "is-down"}`}
                    >
                      {delta > 0 ? "+" : ""}
                      {delta.toFixed(row.decimals)}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <p className="tear-delay">
          tear delay {stats.tearDelay.toFixed(2)}
        </p>

        {uniqueCaveats.length > 0 && (
          <div className="caveat caveat--dps">
            <h3>DPS not meaningful here</h3>
            <ul>
              {uniqueCaveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="caveat-note">
              Damage and tears above are still correct; multiplying them
              isn&rsquo;t how these deal damage.
            </p>
          </div>
        )}

        {build.character.conditionalFireRate && (
          <p className="warn">
            {build.character.name} has a conditional fire rate modifier
            ({build.character.conditionalFireRate}) that is not applied.
          </p>
        )}

        {conditional.length > 0 && (
          <div className="caveat">
            <h3>Conditional effects not counted</h3>
            <ul>
              {conditional.slice(0, 6).map((i) => (
                <li key={i.page}>
                  <strong>{i.name}</strong> {i.conditionalEffects[0]}
                </li>
              ))}
            </ul>
            {conditional.length > 6 && (
              <p className="caveat-note">
                and {conditional.length - 6} more
              </p>
            )}
          </div>
        )}

        <div className="health">
          <h3>
            Health
            <button
              className="health-reset"
              onClick={() => setBuild({ ...build, healthDelta: {} })}
              title="Clear manual adjustments"
            >
              reset
            </button>
          </h3>
          <div className="heart-rows">
            {HEART_ROWS.map(([kind, label, cls]) => (
              <div key={kind} className="heart-row">
                <span className={`heart-dot ${cls}`} />
                <span className="heart-label">{label}</span>
                <span className="heart-count">{health[kind]}</span>
                <span className="heart-ctl">
                  <button
                    onClick={() =>
                      setBuild({
                        ...build,
                        healthDelta: {
                          ...build.healthDelta,
                          [kind]: (build.healthDelta[kind] ?? 0) - 1,
                        },
                      })
                    }
                    title={`Spend a ${label.toLowerCase()} (Devil deal, damage taken)`}
                  >
                    &minus;
                  </button>
                  <button
                    onClick={() =>
                      setBuild({
                        ...build,
                        healthDelta: {
                          ...build.healthDelta,
                          [kind]: (build.healthDelta[kind] ?? 0) + 1,
                        },
                      })
                    }
                  >
                    +
                  </button>
                </span>
              </div>
            ))}
          </div>
          {form.hearts.unknown === -1 && (
            <p className="caveat-note">
              {build.character.name}&rsquo;s starting health is randomised;
              adjust manually.
            </p>
          )}
        </div>

        {tunable.length > 0 && (
          <div className="tuning">
            <h3>Build inputs</h3>
            {tunable.map((item) => (
              <div key={item.page} className="tune">
                <span className="tune-name">{item.name}</span>
                {item.variants.length > 0 && (
                  <select
                    className="tune-select"
                    value={build.variants[item.page] ?? 0}
                    onChange={(e) =>
                      setBuild({
                        ...build,
                        variants: {
                          ...build.variants,
                          [item.page]: Number(e.target.value),
                        },
                      })
                    }
                  >
                    {item.variants.map((v, i) => (
                      <option key={v.label} value={i}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                )}
                {item.scaled && (
                  <label className="tune-num">
                    <input
                      type="number"
                      min={0}
                      max={item.scaled.max ?? undefined}
                      value={build.scaled[item.page] ?? 0}
                      onChange={(e) =>
                        setBuild({
                          ...build,
                          scaled: {
                            ...build.scaled,
                            [item.page]: Number(e.target.value),
                          },
                        })
                      }
                    />
                    <span>{item.scaled.quantity}</span>
                  </label>
                )}
              </div>
            ))}
          </div>
        )}

        {interactions.length > 0 && (
          <div className="interactions">
            <h3>
              Interactions <span className="muted">{interactions.length}</span>
            </h3>
            <ul>
              {interactions.map((x, i) => (
                <li key={i} className={`int int--${x.kind}`}>
                  <span className="int-pair">
                    {x.from} <span className="int-arrow">+</span> {x.with}
                  </span>
                  {x.group && <span className="int-group">{x.group}</span>}
                  <span className="int-text">{x.text}</span>
                </li>
              ))}
            </ul>
            <p className="caveat-note">
              Documented on the wiki, not simulated &mdash; none of this is
              reflected in the numbers above.
            </p>
          </div>
        )}

        {transforms.length > 0 && (
          <div className="transforms">
            <h3>Transformations</h3>
            {transforms.map((t) => (
              <div
                key={t.tag}
                className={`transform${t.active ? " is-active" : ""}`}
              >
                <span>{t.name}</span>
                <span className="transform-count">{t.count}/3</span>
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="panel panel--picker">
        <div className="picker-head">
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${allItems.length} items and trinkets...`}
            autoFocus
          />
          <div className="filters">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.key}
                className={`chip${kindFilter === f.key ? " is-on" : ""}`}
                onClick={() => setKindFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <span className="filter-sep" />
            <button
              className={`chip${statsOnly ? " is-on" : ""}`}
              onClick={() => setStatsOnly((v) => !v)}
              title="Only items with a modelled stat effect"
            >
              Stat-affecting
            </button>
            <select
              className="pool-select"
              value={pool}
              onChange={(e) => setPool(e.target.value)}
            >
              <option value="">Any pool</option>
              {poolNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <p className="count">{results.length} shown</p>
        </div>

        <div className="item-grid" onMouseLeave={() => setHovered(null)}>
          {results.map((item) => {
            const held = counts.has(item.page);
            return (
            <button
              key={item.page}
              className={`item-cell${item.hasStats ? " has-stats" : ""}${
                held ? " is-held" : ""
              }`}
              onClick={() => !held && add(item)}
              onMouseEnter={() => setHovered(item)}
              onFocus={() => setHovered(item)}
              disabled={held}
              title={held ? `${item.name} (already in build)` : item.name}
            >
              {item.sprite ? (
                <img src={item.sprite} alt="" />
              ) : (
                <span className="no-sprite">?</span>
              )}
            </button>
            );
          })}
          {results.length === 0 && (
            <p className="empty">Nothing matches &ldquo;{query}&rdquo;</p>
          )}
        </div>
      </main>

      <aside className="panel panel--side">
        <div className="inventory">
          <h3>
            Inventory <span className="muted">{picked.length}</span>
          </h3>
          {picked.length === 0 ? (
            <p className="empty-inv">
              Click items to add them. Duplicates stack.
            </p>
          ) : (
            <ul className="inv-list">
              {picked.map((item, idx) => (
                <li key={`${item.page}-${idx}`}>
                  <button
                    className="inv-item"
                    onClick={() => removeAt(idx)}
                    onMouseEnter={() => setHovered(item)}
                    title={`Remove ${item.name}`}
                  >
                    {item.sprite && <img src={item.sprite} alt="" />}
                    <span className="inv-name">
                      {item.name}
                      {counts.get(item.page)! > 1 &&
                        item.stacking !== "full" && (
                          <span className="inv-flag">
                            {item.stacking === "none"
                              ? "extra copies ignored"
                              : "extra copies reduced"}
                          </span>
                        )}
                    </span>
                    <span className="inv-mods">
                      {modSummary(item).slice(0, 2).join(", ")}
                    </span>
                    <span className="inv-x">&times;</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked.length > 0 && (
            <button
              className="btn btn--ghost"
              onClick={() => setBuild({ ...build, picked: [] })}
            >
              Clear all
            </button>
          )}
        </div>

        <div className="detail">
          {hovered ? (
            <ItemTooltip item={hovered} />
          ) : (
            <p className="empty-inv">Hover an item for details.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
