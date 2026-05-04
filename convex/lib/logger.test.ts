/// <reference types="vite/client" />
import { describe, it, expect, vi, afterEach } from "vitest";
import { logTurnEvent } from "./logger";

describe("logTurnEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loga JSON com campos obrigatórios", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logTurnEvent({ turnId: "msg123", stage: "llm_stream", event: "stage_start" });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.turnId).toBe("msg123");
    expect(parsed.stage).toBe("llm_stream");
    expect(parsed.event).toBe("stage_start");
    expect(typeof parsed.ts).toBe("number");
  });

  it("inclui campos extras de data no JSON", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logTurnEvent({ turnId: "t1", stage: "s", event: "e", data: { durationMs: 42 } });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.durationMs).toBe(42);
  });

  it("não lança exceção com objetos circulares em data e ainda loga", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      logTurnEvent({ turnId: "t1", stage: "s", event: "e", data: circular })
    ).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.turnId).toBe("t1");
  });
});
