'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { test, before, after } = require('node:test');
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch { ({ PGlite } = require(path.resolve(__dirname, '../tmp/sales-claims-qa/node_modules/@electric-sql/pglite'))); }
const db = new PGlite();
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const row = async id => (await query('select * from public.tiket where id_tiket = $1', [id]))[0];
const create = async (id, tech, status = 'On Progress') => {
    await query("insert into public.tiket(id_tiket,teknisi,status,cabang,target_sla_jam,target_sla_respon_jam,waktu_lapor) values($1,$2,$3,'Kendari','9',1,'2026-10-01T08:00:00+08:00')", [id, tech, status]);
};
let legacyBefore;
before(async () => {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.tiket(id_tiket text primary key, waktu_lapor timestamptz,target_sla_jam text,
      tenggat_waktu timestamptz,teknisi text,status text,waktu_selesai timestamptz,status_sla text,
      poin_performa numeric,target_sla_respon_jam numeric,tenggat_respon timestamptz,waktu_respon timestamptz,
      status_sla_respon text,status_peringatan text,tenggat_pengganti timestamptz,cabang text,keterangan text,
      teknisi_sebelumnya text,penalti_teknisi_lama text);
      grant usage on schema public to authenticated,service_role,anon;
      grant all on public.tiket to authenticated,service_role;`);
    await db.exec(fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/20261007093221_sla_pengerjaan_sejak_penugasan.sql'), 'utf8'));
    await create('LEGACY', 'Wawan', 'Selesai');
    await query("update public.tiket set keterangan=$1,teknisi_sebelumnya='Muaz',poin_performa=4 where id_tiket='LEGACY'", ['[1/10/2026, 10.17.06] 🔄 PERGANTIAN TEKNISI\nDari: Muaz\nKe: Wawan']);
    legacyBefore = await row('LEGACY');
    await db.exec(fs.readFileSync(path.resolve(__dirname, 'technician-replacement-rating.sql'), 'utf8'));
});
after(async () => db.close());
test('migration only adds the journal and leaves legacy tickets, assignment deadlines and points unchanged', async () => {
    const value = await row('LEGACY');
    assert.equal(value.riwayat_penggantian_teknisi, null);
    delete value.riwayat_penggantian_teknisi;
    assert.deepEqual(value, legacyBefore);
});
test('localized and ISO legacy audits preserve order and WITA dates; invalid dates are explicitly unknown', async () => {
    const note = '[1/10/2026, 10.17.06] 🔄 PERGANTIAN TEKNISI\nDari: Muaz, Wawan\nKe: Wawan\n[2026-08-20 08:52:45] PERGANTIAN TEKNISI\r\nDari: Wawan\r\nKe: Rendi';
    const result = (await query('select public.sla_catatan_penggantian_teknisi($1,null,null) as history', [note]))[0].history;
    assert.equal(result.length, 2); assert.equal(new Date(result[0].waktu).toISOString(), '2026-10-01T02:17:06.000Z'); assert.equal(new Date(result[1].waktu).toISOString(), '2026-08-20T00:52:45.000Z');
    for (const date of ['31/2/2026, 10.00.00', '1/10/2026, 24.00.00', 'bad']) assert.equal((await query('select public.sla_tanggal_catatan_penggantian($1) as time', [date]))[0].time, null);
});
test('new tickets ignore forged journals and member additions, reordering and aliases do not create removals', async () => {
    await db.exec('set role authenticated');
    await query("insert into public.tiket(id_tiket,teknisi,status,riwayat_penggantian_teknisi) values('FIRST','Belum Ditugaskan','Menunggu',$1)", [JSON.stringify([{ waktu: '2000-01-01', dari: 'Muaz', ke: 'Wawan' }])]);
    for (const names of ['Muaz, Syawal', 'Muhammad Syawal, MUAZ, Wawan', 'Wawan, Muaz, Muhammad Syawal']) await query("update public.tiket set teknisi=$1 where id_tiket='FIRST'", [names]);
    assert.deepEqual((await row('FIRST')).riwayat_penggantian_teknisi, []);
});
test('partial and repeated replacement preserves removed names, server time and existing SLA behavior', async () => {
    await create('REPEAT', 'Muaz, Wawan');
    const before = await row('REPEAT');
    await query("update public.tiket set teknisi='Wawan, Rendi',tenggat_pengganti='2099-01-01T00:00:00Z',waktu_respon=null where id_tiket='REPEAT'");
    let value = await row('REPEAT');
    assert.equal(value.riwayat_penggantian_teknisi.length, 1);
    assert.equal(value.riwayat_penggantian_teknisi[0].dari, 'Muaz, Wawan');
    assert.equal(value.riwayat_penggantian_teknisi[0].sumber, 'server');
    assert.ok(Math.abs(Date.now() - new Date(value.riwayat_penggantian_teknisi[0].waktu).getTime()) < 20000);
    assert.equal(value.tenggat_pengganti.getTime(), value.tenggat_waktu.getTime());
    await query("update public.tiket set teknisi='Muaz' where id_tiket='REPEAT'");
    await query("update public.tiket set teknisi='Wawan' where id_tiket='REPEAT'");
    value = await row('REPEAT');
    assert.equal(value.riwayat_penggantian_teknisi.length, 3);
    assert.equal(value.poin_performa, before.poin_performa);
});
test('first legacy edit captures OLD notes before deletion, then clients cannot erase or append fake events', async () => {
    await query("update public.tiket set keterangan='',riwayat_penggantian_teknisi='[]' where id_tiket='LEGACY'");
    let value = await row('LEGACY'); assert.equal(value.riwayat_penggantian_teknisi.length, 1);
    await query("update public.tiket set riwayat_penggantian_teknisi=$1,keterangan='new note' where id_tiket='LEGACY'", [JSON.stringify([{ dari: 'Fake', ke: 'Other', waktu: '2000-01-01' }])]);
    value = await row('LEGACY'); assert.equal(value.riwayat_penggantian_teknisi.length, 1); assert.equal(value.riwayat_penggantian_teknisi[0].dari, 'Muaz'); assert.equal(Number(value.poin_performa), 4);
});
test('closed ticket corrections and Sales records do not count as work replacements', async () => {
    await create('CLOSED', 'Muaz', 'Selesai'); await create('SLS-1', 'Muaz');
    for (const id of ['CLOSED', 'SLS-1']) {
        await query('update public.tiket set teknisi=$1 where id_tiket=$2', ['Wawan', id]);
        assert.deepEqual((await row(id)).riwayat_penggantian_teknisi, []);
    }
});
test('anonymous users cannot execute helpers and the trigger adds no privileged access path', async () => {
    await db.exec('reset role');
    const permissions = (await query("select has_function_privilege('anon','public.sla_catatan_penggantian_teknisi(text,text,text)','execute') as anon, has_function_privilege('authenticated','public.sla_catatan_penggantian_teknisi(text,text,text)','execute') as authenticated, (select prosecdef from pg_proc where oid='public.sla_jaga_riwayat_penggantian_teknisi()'::regprocedure) as definer"))[0];
    assert.deepEqual(permissions, { anon: false, authenticated: true, definer: false });
});
