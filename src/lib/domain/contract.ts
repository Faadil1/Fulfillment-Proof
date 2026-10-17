// Normalized order contract + drift detection. Pure, shared by server and tests.
import { z } from "zod";

export const NormalizedOrder = z
  .object({
    external_order_id: z.string().min(1).max(120),
    source: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount_cents: z.number().int().min(0).max(100_000_000_00),
    sku: z.string().min(1).max(80),
    quantity: z.number().int().min(1).max(10_000),
    customer_reference: z.string().min(1).max(120),
  })
  .strict();
export type NormalizedOrder = z.infer<typeof NormalizedOrder>;

export const CONTRACT_FIELDS = [
  "external_order_id",
  "source",
  "currency",
  "amount_cents",
  "sku",
  "quantity",
  "customer_reference",
] as const;

export type Violation = { field: string; code: string; message: string; hint?: string };

/** Find likely drift signals by looking for renamed/nested keys anywhere in the payload. */
function findPaths(obj: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 5 || obj === null || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    findPaths(v, p, out, depth + 1);
  }
  return out;
}

export function detectViolations(payload: unknown): Violation[] {
  const violations: Violation[] = [];
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [{ field: "$", code: "NOT_OBJECT", message: "Payload must be a JSON object" }];
  }
  const parsed = NormalizedOrder.safeParse(payload);
  if (parsed.success) return [];
  const paths = findPaths(payload);
  for (const issue of parsed.error.issues) {
    const field = issue.path.join(".") || "$";
    const v: Violation = { field, code: issue.code.toUpperCase(), message: issue.message };
    const leaf = field.split(".").pop() ?? field;
    const related = paths.filter(
      (p) => p !== field && (p.toLowerCase().includes(leaf.split("_")[0] ?? leaf) || (leaf === "amount_cents" && /total|price|amount/i.test(p))),
    );
    if (related.length) v.hint = `Possible drifted source: ${related.slice(0, 4).join(", ")}`;
    violations.push(v);
  }
  return violations;
}

/** Stable JSON for hashing (sorted keys). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}