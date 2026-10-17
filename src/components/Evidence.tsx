const styles: Record<string, string> = {
  NOT_CONFIGURED: "border-border text-muted-foreground bg-muted",
  TEST_FIXTURE: "border-warning/60 text-foreground bg-warning/15",
  LIVE_TEST_MODE: "border-primary/50 text-primary bg-accent",
  LIVE_OBSERVED: "border-primary text-primary-foreground bg-primary",
  PARTIAL: "border-warning text-foreground bg-warning/25",
  UNKNOWN: "border-border text-muted-foreground bg-card",
  REFUSED: "border-destructive text-destructive bg-destructive/10",
  CONFIGURED: "border-primary/50 text-primary bg-accent",
};

export function Evidence({ level }: { level: string }) {
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider ${styles[level] ?? styles["UNKNOWN"]}`}>
      {level}
    </span>
  );
}

const statusTone: Record<string, string> = {
  VERIFIED: "text-primary",
  READY_TO_WRITE: "text-primary",
  AWAITING_APPROVAL: "text-warning",
  RECONCILE: "text-destructive",
  FAILED: "text-destructive",
  REFUSED: "text-destructive",
};
export function Status({ s }: { s: string }) {
  return <span className={`font-mono text-[11px] font-medium ${statusTone[s] ?? "text-muted-foreground"}`}>{s}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}