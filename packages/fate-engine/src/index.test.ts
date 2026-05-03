import { describe, it, expect } from "vitest";
import { rollFateDice, calculateOutcome, applyAspectInvocation, calculateStress, filterTriggerCandidates } from "./index.js";
import type { FateDie, StressTrack, TriggerCandidate } from "./index.js";

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

describe("applyAspectInvocation", () => {
  // Caso 1: bonus_2 incrementa total em +2
  it("bonus_2 increments total by exactly 2", () => {
    const roll = rollFateDice("test-seed", 3);
    const result = applyAspectInvocation(roll, "bonus_2");
    expect(result.total).toBe(roll.total + 2);
  });

  // Caso 2: bonus_2 não altera dice
  it("bonus_2 does not alter the dice array", () => {
    const roll = rollFateDice("test-seed", 3);
    const result = applyAspectInvocation(roll, "bonus_2");
    expect(result.dice).toEqual(roll.dice);
  });

  // Caso 3: bonus_2 funciona sem seed
  it("bonus_2 works without a seed", () => {
    const roll = rollFateDice("test-seed", 3);
    expect(() => applyAspectInvocation(roll, "bonus_2")).not.toThrow();
  });

  // Caso 4: reroll retorna resultado determinístico (mesma seed → mesmo resultado)
  it("reroll returns deterministic result given the same seed", () => {
    const roll = rollFateDice("initial-seed", 2);
    const first = applyAspectInvocation(roll, "reroll", "reroll-seed");
    const second = applyAspectInvocation(roll, "reroll", "reroll-seed");
    expect(first).toEqual(second);
  });

  // Caso 5: reroll com seed diferente pode retornar dados diferentes
  it("reroll with different seeds can return different dice", () => {
    const roll = rollFateDice("initial-seed", 2);
    const resultA = applyAspectInvocation(roll, "reroll", "seed-alpha-111");
    const resultB = applyAspectInvocation(roll, "reroll", "seed-beta-999");
    expect(resultA.dice).not.toEqual(resultB.dice);
  });

  // Caso 6: reroll preserva o skillLevel implícito no total
  it("reroll preserves the implicit skillLevel in the new total", () => {
    const skillLevel = 4;
    const roll = rollFateDice("initial-seed", skillLevel);
    const result = applyAspectInvocation(roll, "reroll", "reroll-seed");
    const diceSum = result.dice.reduce((acc, d) => acc + d, 0);
    expect(result.total).toBe(diceSum + skillLevel);
  });

  // Caso 7: reroll sem seed lança erro
  it("reroll without seed throws Error('seed is required for reroll')", () => {
    const roll = rollFateDice("test-seed", 3);
    expect(() => applyAspectInvocation(roll, "reroll")).toThrow(
      "seed is required for reroll"
    );
  });
});

describe("calculateStress", () => {
  const defaultTrack: StressTrack = {
    boxes: [
      { value: 1, marked: false },
      { value: 2, marked: false },
      { value: 3, marked: false },
    ],
  };

  // Caso 1: amount=1, todas livres -> boxToMark: 1
  it("absorbs amount=1 into box 1 when all boxes are free", () => {
    const result = calculateStress(1, defaultTrack);
    expect(result).toEqual({ canAbsorb: true, boxToMark: 1, requiresConsequence: false });
  });

  // Caso 2: amount=2, todas livres -> boxToMark: 2
  it("absorbs amount=2 into box 2 when all boxes are free", () => {
    const result = calculateStress(2, defaultTrack);
    expect(result).toEqual({ canAbsorb: true, boxToMark: 2, requiresConsequence: false });
  });

  // Caso 3: amount=1, caixa 1 marcada -> boxToMark: 2 (menor disponivel)
  it("absorbs amount=1 into box 2 when box 1 is already marked", () => {
    const track: StressTrack = {
      boxes: [
        { value: 1, marked: true },
        { value: 2, marked: false },
        { value: 3, marked: false },
      ],
    };
    const result = calculateStress(1, track);
    expect(result).toEqual({ canAbsorb: true, boxToMark: 2, requiresConsequence: false });
  });

  // Caso 4: amount=2, caixa 2 marcada, caixa 3 livre -> boxToMark: 3
  it("absorbs amount=2 into box 3 when box 2 is marked and box 3 is free", () => {
    const track: StressTrack = {
      boxes: [
        { value: 1, marked: false },
        { value: 2, marked: true },
        { value: 3, marked: false },
      ],
    };
    const result = calculateStress(2, track);
    expect(result).toEqual({ canAbsorb: true, boxToMark: 3, requiresConsequence: false });
  });

  // Caso 5: amount=4, track padrao -> requiresConsequence: true, overflow: 4
  it("cannot absorb amount=4 in default track, returns requiresConsequence and overflow", () => {
    const result = calculateStress(4, defaultTrack);
    expect(result).toEqual({ canAbsorb: false, requiresConsequence: true, overflow: 4 });
  });

  // Caso 6: todas marcadas, amount=1 -> requiresConsequence: true
  it("cannot absorb when all boxes are marked", () => {
    const track: StressTrack = {
      boxes: [
        { value: 1, marked: true },
        { value: 2, marked: true },
        { value: 3, marked: true },
      ],
    };
    const result = calculateStress(1, track);
    expect(result).toEqual({ canAbsorb: false, requiresConsequence: true, overflow: 1 });
  });

  // Caso 7: amount=3, caixa 3 marcada, caixas 1 e 2 livres -> requiresConsequence: true
  it("cannot absorb amount=3 when box 3 is marked and only smaller boxes are free", () => {
    const track: StressTrack = {
      boxes: [
        { value: 1, marked: false },
        { value: 2, marked: false },
        { value: 3, marked: true },
      ],
    };
    const result = calculateStress(3, track);
    expect(result).toEqual({ canAbsorb: false, requiresConsequence: true, overflow: 3 });
  });

  // Caso 8: track [1,2,3,4], amount=3 -> boxToMark: 3 (nao 4)
  it("absorbs amount=3 into box 3 (smallest fit), not box 4", () => {
    const track: StressTrack = {
      boxes: [
        { value: 1, marked: false },
        { value: 2, marked: false },
        { value: 3, marked: false },
        { value: 4, marked: false },
      ],
    };
    const result = calculateStress(3, track);
    expect(result).toEqual({ canAbsorb: true, boxToMark: 3, requiresConsequence: false });
  });
});

