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
