import { describe, it, expect } from "vitest";
import { evaluateConnectionTest } from "./connection-test";

const s = { status: 202, body: { duplicate: false, event_id: "e1", incident_id: "i1" } };
const r = { status: 200, body: { duplicate: true, event_id: "e1", incident_id: "i1" } };

describe("connection test grading (no pass on guesses)", () => {
  it("passes only with 202, 200-duplicate same ids, 401 and persisted count", () =>
    expect(evaluateConnectionTest(s, r, { status: 401 }, 1).pass).toBe(true));
  it("fails if replay created a new event (dedup broken)", () =>
    expect(evaluateConnectionTest(s, { status: 202, body: { duplicate: false, event_id: "e2", incident_id: "i2" } }, { status: 401 }, 0).pass).toBe(false));
  it("fails if replay ids differ even when flagged duplicate", () =>
    expect(evaluateConnectionTest(s, { ...r, body: { ...r.body, incident_id: "i9" } }, { status: 401 }, 1).identityMatch).toBe(false));
  it("fails if unsigned request accepted", () => expect(evaluateConnectionTest(s, r, { status: 202 }, 1).pass).toBe(false));
  it("fails without persisted duplicate count", () => expect(evaluateConnectionTest(s, r, { status: 401 }, null).pass).toBe(false));
  it("fails on network/server error", () => expect(evaluateConnectionTest({ status: 500, body: {} }, r, { status: 401 }, 1).pass).toBe(false));
});