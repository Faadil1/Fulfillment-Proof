// Real CreateOS Sandbox execution via @nodeops-createos/sandbox. No local fallback exists by design.
import { createClient } from "@nodeops-createos/sandbox";

export const SANDBOX_SHAPE = "s-1vcpu-1gb";
export const SANDBOX_ROOTFS = "devbox:1";
// Generated code needs no network. Allowlist a single loopback rule so egress is NOT blanket-open
// (an empty list means allow-all in CreateOS).
export const SANDBOX_EGRESS = ["127.0.0.1:9"];

export function createosConfig() {
  const apiKey = process.env["CREATEOS_SANDBOX_API_KEY"];
  const raw = process.env["CREATEOS_SANDBOX_BASE_URL"] || "api-eu.sb.createos.sh";
  const baseUrl = raw.startsWith("http") ? raw : `https://${raw}`;
  return { configured: !!apiKey, apiKey, baseUrl };
}

export async function createosWhoami() {
  const c = createosConfig();
  if (!c.configured) return { level: "NOT_CONFIGURED" as const, detail: { baseUrl: c.baseUrl } };
  try {
    const client = createClient({ apiKey: c.apiKey!, baseUrl: c.baseUrl });
    const who = await client.whoami();
    return { level: "LIVE_OBSERVED" as const, detail: { baseUrl: c.baseUrl, whoami: who } };
  } catch (e) {
    return { level: "UNKNOWN" as const, detail: { baseUrl: c.baseUrl, error: (e as Error).message.slice(0, 300) } };
  }
}

const HARNESS = `
const { transform } = require("./transform.js");
const spec = JSON.parse(require("fs").readFileSync(__dirname + "/spec.json", "utf8"));
const eq = (a, b) => JSON.stringify(Object.keys(a).sort().reduce((o,k)=>(o[k]=a[k],o),{})) === JSON.stringify(Object.keys(b).sort().reduce((o,k)=>(o[k]=b[k],o),{}));
const tests = [];
for (const t of spec.tests) {
  try {
    const out = transform(JSON.parse(JSON.stringify(t.input)));
    const pass = t.expect && t.expect.throws ? false : eq(out, t.expect);
    tests.push({ name: t.name, pass, out });
  } catch (e) { tests.push({ name: t.name, pass: !!(t.expect && t.expect.throws), error: String(e && e.message) }); }
}
let proposed = null, error = null;
try { proposed = transform(JSON.parse(JSON.stringify(spec.payload))); } catch (e) { error = String(e && e.message); }
process.stdout.write("FP_RESULT " + JSON.stringify({ tests, proposed, error }) + "\\n");
process.exit(error || tests.some(t => !t.pass) ? 3 : 0);
`;

export type SandboxOutcome = {
  status: "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED" | "ERROR";
  sandbox_id?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  exec_ms?: number;
  parsed?: { tests: { name: string; pass: boolean; error?: string }[]; proposed: unknown; error: string | null };
  error?: string;
  destroyed?: boolean;
};

export async function runInSandbox(code: string, payload: unknown, tests: unknown[]): Promise<SandboxOutcome> {
  const c = createosConfig();
  if (!c.configured) return { status: "NOT_CONFIGURED", error: "CREATEOS_SANDBOX_API_KEY not set" };
  const client = createClient({ apiKey: c.apiKey!, baseUrl: c.baseUrl });
  let sandbox: Awaited<ReturnType<typeof client.createSandbox>> | null = null;
  const out: SandboxOutcome = { status: "ERROR" };
  try {
    sandbox = await client.createSandbox({
      shape: SANDBOX_SHAPE,
      rootfs: SANDBOX_ROOTFS,
      name: `fp-${crypto.randomUUID().slice(0, 8)}`,
      egress: SANDBOX_EGRESS,
    });
    out.sandbox_id = sandbox.id;
    await sandbox.runCommand("mkdir", ["-p", "/tmp/fp"]);
    await sandbox.files.upload("/tmp/fp/transform.js", code);
    await sandbox.files.upload("/tmp/fp/spec.json", JSON.stringify({ payload, tests }));
    await sandbox.files.upload("/tmp/fp/harness.js", HARNESS);
    const check = await sandbox.runCommand("node", ["--check", "/tmp/fp/transform.js"]);
    if (check.result.exit_code !== 0) {
      Object.assign(out, { status: "FAILED", stdout: check.result.stdout, stderr: check.result.stderr, exit_code: check.result.exit_code, error: "syntax check failed" });
      return out;
    }
    const r = await sandbox.runCommand("timeout", ["10", "node", "/tmp/fp/harness.js"]);
    out.stdout = r.result.stdout.slice(0, 20_000);
    out.stderr = (r.result.stderr + (r.result.error ? `\n[agent] ${r.result.error}` : "")).slice(0, 20_000);
    out.exit_code = r.result.exit_code;
    out.exec_ms = r.exec_ms;
    const line = r.result.stdout.split("\n").find((l) => l.startsWith("FP_RESULT "));
    if (line) out.parsed = JSON.parse(line.slice(10));
    out.status = r.result.exit_code === 0 && out.parsed ? "SUCCEEDED" : "FAILED";
    if (out.status === "FAILED") out.error = out.parsed?.error ?? "tests failed or no result line";
    return out;
  } catch (e) {
    out.status = "ERROR";
    out.error = (e as Error).message.slice(0, 500);
    return out;
  } finally {
    if (sandbox) {
      try {
        await sandbox.destroy();
        out.destroyed = true;
      } catch {
        out.destroyed = false;
      }
    }
  }
}