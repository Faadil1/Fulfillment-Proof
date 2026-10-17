// Signing-secret helpers (pure). Same format for create and rotate.
export const SECRET_PREFIX = "fpsec_";

export function generateSigningSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return SECRET_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function secretHint(secret: string): string {
  return secret.slice(-4);
}

/** Only org owners may rotate. Mirrors the DB check in rotate_integration_secret. */
export function canRotateSecret(role: string | null | undefined): boolean {
  return role === "owner";
}