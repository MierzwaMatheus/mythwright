export type FateDie = -1 | 0 | 1;

export interface FateDiceResult {
  dice: [FateDie, FateDie, FateDie, FateDie];
  total: number;
}

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash) ^ seed.charCodeAt(i);
    hash = hash >>> 0; // keep as unsigned 32-bit
  }
  return hash;
}

function lcgNext(state: number): number {
  // LCG parameters from Numerical Recipes
  return (((state * 1664525) + 1013904223) >>> 0);
}

function stateToFateDie(state: number): FateDie {
  const mod = state % 3;
  if (mod === 0) return -1;
  if (mod === 1) return 0;
  return 1;
}

export type FateOutcome = "failure" | "tie" | "success" | "success_with_style";

export function calculateOutcome(total: number, opposition: number): FateOutcome {
  const diff = total - opposition;
  if (diff <= -1) return "failure";
  if (diff === 0) return "tie";
  if (diff <= 2) return "success";
  return "success_with_style";
}

export function rollFateDice(seed: string, skillLevel: number): FateDiceResult {
  let state = hashSeed(seed);

  state = lcgNext(state);
  const d0 = stateToFateDie(state);
  state = lcgNext(state);
  const d1 = stateToFateDie(state);
  state = lcgNext(state);
  const d2 = stateToFateDie(state);
  state = lcgNext(state);
  const d3 = stateToFateDie(state);

  const dice: [FateDie, FateDie, FateDie, FateDie] = [d0, d1, d2, d3];
  const total = d0 + d1 + d2 + d3 + skillLevel;

  return { dice, total };
}

export type StressTrack = {
  boxes: Array<{ value: number; marked: boolean }>;
};

export type StressResult =
  | { canAbsorb: true; boxToMark: number; requiresConsequence: false }
  | { canAbsorb: false; requiresConsequence: true; overflow: number };

export function calculateStress(amount: number, track: StressTrack): StressResult {
  const available = track.boxes
    .filter((box) => !box.marked && box.value >= amount)
    .sort((a, b) => a.value - b.value);

  if (available.length > 0) {
    return { canAbsorb: true, boxToMark: available[0].value, requiresConsequence: false };
  }

  return { canAbsorb: false, requiresConsequence: true, overflow: amount };
}

export interface TriggerCandidate {
  id: string;
  status: "armed" | "disabled" | "fired";
  scope: string;
}

export function filterTriggerCandidates(
  triggers: TriggerCandidate[],
  currentSceneId: string
): TriggerCandidate[] {
  return triggers.filter(
    (t) => t.status === "armed" && (t.scope === "global" || t.scope === currentSceneId)
  );
}

export function applyAspectInvocation(
  roll: FateDiceResult,
  effect: "bonus_2" | "reroll",
  seed?: string
): FateDiceResult {
  if (effect === "bonus_2") {
    return { dice: roll.dice, total: roll.total + 2 };
  }

  // effect === "reroll"
  if (seed === undefined) {
    throw new Error("seed is required for reroll");
  }

  const diceSum = roll.dice.reduce((acc: number, d) => acc + d, 0);
  const skillLevel = roll.total - diceSum;
  return rollFateDice(seed, skillLevel);
}
