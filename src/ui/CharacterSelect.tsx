import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types";

interface Props {
  characters: Character[];
  onPick: (c: Character) => void;
}

/**
 * Arcade-style roster grid.
 *
 * Replaces an earlier coverflow carousel: with 34 characters, scrolling to
 * find one was the wrong trade. Everything is on screen at once, split into
 * the normal and tainted rosters, which also happens to mirror how the game
 * presents them.
 *
 * Keyboard moves within and between the two grids as if they were one
 * continuous field, so arrow keys never dead-end.
 */
export function CharacterSelect({ characters, onPick }: Props) {
  const rosters = useMemo(
    () => ({
      normal: characters.filter((c) => !c.tainted),
      tainted: characters.filter((c) => c.tainted),
    }),
    [characters],
  );

  // One flat ordering for keyboard navigation: normal roster then tainted.
  const flat = useMemo(
    () => [...rosters.normal, ...rosters.tainted],
    [rosters],
  );

  const [cursor, setCursor] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const focused = flat[cursor] ?? flat[0];

  // Columns are driven by CSS; read the real count back so Up/Down move by
  // a visual row rather than a guessed constant.
  const columnsOf = useCallback((section: "normal" | "tainted") => {
    const el = gridRef.current?.querySelector(
      `[data-roster="${section}"]`,
    ) as HTMLElement | null;
    if (!el) return 9;
    const styles = getComputedStyle(el);
    return styles.gridTemplateColumns.split(" ").filter(Boolean).length || 9;
  }, []);

  const move = useCallback(
    (delta: number) =>
      setCursor((i) => Math.min(Math.max(i + delta, 0), flat.length - 1)),
    [flat.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inTainted = cursor >= rosters.normal.length;
      const cols = columnsOf(inTainted ? "tainted" : "normal");
      switch (e.key) {
        case "ArrowLeft":
          move(-1);
          break;
        case "ArrowRight":
          move(1);
          break;
        case "ArrowUp":
          move(-cols);
          break;
        case "ArrowDown":
          move(cols);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onPick(flat[cursor]);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, flat, move, onPick, rosters.normal.length, columnsOf]);

  return (
    <div className="select">
      <header className="select-head">
        <h1>Choose Your Character</h1>
        <p className="sub">
          Repentance+ &middot; {characters.length} characters
        </p>
      </header>

      <div className="select-body" ref={gridRef}>
        <div className="select-grids">
          {(
            [
              ["normal", "Characters", rosters.normal],
              ["tainted", "Tainted", rosters.tainted],
            ] as const
          ).map(([key, label, list]) => (
            <section className="roster-block" key={key}>
              <h2 className={`roster-label roster-label--${key}`}>
                {label} <span className="roster-count">{list.length}</span>
              </h2>
              <div className="portrait-grid" data-roster={key}>
                {list.map((c) => {
                  const idx = flat.indexOf(c);
                  return (
                    <button
                      key={c.page}
                      className={`portrait${
                        idx === cursor ? " is-focused" : ""
                      }${c.tainted ? " is-tainted" : ""}`}
                      onClick={() =>
                        idx === cursor ? onPick(c) : setCursor(idx)
                      }
                      onDoubleClick={() => onPick(c)}
                      onMouseEnter={() => setCursor(idx)}
                      aria-label={c.name}
                      title={c.name}
                    >
                      {c.sprite ? (
                        <img src={c.sprite} alt="" />
                      ) : (
                        <span className="portrait-missing">?</span>
                      )}
                      <span className="portrait-name">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="select-detail">
          <div className="detail-portrait">
            {focused.sprite && <img src={focused.sprite} alt="" />}
          </div>
          <h2>{focused.name}</h2>

          <div className="detail-tags">
            {focused.dual && (
              <span className="pill pill--dual">
                {focused.forms.map((f) => f.name).join(" / ")}
              </span>
            )}
            {focused.variableStats && (
              <span className="pill pill--warn">randomised stats</span>
            )}
            {focused.base.shotsPerVolley > 1 && (
              <span className="pill">
                {focused.base.shotsPerVolley}x shot
              </span>
            )}
            {focused.base.fireRateMultiplier !== 1 && (
              <span className="pill pill--warn">
                x{focused.base.fireRateMultiplier.toFixed(2)} fire rate
              </span>
            )}
          </div>

          <dl className="base-stats">
            <Stat
              label="Damage"
              value={fmt(
                focused.base.damage * focused.base.damageMultiplier,
              )}
            />
            <Stat label="Tears" value={fmt(focused.base.tears, true)} />
            <Stat label="Speed" value={fmt(focused.base.speed)} />
            <Stat label="Range" value={fmt(focused.base.range)} />
            <Stat label="Shot Speed" value={fmt(focused.base.shotSpeed)} />
            <Stat label="Luck" value={fmt(focused.base.luck, true)} />
          </dl>

          {focused.health && (
            <p className="detail-line">
              <span className="detail-label">Health</span>
              {focused.health}
            </p>
          )}
          {focused.startingItems.length > 0 && (
            <p className="detail-line">
              <span className="detail-label">Starts with</span>
              {focused.startingItems.join(", ")}
            </p>
          )}

          <button className="btn btn--primary" onClick={() => onPick(focused)}>
            Build as {focused.name}
          </button>
          <p className="hint">Arrow keys to move &middot; Enter to select</p>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="base-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function fmt(n: number, signed = false): string {
  const s = n.toFixed(2);
  return signed && n > 0 ? `+${s}` : s;
}
