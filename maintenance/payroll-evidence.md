# Payroll evidence PDFs

Each individual salary slip has separate fee marketing and kasbon evidence slots, keyed by the canonical payroll username, salary month and component. One current PDF per slot, maximum 5 MiB. Uploading/replacing/deleting evidence never changes payroll amounts.

Admin Kendari, Manager and Director may upload, replace and delete, subject to the seven-day payroll grace period (through day 7 at 23:59 WITA, locked from day 8). Admin Raha, legacy Admin Raha and all ordinary employees have read-only access to their own evidence. Identity is verified through Supabase Auth and the current database profile; browser-supplied roles are ignored.

Apply `maintenance/payroll-evidence.sql` through Supabase migrations, then deploy `supabase/functions/sla-payroll-attendance/index.ts`. The private `sla-payroll-private` Storage bucket accepts PDFs only. `sla_bukti_payroll` has RLS, a server-only policy, and no anon/authenticated grants. The write RPC is security invoker and executable only by the service role. All browser actions go through the authenticated Edge Function.

Signed links are generated on each view/download and expire after five minutes. PDF names, size, MIME and header/end marker are checked on the server. Replacing or deleting compares the previous document ID inside a database advisory lock, preventing stale edits from overwriting a more recent file. The previous object is removed after the metadata change succeeds. Confirmed rejected uploads are cleaned; ambiguous network failures retain the object because the database may already have committed. Reload evidence after an uncertain response before making another change.

Validation:

- `node --test tests/payroll-evidence.test.cjs` exercises Edge authorization, employee/month/type isolation, PDFs, replacement/deletion, signed downloads and failure cleanup.
- `node --test maintenance/payroll-evidence-database.test.cjs` verifies actual PostgreSQL permissions, RLS, bucket settings, atomic version checks and period locks with PGlite. Install `@electric-sql/pglite` in an isolated QA directory or supply it through Node's module path.
- `maintenance/verify-payroll-evidence.cjs` is a local browser QA harness with synthetic employees and responses; it verifies desktop/mobile controls, uploads, downloads, deletion, reload, denied roles, races and errors. It requires the configured desktop Playwright runtime and Chrome.

The production HTML is prepared from the existing production source so independent local payroll changes are not included. No private audit data or credentials are part of this feature.
