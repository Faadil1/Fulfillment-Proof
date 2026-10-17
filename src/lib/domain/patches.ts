// Verified-patch registry: pure helpers mirrored by SQL (promote_verified_patch / drift_signature).
import { sha256Hex } from "./contract";

type V = { field: string; code: string };

/** Must equal SQL drift_signature(): distinct "field:code", byte-order sorted, joined by '|'. */
export function driftSignature(violations: V[]): string {
  const s = [...new Set(violations.map((v) => `${v.field}:${v.code}`))];
  s.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return s.join("|");
}

/** sha256(source + "\n" + signature). Never includes order ids or values. */
export async function driftFingerprint(source: string, violations: V[]): Promise<string> {
  return sha256Hex(`${source}\n${driftSignature(violations)}`);
}

type Leaf = { key: string; path: string; value: unknown };
function leafList(v: unknown, path = "", out: Leaf[] = [], depth = 0): Leaf[] {
  if (depth > 6 || v === null || v === undefined) return out;
  if (typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) leafList(x, path ? `${path}.${k}` : k, out, depth + 1);
  } else if (Array.isArray(v)) v.forEach((x, i) => leafList(x, `${path}[${i}]`, out, depth + 1));
  else out.push({ key: (path.split(".").pop() ?? path).replace(/\[\d+\]$/, "").toLowerCase(), path, value: v });
  return out;
}

const MAJOR_UNIT_KEYS = new Set(["total", "net_total", "amount", "order_total", "grand_total", "total_amount", "net_amount"]);
const QTY_KEYS = new Set(["quantity", "qty", "count", "units"]);

