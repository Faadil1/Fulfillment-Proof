import { describe, it, expect } from "vitest";
import { normalizeExecMs, MAX_EXEC_MS } from "./exec";

describe("normalizeExecMs (regression: CreateOS returned 72.967, breaking int4 insert)", () => {
  it("rounds fractional 72.967 to 73", () => {
    expect(normalizeExecMs(72.967)).toBe(73);
  });
  it("keeps integers unchanged", () => {
    expect(normalizeExecMs(0)).toBe(0);
    expect(normalizeExecMs(75)).toBe(75);
  });
  it("rounds .5 up like Math.round", () => {
    expect(normalizeExecMs(10.5)).toBe(11);
  });
  it("falls back to null for NaN", () => {
    expect(normalizeExecMs(NaN)).toBeNull();
  });
  it("falls back to null for negative values", () => {
    expect(normalizeExecMs(-1)).toBeNull();
    expect(normalizeExecMs(-0.5)).toBeNull();
  });
  it("falls back to null for non-finite values", () => {
    expect(normalizeExecMs(Infinity)).toBeNull();
    expect(normalizeExecMs(-Infinity)).toBeNull();
  });
  it("falls back to null for non-numbers", () => {
    expect(normalizeExecMs("72.967")).toBeNull();
    expect(normalizeExecMs(undefined)).toBeNull();
    expect(normalizeExecMs(null)).toBeNull();
  });
  it("bounds absurdly large values", () => {
    expect(normalizeExecMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_EXEC_MS);
  });
});