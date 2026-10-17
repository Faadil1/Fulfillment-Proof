// Pure classification of Stripe evidence. Two separate claims:
//  1. "Stripe test API": did an authenticated GET /v1/account succeed? (network result)
//  2. "Stripe Projects provisioning": this app has no API to verify it, so it is never PROVEN.
//     An env var (e.g. STRIPE_PROJECTS_RESOURCE_ID) is only a self-declaration.

export type StripeApiLevel = "NOT_CONFIGURED" | "LIVE_TEST_MODE" | "LIVE_OBSERVED" | "REFUSED" | "UNKNOWN";

export function classifyStripeApi(key: string | undefined, httpOk: boolean | null): StripeApiLevel {
  if (!key) return "NOT_CONFIGURED";
  if (httpOk === null) return "UNKNOWN"; // network error / no response
  if (!httpOk) return "REFUSED";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "LIVE_TEST_MODE";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "LIVE_OBSERVED";
  return "UNKNOWN";
}

export type StripeProjectsEvidence = { level: "NOT_CONFIGURED" | "UNKNOWN"; detail: { resource_id_declared: boolean; verification: "NOT_VERIFIABLE_IN_APP" } };

/** Never returns a proven/green level: a declared env value is not evidence of provisioning. */
export function classifyStripeProjects(declaredResourceId: string | undefined): StripeProjectsEvidence {
  return {
    level: declaredResourceId ? "UNKNOWN" : "NOT_CONFIGURED",
    detail: { resource_id_declared: !!declaredResourceId, verification: "NOT_VERIFIABLE_IN_APP" },
  };
}