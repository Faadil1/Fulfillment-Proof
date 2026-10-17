// Grades the operator "Test connection" from observed HTTP results + persisted row only.
export type Observed = { status: number; body: Record<string, unknown> };

export function evaluateConnectionTest(signed: Observed, replay: Observed, unsigned: { status: number }, persistedDuplicateCount: number | null) {
  const signedOk = signed.status === 202 && signed.body["duplicate"] === false && typeof signed.body["event_id"] === "string";
  const replayOk = replay.status === 200 && replay.body["duplicate"] === true;
  const identityMatch = signedOk && replayOk
    && replay.body["event_id"] === signed.body["event_id"] && replay.body["incident_id"] === signed.body["incident_id"];
  const unsignedRejected = unsigned.status === 401;
  const persistedOk = persistedDuplicateCount !== null && persistedDuplicateCount >= 1;
  return { signedOk, replayOk, identityMatch, unsignedRejected, persistedOk, pass: signedOk && replayOk && identityMatch && unsignedRejected && persistedOk };
}