// Dependency QA terisolasi: npm install --prefix tmp/sales-claims-qa @electric-sql/pglite
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { PGlite } = require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const db = new PGlite();
const migration = fs.readFileSync(path.join(__dirname, 'sales-claims.sql'), 'utf8');
const photo = 'data:image/jpeg;base64,' + 'A'.repeat(100);
async function role(name = 'service_role') {
  await db.exec(`reset role; set role ${name}; select set_config('request.jwt.claim.role', '${name}', false);`);
}
async function ticket(id, cabang = 'Kendari', sales = '') {
  await role();
  await db.query('insert into public.tiket(id_tiket,cabang,sales,klien_lokasi,pekerjaan) values ($1,$2,$3,$4,$5)', [id,cabang,sales,'Klien Uji','Pekerjaan Uji']);
}
const submit = (id, branch = 'Kendari', actor = 'sales-k', evidence = photo) =>
  db.query('select public.sla_ajukan_klaim_sales($1,$2,$3,$4,$5) as result', [actor,id,branch,'Keterangan Uji',evidence]);
const decide = (id, branch = 'Kendari', decision = 'Diterima', actor = 'admin-k', reason = '') =>
  db.query('select public.sla_respon_klaim_sales($1,$2,$3,$4,$5) as result', [actor,id,branch,decision,reason]);
