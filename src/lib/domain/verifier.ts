// Independent verifier. Deliberately shares no code with the generator/executor.
// Input: the approved proposal + rows actually read back from destination_records.
export const VERIFIER_VERSION = "verifier-v1";

type Expected = {
  external_order_id: string;
  source: string;
  currency: string;
  amount_cents: number;
  sku: string;
  quantity: number;
  customer_reference: string;
};
type Row = Expected & { id: string; status: string; amount_cents: number | string };

export type VerifyResult = {
  result: "VERIFIED" | "MISMATCH" | "MISSING" | "DUPLICATE";
  checks: { check: string; pass: boolean; expected?: unknown; actual?: unknown }[];
  record_id?: string;
};

export function verifyDestination(expected: Expected, rows: Row[]): VerifyResult {
  const checks: VerifyResult["checks"] = [];
  checks.push({ check: "unique_count", pass: rows.length === 1, expected: 1, actual: rows.length });
  if (rows.length === 0) return { result: "MISSING", checks };
  if (rows.length > 1) return { result: "DUPLICATE", checks };
  const r = rows[0]!;
  const cmp = (k: keyof Expected, actual: unknown) =>
    checks.push({ check: k, pass: String(expected[k]) === String(actual), expected: expected[k], actual });
  cmp("external_order_id", r.external_order_id);
  cmp("source", r.source);
  cmp("currency", r.currency);
  cmp("amount_cents", Number(r.amount_cents));
  cmp("sku", r.sku);
  cmp("quantity", r.quantity);
  cmp("customer_reference", r.customer_reference);
  checks.push({ check: "status", pass: r.status === "PENDING_FULFILLMENT", expected: "PENDING_FULFILLMENT", actual: r.status });
  return { result: checks.every((c) => c.pass) ? "VERIFIED" : "MISMATCH", checks, record_id: r.id };
}