/** Exact integer from number or integer string; null otherwise. */
function asInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^\d{1,12}$/.test(v.trim())) return Number(v.trim());
  return null;
}
/** Major-unit decimal ("19.95", 19.95, "20") -> integer cents via string arithmetic (no float math). */
export function majorToCents(v: unknown): number | null {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** All amount_cents values derivable from the payload: cents aliases exactly, major-unit aliases converted. */
export function amountCandidates(payload: unknown): number[] {
  const c = new Set<number>();
  for (const l of leafList(payload)) {
    if (l.key === "cents" || l.key.endsWith("_cents")) { const n = asInt(l.value); if (n !== null) c.add(n); }
    else if (MAJOR_UNIT_KEYS.has(l.key)) { const n = majorToCents(l.value); if (n !== null) c.add(n); }
  }
  return [...c];
}

/**
 * Anti-seed check for reused code with narrow, deterministic semantics:
 * - amount_cents: must equal the SINGLE value derivable from cents aliases (exact int) or major-unit
 *   aliases (decimal -> cents). Conflicting or absent candidates are rejected.
 * - currency: case-insensitive match of a payload string. quantity: integer match of a qty alias or any int leaf.
 * - identifiers (external_order_id, customer_reference, sku) and any other field: exact string present in payload.
 * `source` is fixed by the control plane. Returns offending fields (with reason).
 */
export function underivedFields(proposed: unknown, payload: unknown): string[] {
  if (!proposed || typeof proposed !== "object") return ["$"];
  const ls = leafList(payload);
  const strs = new Set(ls.filter((l) => typeof l.value === "string").map((l) => l.value as string));
  const bad: string[] = [];
  for (const [k, v] of Object.entries(proposed as Record<string, unknown>)) {
    if (k === "source") continue;
    if (k === "amount_cents") {
      const cands = amountCandidates(payload);
      if (cands.length === 0) bad.push("amount_cents (no derivable amount in payload)");
      else if (cands.length > 1) bad.push(`amount_cents (conflicting payload amounts: ${cands.sort((a, b) => a - b).join(", ")})`);
      else if (v !== cands[0]) bad.push(`amount_cents (expected ${cands[0]})`);
    } else if (k === "currency") {
      if (typeof v !== "string" || ![...strs].some((s) => s.toLowerCase() === v.toLowerCase())) bad.push("currency");
    } else if (k === "quantity") {
      // Only named quantity aliases count; never a generic integer leaf. Conflicts fail closed.
      const named = [...new Set(ls.filter((l) => QTY_KEYS.has(l.key)).map((l) => asInt(l.value)).filter((n): n is number => n !== null))];
      if (named.length === 0) bad.push("quantity (no named quantity field in payload)");
      else if (named.length > 1) bad.push(`quantity (conflicting payload quantities: ${named.sort((a, b) => a - b).join(", ")})`);
      else if (v !== named[0]) bad.push(`quantity (expected ${named[0]})`);
    } else if (typeof v !== "string" || !strs.has(v)) {
      if (!(typeof v === "number" && ls.some((l) => l.value === v))) bad.push(k);
    }
  }
  return bad;
}

export type StoredTest = { name: string; input: Record<string, unknown>; expect: Record<string, unknown> };
/** Provenance tests from the promoted run: 2-8 well-formed entries, bounded size; otherwise null (fail closed). */
export function validateProvenanceTests(x: unknown): StoredTest[] | null {
  if (!Array.isArray(x) || x.length < 2 || x.length > 8) return null;
  const obj = (o: unknown) => !!o && typeof o === "object" && !Array.isArray(o);
  for (const t of x) {
    if (!obj(t) || typeof t.name !== "string" || t.name.length === 0 || t.name.length > 120 || !obj(t.input) || !obj(t.expect)) return null;
  }
  if (JSON.stringify(x).length > 32_000) return null;
  return x as StoredTest[];
}

export type PromoteCtx = {
  callerCanOperate: boolean; runOrg: string; generation_status: string; execution_status: string;
  codeHashMatches: boolean; incidentStatus: string; isLatestProposal: boolean;
  receipt: { result: string; org: string; destination_record_id: string | null } | null;
  destination: { org: string; source: string } | null; eventSource: string; alreadyPromoted: boolean; hasDrift: boolean;
};

/** Mirror of the SQL guards (the DB is authoritative). */
export function promoteEligibility(c: PromoteCtx): { ok: true } | { ok: false; reason: string } {
  if (!c.callerCanOperate) return { ok: false, reason: "operator role required" };
  if (c.generation_status !== "GENERATED" || c.execution_status !== "SUCCEEDED") return { ok: false, reason: "only sandbox-SUCCEEDED generated code can be promoted" };
  if (!c.codeHashMatches) return { ok: false, reason: "code hash mismatch" };
  if (c.incidentStatus !== "VERIFIED") return { ok: false, reason: "incident must be VERIFIED" };
  if (!c.isLatestProposal) return { ok: false, reason: "stale run" };
  if (!c.receipt || c.receipt.result !== "VERIFIED" || c.receipt.org !== c.runOrg || !c.receipt.destination_record_id) return { ok: false, reason: "no VERIFIED receipt linked to a destination record" };
  if (!c.destination || c.destination.org !== c.runOrg || c.destination.source !== c.eventSource) return { ok: false, reason: "destination missing or different org/source" };
  if (c.alreadyPromoted) return { ok: false, reason: "already promoted" };
  if (!c.hasDrift) return { ok: false, reason: "no contract drift to fingerprint" };
  return { ok: true };
}

export type ReuseVerdict =
  | { kind: "PROPOSE" }
  | { kind: "QUARANTINE"; reason: string } // regression: revoke patch, fall back to AI
  | { kind: "FALLBACK"; reason: string }; // not the patch's fault (infra): fall back, keep patch

/** Classify a reused patch's sandbox run on a new payload. */
export function classifyReuse(args: {
  patchStatus: string; codeHashMatches: boolean; sandboxStatus: string; proposed: unknown; payload: unknown; policyAllowed: boolean | null;
  expectedTests: number; testResults: { pass: boolean }[] | null;
}): ReuseVerdict {
  if (args.patchStatus !== "ACTIVE") return { kind: "FALLBACK", reason: "patch not active" };
  if (!args.codeHashMatches) return { kind: "QUARANTINE", reason: "stored code does not match proven hash" };
  if (args.expectedTests < 2) return { kind: "QUARANTINE", reason: "no valid provenance tests to re-run" };
  if (args.sandboxStatus === "ERROR" || args.sandboxStatus === "NOT_CONFIGURED") return { kind: "FALLBACK", reason: `sandbox ${args.sandboxStatus}` };
  if (args.sandboxStatus !== "SUCCEEDED") return { kind: "QUARANTINE", reason: `patch execution ${args.sandboxStatus} on new payload` };
  const tr = args.testResults ?? [];
  if (tr.length !== args.expectedTests) return { kind: "QUARANTINE", reason: `provenance tests reported ${tr.length}/${args.expectedTests}` };
  const failed = tr.filter((t) => !t.pass).length;
  if (failed) return { kind: "QUARANTINE", reason: `${failed}/${tr.length} provenance tests failed` };
  const bad = underivedFields(args.proposed, args.payload);
  if (bad.length) return { kind: "QUARANTINE", reason: `values not derived from new payload: ${bad.join(", ")}` };
  if (args.policyAllowed === false) return { kind: "QUARANTINE", reason: "proposal refused by policy" };
  return { kind: "PROPOSE" };
}