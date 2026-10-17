import { describe, it, expect } from "vitest";
import { classifyStripeApi, classifyStripeProjects } from "./stripe-evidence";

describe("Stripe evidence separation", () => {
  it("successful sk_test call is LIVE_TEST_MODE", () => expect(classifyStripeApi("sk_test_abc", true)).toBe("LIVE_TEST_MODE"));
  it("no key is NOT_CONFIGURED", () => expect(classifyStripeApi(undefined, null)).toBe("NOT_CONFIGURED"));
  it("rejected key is REFUSED", () => expect(classifyStripeApi("sk_test_abc", false)).toBe("REFUSED"));
  it("network failure is UNKNOWN", () => expect(classifyStripeApi("sk_test_abc", null)).toBe("UNKNOWN"));
  it("declared Projects resource id is never proven", () => expect(classifyStripeProjects("res_123").level).toBe("UNKNOWN"));
  it("no Projects declaration is NOT_CONFIGURED", () => expect(classifyStripeProjects(undefined).level).toBe("NOT_CONFIGURED"));
});