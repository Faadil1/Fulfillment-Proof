import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Fulfillment Proof" },
      { name: "description", content: "Operator sign in for the Fulfillment Proof control room." },
      { property: "og:title", content: "Sign in — Fulfillment Proof" },
      { property: "og:description", content: "Operator sign in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message);
      else nav({ to: "/console" });
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/console" } });
      if (error) setMsg(error.message);
      else if (!data.session) setMsg("Check your email to confirm your account, then sign in.");
      else nav({ to: "/console" });
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Fulfillment Proof</p>
        <h1 className="mt-3 text-2xl text-foreground">{mode === "in" ? "Operator sign in" : "Create operator account"}</h1>
        <label className="mt-6 block text-sm font-medium" htmlFor="email">Email</label>
        <input id="email" type="email" required autoComplete="email" className="field mt-1" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="mt-4 block text-sm font-medium" htmlFor="pw">Password</label>
        <input id="pw" type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} className="field mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
        {msg && <p role="status" className="mt-4 text-sm text-destructive">{msg}</p>}
        <button disabled={busy} className="btn-primary mt-6 w-full py-2">{busy ? "Working…" : mode === "in" ? "Sign in" : "Create account"}</button>
        <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-3 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          {mode === "in" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}