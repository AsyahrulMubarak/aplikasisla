const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const assessmentSource = fs.readFileSync(__dirname + '/../ticket-assessment.js', 'utf8');
const grade = { value: 'B', points: 4, status: 'approved', reason: 'Diagnosis dan perbaikan perangkat', reviewedName: 'Admin', scope: 'Servis' };
function context() {
  const c = vm.createContext({ console, Date, penggunaAktif: { 'Nama Asli': 'Admin' }, rolePengguna: () => 'admin' });
  const match = html.match(/^([ \t]*)function upsertRecordRealtime_\([^]*?^\1\}/m);
  vm.runInContext(match[0], c);
  vm.runInContext(assessmentSource, c);
  return c;
}

test('status realtime parsial mempertahankan grade dan event lama tidak menimpa tiket terbaru', () => {
  const c = context();
  let tickets = [{ 'ID Tiket': 'TKT-1', Status: 'On Progress', 'Versi Workflow': 5, 'Penilaian Teknisi': { revision: 2, grade } }];
  tickets = c.upsertRecordRealtime_(tickets, 'ID Tiket', 'TKT-1', { 'ID Tiket': 'TKT-1', Status: 'Pending', 'Versi Workflow': 6, 'Penilaian Teknisi': undefined });
  assert.equal(tickets[0].Status, 'Pending');
  assert.equal(tickets[0]['Penilaian Teknisi'].grade.value, 'B');
  tickets = c.upsertRecordRealtime_(tickets, 'ID Tiket', 'TKT-1', { 'ID Tiket': 'TKT-1', Status: 'On Progress', 'Versi Workflow': 4, 'Penilaian Teknisi': null });
  assert.equal(tickets[0].Status, 'Pending');
  assert.equal(tickets[0]['Penilaian Teknisi'].grade.value, 'B');
  // Explicit newer server values remain authoritative; this is not a permanent grade cache.
  tickets = c.upsertRecordRealtime_(tickets, 'ID Tiket', 'TKT-1', { 'ID Tiket': 'TKT-1', 'Versi Workflow': 7, 'Penilaian Teknisi': null });
  assert.equal(tickets[0]['Penilaian Teknisi'], null);
});

test('grade tersimpan tetap terlihat pada pergantian status tanpa mengaktifkan poin yang dikecualikan', () => {
  const c = context();
  for (const status of ['Menunggu', 'On Progress', 'Pending', 'Outsource', 'Cancel', 'Batal', 'Selesai']) {
    const rendered = c.htmlPenilaianTiket_({ 'ID Tiket': 'TKT-1', Status: status, Teknisi: 'Teknisi A', 'Penilaian Teknisi': { grade } });
    assert.match(rendered, /B/);
    assert.match(rendered, /Diagnosis dan perbaikan perangkat/);
    if (['Outsource', 'Cancel', 'Batal'].includes(status)) {
      assert.match(rendered, /Grade B tersimpan/);
      assert.match(rendered, /0 poin pencapaian/);
      assert.doesNotMatch(rendered, /bukaPenilaianTiket_\('TKT-1','grade'/);
    }
  }
  for (const status of ['excluded', 'review_required']) {
    const rendered = c.htmlPenilaianTiket_({ 'ID Tiket': 'TKT-1', Status: 'On Progress', Teknisi: 'Teknisi A', 'Penilaian Teknisi': { grade, technicianPoints: { status } } });
    assert.match(rendered, /Grade B tersimpan/);
    assert.match(rendered, /Poin bonus teknisi: 0/);
  }
});

test('grade dan audit tidak terhapus saat status berubah di PostgreSQL', async () => {
  const { automaticFixture } = require('../maintenance/automatic-achievement-test-fixture.cjs');
  const f = await automaticFixture();
  try {
    await f.grade('B', 'admin');
    const original = (await f.read()).assessment.grade;
    for (const status of ['Pending', 'Outsource', 'On Progress', 'Cancel', 'On Progress']) {
      await f.db.query("update tiket set status=$1 where id_tiket='TKT-1'", [status]);
      assert.deepEqual((await f.read()).assessment.grade, original);
    }
    await f.complete();
    assert.deepEqual((await f.read()).assessment.grade, original);
    assert.equal((await f.db.query("select count(*)::int n from sla_penilaian_tiket_audit where id_tiket='TKT-1' and tindakan='setGrade'")).rows[0].n, 1);
  } finally { await f.db.close(); }
});
