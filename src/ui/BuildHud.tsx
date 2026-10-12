import { useMemo } from "react";
import type { Character, Item } from "../types";

interface Props {
  character: Character;
  picked: Item[];
}

/**
 * A little window showing your character surrounded by what they're carrying.
 *
 * This is NOT the in-game look, and it can't be: the wiki hosts no costume
 * sprites at all (only 17 of 720 items even name a costume), and the game
 * builds Isaac's appearance by compositing layered sprite sheets we don't
 * have. What we do have is a complete, uniform set of 32x32 item icons, so
 * the build is rendered as orbiting icons instead.
 *
 * Familiars and orbitals ride the outer ring, everything else the inner one,
 * which at least mirrors how they behave in game.
 */

/** Items that actually follow you around, by the game's own tags. */
const ORBIT_TAGS = ["uniquefamiliar", "baby", "fly", "spider", "bob"];

function isCompanion(item: Item): boolean {
  if (item.tags.some((t) => ORBIT_TAGS.includes(t))) return true;
  return /\b(familiar|orbit|follows isaac)\b/i.test(
    `${item.description} ${item.effects[0] ?? ""}`,
  );
}

interface Ring {
  radius: number;
  duration: number;
  items: Item[];
  direction: 1 | -1;
}

export function BuildHud({ character, picked }: Props) {
  const rings = useMemo<Ring[]>(() => {
    // One entry per distinct item; duplicates are disabled in the picker.
    const unique = [...new Map(picked.map((i) => [i.page, i])).values()];
    const companions = unique.filter(isCompanion);
    const rest = unique.filter((i) => !isCompanion(i));

    // Keep rings legible: overflow spills outward rather than crowding.
    const out: Ring[] = [];
    const chunk = (list: Item[], per: number) => {
      const groups: Item[][] = [];
      for (let i = 0; i < list.length; i += per) {
        groups.push(list.slice(i, i + per));
      }
      return groups;
    };

    chunk(rest, 10).forEach((items, i) => {
      out.push({
        radius: 58 + i * 26,
        duration: 26 + i * 7,
        items,
        direction: i % 2 === 0 ? 1 : -1,
      });
    });
    chunk(companions, 8).forEach((items, i) => {
      out.push({
        radius: 58 + (chunk(rest, 10).length + i) * 26,
        duration: 18 + i * 6,
        items,
        direction: -1,
      });
    });
    return out;
  }, [picked]);

  const total = new Set(picked.map((i) => i.page)).size;

  return (
    <div className="hud">
      <div className="hud-stage">
        {rings.map((ring, ri) => (
          <div
            key={ri}
            className="hud-ring"
            style={{
              width: ring.radius * 2,
              height: ring.radius * 2,
              animationDuration: `${ring.duration}s`,
              animationDirection:
                ring.direction === 1 ? "normal" : "reverse",
            }}
          >
            {ring.items.map((item, i) => {
              const angle = (360 / ring.items.length) * i;
              return (
                <div
                  key={item.page}
                  className="hud-orbit"
                  style={{
                    transform: `rotate(${angle}deg) translateY(-${ring.radius}px)`,
                  }}
                  title={item.name}
                >
                  {/* Counter-rotate so icons stay upright as the ring spins. */}
                  <div
                    className="hud-icon"
                    style={{
                      animationDuration: `${ring.duration}s`,
                      animationDirection:
                        ring.direction === 1 ? "reverse" : "normal",
                    }}
                  >
                    {item.sprite && <img src={item.sprite} alt="" />}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div className="hud-center">
          {character.sprite && (
            <img src={character.sprite} alt={character.name} />
          )}
        </div>
      </div>

      <p className="hud-caption">
        {character.name}
        {total > 0 && (
          <span className="hud-count">
            {" "}
            &middot; {total} item{total === 1 ? "" : "s"}
          </span>
        )}
      </p>
    </div>
  );
}
