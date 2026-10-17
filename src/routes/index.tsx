import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fulfillment Proof — no orphaned paid orders" },
      { name: "description", content: "Operator control room that repairs order-to-fulfillment contract drift in a CreateOS sandbox and verifies the outcome exactly once." },
      { property: "og:title", content: "Fulfillment Proof" },
      { property: "og:description", content: "Repair contract drift in a real sandbox. Verify the business outcome, not the 200." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-16 md:py-24">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Fulfillment Proof</p>
        <h1 className="mt-6 max-w-3xl text-4xl leading-[1.05] text-foreground md:text-6xl">
          A paid order isn't done when the webhook returns 200.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Catch contract drift between checkout and fulfillment, let an agent write a repair, run it inside a
          CreateOS sandbox, gate risky writes on a human, and verify the destination record exists exactly once.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link to="/console" className="btn-primary px-5 py-2.5">Open control room</Link>
          <Link to="/auth" className="btn-ghost px-5 py-2.5">Sign in</Link>
        </div>
        <ol className="mt-20 grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-4">
          {[
            ["01", "Ingest", "Signed per-tenant endpoint. Unsigned is rejected."],
            ["02", "Diagnose", "Strict contract finds drift: renamed totals, nested SKUs."],
            ["03", "Execute", "Generated transform runs only in a CreateOS microVM."],
            ["04", "Verify", "Independent verifier reads the durable record back."],
          ].map(([n, t, d]) => (
            <li key={n} className="bg-card p-5">
              <span className="font-mono text-xs text-muted-foreground">{n}</span>
              <h2 className="mt-2 text-xl text-foreground">{t}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}