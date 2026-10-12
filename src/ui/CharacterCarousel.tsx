import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../types";

interface Props {
  characters: Character[];
  onPick: (c: Character) => void;
}

/** How many neighbours stay rendered either side of the focused card. */
const VISIBLE = 4;

/**
 * A rotating coverflow roster.
 *
 * The whole thing is driven by one integer `index`; every card derives its
 * transform from its signed offset to that index. Wrapping is done on the
 * offset (not the index) so the ring is seamless in both directions without
 * duplicating the list.
 */
export function CharacterCarousel({ characters, onPick }: Props) {
  const [index, setIndex] = useState(0);
  const total = characters.length;
  const dragRef = useRef<{ x: number; index: number } | null>(null);
  const wheelLock = useRef(0);

  const move = useCallback(
    (delta: number) => setIndex((i) => (i + delta + total * 100) % total),
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "Enter") onPick(characters[index]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, onPick, characters, index]);

  /** Shortest signed distance from the focused index, e.g. 33 -> -1 of 34. */
  const offsetOf = (i: number) => {
    let d = i - index;
    if (d > total / 2) d -= total;
    if (d < -total / 2) d += total;
    return d;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - wheelLock.current < 120) return;
    wheelLock.current = now;
    move(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, index };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const steps = Math.round((drag.x - e.clientX) / 90);
    if (steps !== 0) {
      setIndex((drag.index + steps + total * 100) % total);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const focused = characters[index];

  return (
    <div className="roster">
      <header className="roster-head">
        <h1>Isaac Build Calculator</h1>
        <p className="sub">
          Repentance+ &middot; {total} characters &middot; pick one to start
        </p>
      </header>

      <div
        className="carousel"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="listbox"
        aria-label="Character roster"
        tabIndex={0}
      >
        <div className="carousel-stage">
          {characters.map((c, i) => {
            const off = offsetOf(i);
            if (Math.abs(off) > VISIBLE) return null;
            const abs = Math.abs(off);
            const style = {
              // Fan the cards out along an arc, shrinking and dimming with
              // distance so the focused one reads as the subject.
              transform: `
                translateX(${off * 118}px)
                translateZ(${-abs * 140}px)
                rotateY(${off * -22}deg)
                scale(${1 - abs * 0.1})
              `,
              opacity: abs > VISIBLE - 1 ? 0 : 1 - abs * 0.18,
              zIndex: 100 - abs,
              pointerEvents: abs > 2 ? ("none" as const) : ("auto" as const),
            };
            return (
              <button
                key={c.page}
                className={`char-card${off === 0 ? " is-focused" : ""}${
                  c.tainted ? " is-tainted" : ""
                }`}
                style={style}
                onClick={() => (off === 0 ? onPick(c) : setIndex(i))}
                role="option"
                aria-selected={off === 0}
                tabIndex={-1}
                title={c.name}
              >
                {c.sprite ? (
                  <img src={c.sprite} alt="" className="char-sprite" />
                ) : (
                  <span className="char-sprite char-sprite--missing">?</span>
                )}
                <span className="char-name">{c.name}</span>
              </button>
            );
          })}
        </div>

        <button
          className="carousel-arrow carousel-arrow--left"
          onClick={() => move(-1)}
          aria-label="Previous character"
        >
          &#8249;
        </button>
        <button
          className="carousel-arrow carousel-arrow--right"
          onClick={() => move(1)}
          aria-label="Next character"
        >
          &#8250;
        </button>
      </div>

      <div className="roster-detail">
        <div className="roster-detail-head">
          <h2>{focused.name}</h2>
          {focused.dual && (
            <span className="pill pill--dual">
              {focused.forms.map((f) => f.name).join(" / ")}
            </span>
          )}
          {focused.variableStats && (
            <span className="pill pill--warn">randomised stats</span>
          )}
        </div>

        <dl className="base-stats">
          <Stat label="Damage" value={fmt(focused.base.damage * focused.base.damageMultiplier)} />
          <Stat label="Tears" value={fmt(focused.base.tears, true)} />
          <Stat label="Speed" value={fmt(focused.base.speed)} />
          <Stat label="Range" value={fmt(focused.base.range)} />
          <Stat label="Shot Speed" value={fmt(focused.base.shotSpeed)} />
          <Stat label="Luck" value={fmt(focused.base.luck, true)} />
        </dl>

        {focused.startingItems.length > 0 && (
          <p className="starting">
            <span className="starting-label">Starts with</span>
            {focused.startingItems.join(", ")}
          </p>
        )}

        <button className="btn btn--primary" onClick={() => onPick(focused)}>
          Build as {focused.name}
        </button>
        <p className="hint">
          Arrow keys or drag to spin &middot; Enter to select
        </p>
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
