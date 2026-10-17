/**
 * Fulfillment Proof: deterministic trust boundary around AI-generated order proposals.
 *
 * The agent may propose data but may NOT decide authorization or verification.
 * No I/O, privileged credentials, LLM execution, or Stripe / CreateOS calls live here.
 */
export type Evidence = "TEST_FIXTURE" | "LIVE_TEST_MODE" | "LIVE_OBSERVED";

export type NormalizedOrder = Readonly<{
  source: string;
  external_order_id: string;
  currency: string;
  amount_cents: number;
  sku: string;
  quantity: number;
  customer_reference: string;
}>;

export type ParseResult =
  | { ok: true; order: NormalizedOrder }
  | { ok: false; reason: string };

export type PolicyDecision =
  | { state: "AUTO_APPROVED"; reason: string }
  | { state: "REVIEW_REQUIRED"; reason: string }
  | { state: "REFUSED"; reason: string };

export type ReadbackVerdict =
  | { state: "VERIFIED"; reason: string }
  | { state: "UNKNOWN"; reason: string }
  | { state: "REFUSED"; reason: string };

const keys = new Set([
  "source", "external_order_id", "currency", "amount_cents",
  "sku", "quantity", "customer_reference"
]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length >= 1 && value.length <= maxLength &&
    value.trim() === value && !/[\u0000-\u001F]/.test(value);
}

/** Parse and validate an untrusted proposal emitted by generated code. */
export function parseNormalizedOrder(value: unknown): ParseResult {
  if (!object(value)) return { ok: false, reason: "PROPOSAL_NOT_OBJECT" };
  const unexpected = Object.keys(value).filter(key => !keys.has(key));
  if (unexpected.length) return { ok: false, reason: "UNEXPECTED_FIELDS" };

  const { source, external_order_id, currency, amount_cents, sku, quantity, customer_reference } = value;
  if (!boundedString(source, 48) || !/^[A-Za-z0-9._:-]+$/.test(source))
    return { ok: false, reason: "INVALID_SOURCE" };
  if (!boundedString(external_order_id, 128) || !/^[A-Za-z0-9._:-]+$/.test(external_order_id))
    return { ok: false, reason: "INVALID_ORDER_ID" };
  if (!boundedString(currency, 3) || !/^[A-Z]{3}$/.test(currency))
    return { ok: false, reason: "INVALID_CURRENCY" };
  if (!Number.isSafeInteger(amount_cents) || (amount_cents as number) < 0)
    return { ok: false, reason: "INVALID_AMOUNT" };
  if (!boundedString(sku, 128)) return { ok: false, reason: "INVALID_SKU" };
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > 100000)
    return { ok: false, reason: "INVALID_QUANTITY" };
  if (!boundedString(customer_reference, 128))
    return { ok: false, reason: "INVALID_CUSTOMER_REFERENCE" };

  return {
    ok: true,
    order: Object.freeze({
      source: source as string,
      external_order_id: external_order_id as string,
      currency: currency as string,
      amount_cents: amount_cents as number,
      sku: sku as string,
      quantity: quantity as number,
      customer_reference: customer_reference as string,
    }),
  };
}

export type OrderPolicy = Readonly<{
  allowedSources: readonly string[];
  knownSkus: readonly string[];
  maxAutomaticAmountCents: number;
  supportedCurrencies: readonly string[];
}>;

/** Evaluate policy independently of generated code and before any write. */
export function authorizeOrder(
  order: NormalizedOrder,
  policy: OrderPolicy,
): PolicyDecision {
  if (!policy.allowedSources.includes(order.source))
    return { state: "REFUSED", reason: "SOURCE_NOT_AUTHORIZED" };
  if (!policy.supportedCurrencies.includes(order.currency))
    return { state: "REFUSED", reason: "CURRENCY_NOT_AUTHORIZED" };
  if (!policy.knownSkus.includes(order.sku))
    return { state: "REVIEW_REQUIRED", reason: "SKU_NOT_IN_CATALOG" };
  if (!Number.isSafeInteger(policy.maxAutomaticAmountCents) ||
      policy.maxAutomaticAmountCents < 0)
    return { state: "REFUSED", reason: "INVALID_POLICY" };
  if (order.amount_cents > policy.maxAutomaticAmountCents)
    return { state: "REVIEW_REQUIRED", reason: "AMOUNT_EXCEEDS_AUTOMATIC_LIMIT" };
  return { state: "AUTO_APPROVED", reason: "WITHIN_APPROVED_POLICY" };
}

/**
 * A verifier must query the independent destination AFTER any authorized write.
 * This function only grades actual readback rows supplied by that trusted verifier.
 */
export function verifyDestinationReadback(
  proposed: NormalizedOrder,
  readbackRows: readonly unknown[] | null,
): ReadbackVerdict {
  if (readbackRows === null)
    return { state: "UNKNOWN", reason: "DESTINATION_READ_FAILED" };
  if (readbackRows.length === 0)
    return { state: "UNKNOWN", reason: "ORDER_NOT_OBSERVED" };
  if (readbackRows.length !== 1)
    return { state: "REFUSED", reason: "DUPLICATE_DESTINATION_RECORDS" };

  const parsed = parseNormalizedOrder(readbackRows[0]);
  if (!parsed.ok)
    return { state: "REFUSED", reason: "INVALID_DESTINATION_RECORD" };
  const got = parsed.order;
  for (const key of keys) {
    const field = key as keyof NormalizedOrder;
    if (proposed[field] !== got[field])
      return { state: "REFUSED", reason: "DESTINATION_FIELD_MISMATCH:" + key };
  }
  return { state: "VERIFIED", reason: "INDEPENDENT_READBACK_MATCH" };
}

/**
 * A provisional idempotency key to use with a UNIQUE database constraint.
 * The DB must enforce this uniqueness transactionally; the string alone
 * cannot provide exactly-once semantics.
 */
export function orderIdempotencyScope(tenantId: string, order: NormalizedOrder): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(tenantId))
    throw new Error("INVALID_TENANT_ID");
  return JSON.stringify([tenantId, order.source, order.external_order_id]);
}
