// Invariant policy enforced by the control plane on every proposed record.
import { NormalizedOrder, type NormalizedOrder as Order } from "./contract";

export const APPROVAL_AMOUNT_THRESHOLD_CENTS = 500_000;
export const POLICY_VERSION = "policy-v1";

export type PolicyDecision = {
  version: string;
  allowed: boolean; // false => hard refuse (never writable)
  requires_approval: boolean;
  reasons: string[];
  refusals: string[];
};

/**
 * @param proposed  output of generated code (untrusted)
 * @param original  raw inbound payload
 * @param source    integration source the event came in on
 * @param knownSkus org's SKU catalogue
 */
export function evaluatePolicy(
  proposed: unknown,
  original: Record<string, unknown>,
  source: string,
  knownSkus: string[],
): PolicyDecision {
  const d: PolicyDecision = { version: POLICY_VERSION, allowed: true, requires_approval: false, reasons: [], refusals: [] };
  const parsed = NormalizedOrder.safeParse(proposed);
  if (!parsed.success) {
    d.allowed = false;
    d.refusals.push(...parsed.error.issues.map((i) => `invalid ${i.path.join(".") || "$"}: ${i.message}`));
    return d;
  }
  const p: Order = parsed.data;
  if (p.source !== source) {
    d.allowed = false;
    d.refusals.push(`source must equal integration source "${source}"`);
  }
  // High-risk fields: if the original payload carried them in contract form, a transform must not change them.
  for (const f of ["external_order_id", "customer_reference", "currency"] as const) {
    const o = original[f];
    if (typeof o === "string" && o !== p[f]) {
      d.requires_approval = true;
      d.reasons.push(`high-risk field ${f} changed ("${o}" -> "${p[f]}")`);
    }
  }
  if (p.amount_cents > APPROVAL_AMOUNT_THRESHOLD_CENTS) {
    d.requires_approval = true;
    d.reasons.push(`amount_cents ${p.amount_cents} exceeds ${APPROVAL_AMOUNT_THRESHOLD_CENTS}`);
  }
  if (!knownSkus.includes(p.sku)) {
    d.requires_approval = true;
    d.reasons.push(`unknown SKU "${p.sku}"`);
  }
  return d;
}