# Employee account access — 22 October 2026

Account access is separate from salary eligibility. All 39 profiles start active.
Admins use Daftar Akun Sistem → Nonaktifkan / Aktifkan kembali, with a reason.
Branch access, self changes, stale versions and pending operations are checked on the server.

The profile and Auth UUID remain unchanged. No ticket, financial history, posted
bonus snapshot, payroll slip, salary credit or password/passkey is deleted.
The Auth admin API bans/unbans the existing identity. Database access stays closed
while synchronization is pending; retry the same operation to recover.

Every employee Edge entrypoint calls sla_assert_account_session with the user's
verified bearer token. PostgREST pre-request and restrictive RLS policies use the
same live account/session check. The original auth.sessions.created_at must be
newer than account_session_after, so refreshing a pre-disable session does not
restore it after reactivation. Background server jobs and public client tracking
retain their existing authentication and authorization paths.

New achievement postings exclude warranty claims, Cancel/Batal and Outsource.
The scoring engine excludes those achievement points while keeping warranty
quality/SLA review separate. Policy revision 2 keeps the November 2026 official
start, target, weights and credit limits. Existing ledgers are not backfilled.

Ticket admins also have manual Chat WA Klien and individual Chat WA Sales links.
Numbers are validated from the ticket/profile, ambiguous names disable shortcuts,
and opening a chat does not send a message. Existing automated WA hooks remain.

Follow-up recovery for reduced teams: if excluding the former team leaves no
recipient, intersect current assignees with the latest server-confirmed `ke` team.
For TKT-153 (Ardi S, Muaz → Muaz), Muaz remains reachable; Ardi S is excluded.

Validation: account database and full browser → profile Edge → database flow;
old-session denial after reactivation, failed Auth synchronization recovery,
branch/self/stale checks, unchanged history, achievement exclusions, performance
and payroll regressions, manual chat permissions, follow-up recipients, and
warranty notification mocks. No real WhatsApp test message is sent.

The local checkout has unrelated unpublished index.html changes. The production
release was built from the verified live b9650588 baseline in
tmp/account-access-release/release, not from the entire local root. See the
release verification report in output/account-access-qa before the next release.

