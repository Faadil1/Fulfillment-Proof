<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Browser reads data via RLS (SELECT-only, org-scoped); every write goes through `src/lib/ops.functions.ts`, which checks `can_operate` as the caller before using the service role. Why: generated code and clients must never hold write credentials.
- Pure domain logic (contract, policy, verifier, HMAC) lives in `src/lib/domain/` with tests; the verifier must not import generator/executor code. Why: independent verification.
- Generated code is never evaluated on the server; it executes only via `src/lib/server/createos.server.ts`. No local fallback. Why: honesty + isolation.
- Evidence levels shown in UI must derive from stored rows/network results, never constants. Why: no fake statuses.
- Multi-row state transitions that must be atomic (e.g. approval decision + incident status + audit) use a SECURITY DEFINER SQL function called as the caller, with row locks and its own role check. Why: separate PostgREST updates can leave partial state.
