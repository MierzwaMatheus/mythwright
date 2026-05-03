import { describe, it, expect } from "vitest";
import { rollFateDice, calculateOutcome } from "./index.js";
import type { FateDie } from "./index.js";

describe("rollFateDice", () => {
  // Caso 1: Determinismo
  it("returns identical result when called twice with the same seed and skillLevel", () => {
    const first = rollFateDice("hero-seed", 3);
    const second = rollFateDice("hero-seed", 3);
    expect(first).toEqual(second);
  });

  // Caso 2: Tamanho
  it("returns a dice array with exactly 4 elements", () => {
    const result = rollFateDice("any-seed", 0);
    expect(result.dice).toHaveLength(4);
  });

  // Caso 3: Valores validos
  it("each die value is -1, 0, or 1", () => {
    const result = rollFateDice("valid-values-seed", 2);
    const validValues: FateDie[] = [-1, 0, 1];
    for (const die of result.dice) {
      expect(validValues).toContain(die);
    }
  });

  // Caso 4: Total correto
  it("total equals sum of dice plus skillLevel", () => {
    const skillLevel = 5;
    const result = rollFateDice("total-check-seed", skillLevel);
    const diceSum = result.dice.reduce((acc, d) => acc + d, 0);
    expect(result.total).toBe(diceSum + skillLevel);
  });

  // Caso 5: skillLevel 0
  it("total equals sum of dice when skillLevel is 0", () => {
    const result = rollFateDice("skill-zero-seed", 0);
    const diceSum = result.dice.reduce((acc, d) => acc + d, 0);
    expect(result.total).toBe(diceSum);
  });

  // Caso 6: skillLevel negativo
  it("negative skillLevel is correctly applied to total", () => {
    const skillLevel = -3;
    const result = rollFateDice("negative-skill-seed", skillLevel);
    const diceSum = result.dice.reduce((acc, d) => acc + d, 0);
    expect(result.total).toBe(diceSum + skillLevel);
  });

  // Caso A: Seeds diferentes
  it("different seeds produce different dice results", () => {
    const resultA = rollFateDice("seed-alpha-111", 0);
    const resultB = rollFateDice("seed-beta-999", 0);
    expect(resultA.dice).not.toEqual(resultB.dice);
  });
});

describe("calculateOutcome", () => {
  // Bordas de failure
  it("returns failure when difference is -1", () => {
    expect(calculateOutcome(2, 3)).toBe("failure");
  });

  it("returns failure when difference is very negative", () => {
    expect(calculateOutcome(0, 10)).toBe("failure");
  });

  // Tie
  it("returns tie when difference is 0", () => {
    expect(calculateOutcome(4, 4)).toBe("tie");
  });

  it("returns tie when both are zero", () => {
    expect(calculateOutcome(0, 0)).toBe("tie");
  });

  // Bordas de success
  it("returns success when difference is +1", () => {
    expect(calculateOutcome(4, 3)).toBe("success");
  });

  it("returns success when difference is +2", () => {
    expect(calculateOutcome(5, 3)).toBe("success");
  });

  // Bordas de success_with_style
  it("returns success_with_style when difference is +3", () => {
    expect(calculateOutcome(6, 3)).toBe("success_with_style");
  });

  it("returns success_with_style when difference is very large", () => {
    expect(calculateOutcome(10, 0)).toBe("success_with_style");
  });
});
