/**
 * Provider SDKs may return fractional or malformed execution durations (observed: 72.967 from
 * CreateOS), while runs.exec_ms is PostgreSQL int4. Normalize once here so every call path is safe:
 * finite, non-negative numbers are rounded to the nearest millisecond and bounded; anything else
 * becomes null (unknown duration) rather than throwing at insert time.
 */
export const MAX_EXEC_MS = 3_600_000; // 1 hour upper bound; harness timeout is 10s

export function normalizeExecMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.round(value), MAX_EXEC_MS);
}