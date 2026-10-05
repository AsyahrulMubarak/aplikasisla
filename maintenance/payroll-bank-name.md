# Employee bank names

The payroll recap for Kendari and Raha includes a free-text bank-name field above each employee's account number. The existing Save button saves both fields together. Names remain available across salary months and appear beside the confirmed account number when printed. Unsaved drafts are retained through recap redraws and errors.

Apply `maintenance/payroll-bank-name.sql` after the bank-account setup. It adds `nama_bank` with an empty default, preserving all existing account numbers. The new server-only `sla_simpan_rekening_bank_pegawai` RPC saves number and bank together and compares both previous values inside the same advisory lock used by the existing RPC. Only Admin Kendari, Manager and Director can edit. Bank names accept up to 100 characters; control characters are rejected. Existing RLS and browser access restrictions remain active.

The Edge Function continues supporting older pages that send only an account number. Those requests update the number through the original RPC and retain any previously saved bank name.

Verification uses synthetic profiles and covers bank-only updates, account leading zeroes, month persistence, old-client compatibility, stale changes, invalid names, denied roles, print values and desktop/mobile layouts. Real bank names and account numbers are not filled by testing.
