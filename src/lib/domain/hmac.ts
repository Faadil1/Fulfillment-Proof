// HMAC-SHA256 signing used by the inbound endpoint. Header: x-fp-signature: t=<unix>,v1=<hex>
// Signed message: `${t}.${rawBody}`. Tolerance 300s.
export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifySignature(secret: string, header: string | null, body: string, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts["t"]);
  if (!t || !parts["v1"]) return { ok: false, reason: "malformed signature" };
  if (Math.abs(nowSec - t) > 300) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = await hmacHex(secret, `${t}.${body}`);
  return safeEqual(expected, parts["v1"]) ? { ok: true as const } : { ok: false, reason: "signature mismatch" };
}

export async function signBody(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}`;
}