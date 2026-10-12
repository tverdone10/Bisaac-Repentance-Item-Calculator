import { useState } from "react";
import { characters } from "./data";
import type { Build } from "./engine/build";
import { Builder } from "./ui/Builder";
import { CharacterCarousel } from "./ui/CharacterCarousel";
import type { Character } from "./types";

export default function App() {
  const [build, setBuild] = useState<Build | null>(null);

  const start = (character: Character) =>
    setBuild({
      character,
      formIndex: 0,
      picked: [],
      variants: {},
      scaled: {},
    });

  if (!build) {
    return <CharacterCarousel characters={characters} onPick={start} />;
  }
  return (
    <Builder
      build={build}
      setBuild={setBuild}
      onBack={() => setBuild(null)}
    />
  );
}
