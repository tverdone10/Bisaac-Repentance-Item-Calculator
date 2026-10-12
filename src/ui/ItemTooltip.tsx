import type { Item } from "../types";

const STAT_LABELS: Record<string, string> = {
  damageUps: "Damage",
  flatDamage: "Flat damage",
  tears: "Tears",
  tearDelay: "Tear delay",
  fireRateAdd: "Fire rate",
  speed: "Speed",
  range: "Range",
  shotSpeed: "Shot speed",
  luck: "Luck",
};

const MULT_LABELS: Record<string, string> = {
  damageMultipliers: "Damage",
  nonStackingMultipliers: "Damage (non-stacking)",
  fireRateMultipliers: "Fire rate",
  tearDelayMultipliers: "Tear delay",
  speedMultipliers: "Speed",
  rangeMultipliers: "Range",
  shotSpeedMultipliers: "Shot speed",
};

/** Human-readable summary of an item's stat modifiers. */
export function modSummary(item: Item): string[] {
  const out: string[] = [];
  for (const [key, label] of Object.entries(STAT_LABELS)) {
    const v = item.mods[key as keyof typeof item.mods] as number;
    if (typeof v === "number" && v !== 0) {
      out.push(`${v > 0 ? "+" : ""}${round(v)} ${label}`);
    }
  }
  for (const [key, label] of Object.entries(MULT_LABELS)) {
    const v = item.mods[key as keyof typeof item.mods] as number[];
    if (Array.isArray(v)) {
      for (const m of v) out.push(`${round(m)}x ${label}`);
    }
  }
  return out;
}

function round(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

export function ItemTooltip({ item }: { item: Item }) {
  const mods = modSummary(item);
  return (
    <div className="tooltip">
      <div className="tooltip-head">
        {item.sprite && <img src={item.sprite} alt="" className="tt-sprite" />}
        <div>
          <strong className="tt-name">{item.name}</strong>
          <div className="tt-meta">
            <span className={`tt-kind tt-kind--${item.kind}`}>{item.kind}</span>
            {item.quality !== null && (
              <span className="tt-quality">quality {item.quality}</span>
            )}
            {item.id !== null && <span className="tt-id">#{item.id}</span>}
            {item.stacking !== "full" && (
              <span className="tt-stack">
                {item.stacking === "none"
                  ? "copies don't stack"
                  : "copies give less"}
              </span>
            )}
          </div>
        </div>
      </div>

      {item.quote && <p className="tt-quote">&ldquo;{item.quote}&rdquo;</p>}
      {item.description && <p className="tt-desc">{item.description}</p>}

      {mods.length > 0 && (
        <ul className="tt-mods">
          {mods.map((m) => (
            <li key={m} className={m.startsWith("-") ? "is-down" : "is-up"}>
              {m}
            </li>
          ))}
        </ul>
      )}

      {!item.hasStats && item.conditionalEffects.length === 0 && (
        <p className="tt-nostats">No effect on tracked stats</p>
      )}

      {item.dpsNote && (
        <p className="tt-dps">DPS not meaningful: {item.dpsNote}</p>
      )}

      {item.conditionalEffects.length > 0 && (
        <details className="tt-details tt-details--cond" open>
          <summary>
            Conditional, not counted ({item.conditionalEffects.length})
          </summary>
          <ul>
            {item.conditionalEffects.slice(0, 6).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {item.recharge && (
        <p className="tt-line">
          <span className="tt-label">Recharge</span> {item.recharge}
        </p>
      )}

      {item.effects.length > 0 && (
        <details className="tt-details">
          <summary>Effects ({item.effects.length})</summary>
          <ul>
            {item.effects.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {item.synergies.length > 0 && (
        <details className="tt-details">
          <summary>Synergies ({item.synergies.length})</summary>
          <ul>
            {item.synergies.slice(0, 10).map((e, i) => (
              <li key={i}>
                {e.group && <span className="tt-group">{e.group}: </span>}
                {e.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {item.interactions.length > 0 && (
        <details className="tt-details">
          <summary>Interactions ({item.interactions.length})</summary>
          <ul>
            {item.interactions.slice(0, 12).map((e, i) => (
              <li key={i}>
                {e.group && <span className="tt-group">{e.group}: </span>}
                {e.text}
              </li>
            ))}
          </ul>
        </details>
      )}

      {item.needsReview.length > 0 && (
        <p className="tt-review">
          {item.needsReview.length} effect line
          {item.needsReview.length === 1 ? "" : "s"} not yet modelled
        </p>
      )}
    </div>
  );
}