describe("filterTriggerCandidates", () => {
  // Caso 1: triggers armed + scope global passam
  it("returns all armed global triggers regardless of currentSceneId", () => {
    const triggers: TriggerCandidate[] = [
      { id: "t1", status: "armed", scope: "global" },
      { id: "t2", status: "armed", scope: "global" },
    ];
    const result = filterTriggerCandidates(triggers, "scene-abc");
    expect(result).toEqual(triggers);
  });

  // Caso 2: apenas scope === currentSceneId passa; outros sceneIds sao excluidos
  it("returns armed triggers matching currentSceneId and excludes other scene scopes", () => {
    const triggers: TriggerCandidate[] = [
      { id: "t1", status: "armed", scope: "scene-abc" },
      { id: "t2", status: "armed", scope: "scene-xyz" },
    ];
    const result = filterTriggerCandidates(triggers, "scene-abc");
    expect(result).toEqual([{ id: "t1", status: "armed", scope: "scene-abc" }]);
  });

  // Caso 3: disabled sao excluidos independente do scope
  it("excludes disabled triggers regardless of scope", () => {
    const triggers: TriggerCandidate[] = [
      { id: "t1", status: "disabled", scope: "global" },
      { id: "t2", status: "disabled", scope: "scene-abc" },
    ];
    const result = filterTriggerCandidates(triggers, "scene-abc");
    expect(result).toEqual([]);
  });

  // Caso 4: fired sao excluidos independente do scope
  it("excludes fired triggers regardless of scope", () => {
    const triggers: TriggerCandidate[] = [
      { id: "t1", status: "fired", scope: "global" },
      { id: "t2", status: "fired", scope: "scene-abc" },
    ];
    const result = filterTriggerCandidates(triggers, "scene-abc");
    expect(result).toEqual([]);
  });

  // Caso implicito A: lista vazia retorna lista vazia
  it("returns empty array when triggers list is empty", () => {
    const result = filterTriggerCandidates([], "scene-abc");
    expect(result).toEqual([]);
  });

  // Caso implicito B: mix de todos os casos retorna apenas os armed+global e armed+currentSceneId
  it("returns only armed+global and armed+currentSceneId from a mixed list", () => {
    const triggers: TriggerCandidate[] = [
      { id: "t1", status: "armed", scope: "global" },
      { id: "t2", status: "armed", scope: "scene-abc" },
      { id: "t3", status: "armed", scope: "scene-xyz" },
      { id: "t4", status: "disabled", scope: "global" },
      { id: "t5", status: "fired", scope: "scene-abc" },
    ];
    const result = filterTriggerCandidates(triggers, "scene-abc");
    expect(result).toEqual([
      { id: "t1", status: "armed", scope: "global" },
      { id: "t2", status: "armed", scope: "scene-abc" },
    ]);
  });
});