const rows = async sql => (await db.query(sql)).rows;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    create table public.users(username text, username_login text unique, nama_asli text, role text, hak_akses_cabang text, no_wa text);
    create table public.tiket(id_tiket text primary key, cabang text, sales text, status_banding text, sales_pengaju text,
      bukti_banding text, keterangan_sales text, alasan_admin text, klien_lokasi text, pekerjaan text);
    grant all on public.users, public.tiket to service_role, authenticated;
    insert into public.users values
      ('admin-k','admin-k','Admin K','admin','Kendari','081111111111'),
      ('admin-all','admin-all','Admin Pusat','admin','Semua','082222222222'),
      ('admin-blank','admin-blank','Admin Lama','admin',null,'083333333333'),
      ('admin-r','admin-r','Admin R','admin','Raha','084444444444'),
      ('admin-raha','admin-raha','Admin Raha','admin_raha','Raha','085555555555'),
      ('manager','manager','Manager','manager','Semua','086666666666'),
      ('director','director','Director','direktur','Semua','087777777777'),
      ('sales-k','sales-k','Sales K','sales','Kendari','088888888888'),
      ('sales-r','sales-r','Sales R','sales','Raha','089999999999'),
      ('sales-duplicate-1','sales-duplicate-1','Sales Sama','sales','Kendari','081111222222'),
      ('sales-duplicate-2','sales-duplicate-2','Sales Sama','sales','Raha','081111333333');
    insert into public.tiket(id_tiket,cabang,status_banding,sales_pengaju,alasan_admin) values
      ('OLD-K',null,'Diajukan','Sales K',null),('OLD-R','Raha','Ditolak','Sales R','Alasan lama'),
      ('OLD-ACCEPTED','Raha','Diterima','Sales R',null),('OLD-AMBIGUOUS','Raha','Diajukan','Sales Sama',null);
  `);
  await db.exec(migration);
  await db.exec(migration);
  await role();
});
after(async () => { await db.close(); });

test('Migration compiles, repeats safely, and preserves all old statuses in history without retrospective WA', async () => {
  const old = await rows('select * from public.tiket order by id_tiket');
  assert.equal(old.length, 4); assert.ok(old.every(t => t.klaim_sales_id && t.klaim_sales_diajukan_pada === null));
  assert.equal(old.find(t => t.id_tiket === 'OLD-K').klaim_sales_username, 'sales-k');
  assert.equal(old.find(t => t.id_tiket === 'OLD-R').alasan_admin, 'Alasan lama');
  assert.equal(old.find(t => t.id_tiket === 'OLD-AMBIGUOUS').klaim_sales_username, null);
  assert.equal((await rows('select * from public.sla_notif_klaim_sales')).length, 0);
});
test('Old pending claim remains actionable, accepted claimant comes from stored ticket, and WA targets stored username', async () => {
  await decide('OLD-K');
  const t = (await rows("select * from public.tiket where id_tiket='OLD-K'"))[0];
  assert.equal(t.status_banding, 'Diterima'); assert.equal(t.sales, 'Sales K');
  assert.equal(t.klaim_sales_diajukan_pada, null); assert.equal(t.klaim_sales_admin, 'admin-k');
  const events = await rows("select * from public.sla_notif_klaim_sales where klaim_id='" + t.klaim_sales_id + "'");
  assert.equal(events.length, 1); assert.equal(events[0].penerima_username, 'sales-k');
});
test('Ambiguous historical name is never assigned to a guessed account', async () => {
  await assert.rejects(decide('OLD-AMBIGUOUS', 'Raha'), /belum teridentifikasi/);
  assert.equal((await rows("select status_banding from public.tiket where id_tiket='OLD-AMBIGUOUS'"))[0].status_banding, 'Diajukan');
});
test('Both branches submit atomically, with WA only to Kendari admins including central and legacy admins', async () => {
  for (const branch of ['Kendari','Raha']) {
    const id = 'NEW-' + branch; await ticket(id, branch); await submit(id, branch, branch === 'Raha' ? 'sales-r' : 'sales-k');
    const t = (await rows(`select * from public.tiket where id_tiket='${id}'`))[0];
    assert.equal(t.status_banding, 'Diajukan'); assert.ok(t.klaim_sales_diajukan_pada);
    const events = await rows(`select * from public.sla_notif_klaim_sales where klaim_id='${t.klaim_sales_id}' order by penerima_username`);
    assert.deepEqual(events.map(n => n.penerima_username), ['admin-all','admin-blank','admin-k']);
    assert.ok(events.every(n => n.snapshot.cabang === branch));
    await assert.rejects(submit(id, branch, 'sales-r'), /sudah memiliki pengajuan/);
  }
});
test('Database independently denies Admin Raha, Manager, Director and Sales decisions', async () => {
  for (const actor of ['admin-r','admin-raha','manager','director','sales-k']) await assert.rejects(decide('NEW-Raha','Raha','Diterima',actor), /Hanya Admin Kendari/);
  assert.equal((await rows("select status_banding from public.tiket where id_tiket='NEW-Raha'"))[0].status_banding, 'Diajukan');
});
test('Rejection requires reason, records real admin, notifies the applicant, and cannot be overwritten', async () => {
  await assert.rejects(decide('NEW-Raha','Raha','Ditolak','admin-all',' '), /wajib diisi/);
  await decide('NEW-Raha','Raha','Ditolak','admin-all','Bukti belum sesuai');
  const t = (await rows("select * from public.tiket where id_tiket='NEW-Raha'"))[0];
  assert.equal(t.status_banding, 'Ditolak'); assert.equal(t.sales, ''); assert.equal(t.alasan_admin, 'Bukti belum sesuai');
  assert.equal(t.klaim_sales_admin, 'admin-all');
  const event = (await rows(`select * from public.sla_notif_klaim_sales where klaim_id='${t.klaim_sales_id}' and jenis='Ditolak'`))[0];
  assert.equal(event.penerima_username, 'sales-r'); assert.equal(event.snapshot.alasan, 'Bukti belum sesuai');
  await assert.rejects(decide('NEW-Raha','Raha'), /sudah diproses/);
});
test('Two decisions produce exactly one outcome and one WA result event', async () => {
  const result = await Promise.allSettled([decide('NEW-Kendari'), decide('NEW-Kendari','Kendari','Ditolak','admin-k','Tidak sesuai')]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  const t = (await rows("select * from public.tiket where id_tiket='NEW-Kendari'"))[0];
  assert.equal(t.sales, 'Sales K');
  assert.equal((await rows(`select * from public.sla_notif_klaim_sales where klaim_id='${t.klaim_sales_id}' and jenis in ('Diterima','Ditolak')`)).length, 1);
});
test('Browser cannot call privileged RPC with forged admin, update claim fields, insert claims, or bypass via Sales edits', async () => {
  await ticket('GUARD'); await submit('GUARD');
  await role('authenticated');
  await assert.rejects(decide('GUARD','Kendari','Diterima','admin-k'), /permission denied/);
  await assert.rejects(db.exec("update public.tiket set status_banding='Diterima', sales='Fake' where id_tiket='GUARD'"), /wajib melalui backend/);
  await assert.rejects(db.exec("update public.tiket set sales='Fake' where id_tiket='GUARD'"), /wajib melalui backend/);
  await assert.rejects(db.exec("insert into public.tiket(id_tiket,status_banding,sales_pengaju) values('FORGED','Diajukan','Fake')"), /wajib melalui backend/);
  await assert.rejects(db.exec('select * from public.sla_notif_klaim_sales'), /permission denied/);
  await db.exec("update public.tiket set pekerjaan='Perubahan biasa' where id_tiket='GUARD'");
  await role();
});
test('Wrong branch, non-Sales, assigned tickets and invalid evidence never create claims', async () => {
  await ticket('CHECK'); await ticket('ASSIGNED','Kendari','Sales Lain');
  await assert.rejects(submit('CHECK','Raha'), /no rows/);
  await assert.rejects(submit('CHECK','Kendari','admin-k'), /Hanya Sales/);
  await assert.rejects(submit('ASSIGNED'), /sudah memiliki Sales/);
  await assert.rejects(submit('CHECK','Kendari','sales-k','javascript:evil()'), /foto bukti/);
  assert.equal((await rows("select status_banding from public.tiket where id_tiket='CHECK'"))[0].status_banding, null);
});
test('Failed outbox write rolls back the claim itself', async () => {
  await ticket('ATOMIC'); await db.exec(`reset role;
    create function public.qa_reject_outbox() returns trigger language plpgsql as $$ begin raise exception 'QA outbox unavailable'; end $$;
    create trigger qa_reject_outbox before insert on public.sla_notif_klaim_sales for each row execute function public.qa_reject_outbox();`);
  await role(); await assert.rejects(submit('ATOMIC'), /QA outbox unavailable/);
  assert.equal((await rows("select status_banding from public.tiket where id_tiket='ATOMIC'"))[0].status_banding, null);
  await db.exec('reset role; drop trigger qa_reject_outbox on public.sla_notif_klaim_sales; drop function public.qa_reject_outbox();'); await role();
});
test('Database leases prevent overlapping workers and completed or failed events follow correct retry behavior', async () => {
  const [a,b] = await Promise.all([db.query('select * from public.sla_ambil_notif_klaim_sales(null)'),db.query('select * from public.sla_ambil_notif_klaim_sales(null)')]);
  assert.ok(a.rows.length); assert.ok(b.rows.every(n => !a.rows.some(m => m.id === n.id)));
  const n = a.rows[0];
  const finish = (lease, sent, error = '') => db.query('select public.sla_selesaikan_notif_klaim_sales($1,$2,$3,$4) as done',[n.id,lease,sent,error]);
  assert.equal((await finish('00000000-0000-0000-0000-000000000000',true)).rows[0].done,false);
  assert.equal((await finish(n.lease_id,false,'Gateway gagal')).rows[0].done,true);
  const failed = (await rows(`select * from public.sla_notif_klaim_sales where id='${n.id}'`))[0];
  assert.equal(failed.terkirim_pada,null); assert.equal(failed.error_terakhir,'Gateway gagal'); assert.equal(failed.lease_id,null);
  assert.ok(!(await rows(`select * from public.sla_ambil_notif_klaim_sales('${n.klaim_id}')`)).some(row => row.id === n.id));
  await db.exec(`update public.sla_notif_klaim_sales set coba_pada=now()-interval '1 minute' where id='${n.id}'`);
  const retry = (await rows(`select * from public.sla_ambil_notif_klaim_sales('${n.klaim_id}')`)).find(row => row.id === n.id);
  assert.ok(retry); assert.equal(retry.percobaan,2);
  assert.equal((await finish(retry.lease_id,true)).rows[0].done,true);
  assert.ok((await rows(`select terkirim_pada from public.sla_notif_klaim_sales where id='${n.id}'`))[0].terkirim_pada);
  assert.equal((await finish(retry.lease_id,true)).rows[0].done,false);
});
test('One global sender lease serializes simultaneous Kendari and Raha workers and recovers expired leases', async () => {
  const acquire=()=>db.query('select public.sla_mulai_pengiriman_klaim_sales() as lease');
  const [a,b]=await Promise.all([acquire(),acquire()]);
  assert.ok(a.rows[0].lease);assert.equal(b.rows[0].lease,null);
  const release=lease=>db.query('select public.sla_akhiri_pengiriman_klaim_sales($1) as done',[lease]);
  assert.equal((await release('00000000-0000-0000-0000-000000000000')).rows[0].done,false);
  assert.equal((await acquire()).rows[0].lease,null);
  assert.equal((await release(a.rows[0].lease)).rows[0].done,true);
  const c=(await acquire()).rows[0].lease;assert.ok(c);
  await db.exec("update public.sla_pengirim_klaim_sales set terkunci_sampai=now()-interval '1 minute'");
  const d=(await acquire()).rows[0].lease;assert.ok(d);assert.notEqual(c,d);
  assert.equal((await release(c)).rows[0].done,false);assert.equal((await release(d)).rows[0].done,true);
});
