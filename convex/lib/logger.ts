export function logTurnEvent(params: {
  turnId: string;
  stage: string;
  event: string;
  data?: Record<string, unknown>;
}): void {
  const { turnId, stage, event, data } = params;
  try {
    console.log(JSON.stringify({ turnId, stage, event, ...data, ts: Date.now() }));
  } catch {
    console.log(JSON.stringify({ turnId, stage, event, ts: Date.now() }));
  }
}
