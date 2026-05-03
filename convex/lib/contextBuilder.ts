type Character = {
  name: string;
  aspects: string[];
  skills: Record<string, number>;
  stunts: string[];
  fatePoints: number;
  stress: {
    physical: boolean[];
    mental: boolean[];
  };
  consequences: Array<{
    severity: "mild" | "moderate" | "severe";
    description: string;
  }>;
  [key: string]: unknown;
};

export function buildCharacterBlock(character: Character): string {
  return JSON.stringify({
    aspects: character.aspects,
    skills: character.skills,
    stunts: character.stunts,
    fatePoints: character.fatePoints,
    stress: character.stress,
    consequences: character.consequences,
  });
}
