'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.PAYROLL_EDGE_SOURCE || path.join(root, 'supabase/functions/sla-payroll-attendance/index.ts'), 'utf8');
const shared = fs.readFileSync(path.join(root, 'maintenance/payroll-profile.gs'), 'utf8');
const profile = (username, name, role, access, salary = 1500000) => ({ username, nama_asli: name, role, hak_akses_cabang: access, gaji_pokok: salary });
const staff = [
  profile('Manager', 'Abu Abdillah', 'manager', 'Semua', 3000000),
  profile('abu abdillah', 'Abu Abdillah', 'sales', 'Kendari', null),
  profile('admin', 'ABU ABID', 'admin', 'Semua', 3000000),
  profile('Abu Abid', 'Abu Abid', 'sales', 'Kendari', null),
  profile('admin raha', 'Abu Naura', 'admin_raha', 'Raha', 2000000),
  profile('abu naura', 'Abu Naura', 'teknisi', 'Raha', 0),
  profile('ardan', 'Ardan', 'sales', 'Raha', 2000000),
  profile('Alif', 'Alif', 'teknisi', 'Kendari'),
  profile('juna', 'Juna', 'sales', 'Kendari'),
  profile('rendi', 'Rendi', 'teknisi', 'Raha'),
];
const actor = { username: 'admin', name: 'ABU ABID', role: 'admin', branch: 'Kendari', homeBranch: 'Kendari', access: 'Semua', salary: 3000000 };
const body = { periode: '2026-09', namaPegawai: 'Abu Abdillah', fee: '11975', kasbon: '1290281', luarKota: '3, 12, 31', liburTambahan: '5, 5, 24' };
function harness(profiles = staff) {
  const records = new Map(), writes = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-03T12:00:00+08:00'])); } }
  const c = vm.createContext({ Date: Clock, Intl, console, Response, Request, URLSearchParams, AbortSignal, crypto,
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', SUPABASE_ANON_KEY: 'test-public' })[name] }, serve() {} },
    fetch: async (url, options) => {
      const u = new URL(url), table = u.pathname.split('/').pop();
      const eq = (rows, column) => u.searchParams.has(column) ? rows.filter(r => r[column] === u.searchParams.get(column).slice(3)) : rows;
      if (table === 'users') {
        const selected = (u.searchParams.get('select') || '*').split(',');
        return Response.json(eq(profiles, 'nama_asli').map(p => selected.includes('*') ? p : Object.fromEntries(selected.map(k => [k, p[k]]))));
      }
      if (table === 'payroll_bulanan') {
        if (options.method === 'POST') {
          const rows = JSON.parse(options.body); writes.push(...rows);
          rows.forEach(r => records.set(r.kunci_payroll, r));
          return Response.json(rows);
        }
        return Response.json(eq(eq(eq([...records.values()], 'kunci_payroll'), 'periode'), 'nama_pegawai'));
      }
      throw Error('Unexpected request ' + table);
    }
  });
  vm.runInContext(source, c);
  const front = vm.createContext({}); vm.runInContext(shared, front);
  const ui = profiles.map(p => ({ Username: p.username, 'Nama Asli': p.nama_asli, Role: p.role, Hak_Akses_Cabang: p.hak_akses_cabang, 'Gaji Pokok': p.gaji_pokok }));
  return { c, front, ui, records, writes };
}

test('Regression: manager monthly components save despite the matching sales account', async () => {
  const { c, writes } = harness();
  const saved = await c.dispatch({ action: 'simpanVariabelPayroll', ...body }, actor);
  assert.equal(saved.status, 'sukses'); assert.equal(saved.data.namaPegawai, 'Abu Abdillah');
  assert.equal(saved.data.fee, 11975); assert.equal(saved.data.kasbon, 1290281);
  assert.equal(saved.data.luarKota, '3, 12'); assert.equal(saved.data.liburTambahan, '5, 24');
  assert.equal(writes[0].diperbarui_oleh, actor.name);
});

test('All named payroll profiles match the slip selector regardless of account order', async () => {
  for (const profiles of [staff, [...staff].reverse(), staff.map(p => p.role === 'sales' && p.nama_asli === 'Abu Abdillah' || p.role === 'teknisi' && p.nama_asli === 'Abu Naura' ? { ...p, gaji_pokok: 9000000 } : p)]) {
    const { c, front, ui } = harness(profiles);
    for (const name of ['Abu Abdillah', 'ABU ABID', 'Abu Naura', 'Ardan', 'Alif', 'Juna', 'Rendi']) {
      const expected = front.pilihProfilPayroll_(ui, name, body.periode);
      assert.equal(c.selectPayrollProfile(profiles, name, body.periode)?.username, expected?.Username);
      const saved = await c.savePayroll({ ...body, namaPegawai: name }, actor);
      assert.equal(saved.status, 'sukses'); assert.equal(saved.data.namaPegawai, expected['Nama Asli']);
    }
  }
});

test('Abu Naura uses admin Raha before October and the unique Raha technician from October onward', async () => {
  const { c, front, ui } = harness();
  for (const period of ['2026-09', '2026-10', '2026-11', '2027-01']) {
    const expected = period < '2026-10' ? 'admin raha' : 'abu naura';
    assert.equal(c.selectPayrollProfile(staff, 'Abu Naura', period).username, expected);
    assert.equal(front.pilihProfilPayroll_(ui, 'Abu Naura', period).Username, expected);
  }
  assert.equal(c.selectPayrollProfile(staff.filter(p => p.role !== 'teknisi'), 'Abu Naura', '2026-10'), null);
  assert.equal(c.selectPayrollProfile([...staff, { ...staff[5], username:'duplicate' }], 'Abu Naura', '2026-10'), null);
  await assert.rejects(c.getPayroll({ periode:'2026-10', cabang:'Raha' }, { ...actor, name:'Abu Naura', role:'admin_raha', branch:'Raha', homeBranch:'Raha', access:'Raha' }), /akun teknisi Raha/);
});

test('Names, legacy admin Raha role and branch whitespace resolve to the stored profile', async () => {
  const profiles = staff.map(p => p.username === 'admin raha' ? { ...p, role: ' Admin ', hak_akses_cabang: ' Raha ' } : p);
  const { c } = harness(profiles);
  assert.equal((await c.savePayroll({ ...body, namaPegawai: ' abu   abdillah ' }, actor)).data.namaPegawai, 'Abu Abdillah');
  assert.equal((await c.savePayroll({ ...body, namaPegawai: 'ABU NAURA' }, actor)).data.namaPegawai, 'Abu Naura');
  const fallback = harness([ { ...profile('worker', 'Worker', 'teknisi', ''), cabang: ' Kendari ' } ]);
  assert.equal((await fallback.c.savePayroll({ ...body, namaPegawai: 'Worker' }, actor)).status, 'sukses');
});

test('Missing intended roles, unknown employees and genuinely duplicate payroll profiles stay rejected without writes', async () => {
  for (const profiles of [staff.filter(p => p.username !== 'Manager'), [...staff, { ...staff[0], username: 'second-manager' }], [profile('a', 'Worker', 'teknisi', 'Kendari'), profile('b', 'Worker', 'teknisi', 'Kendari')]]) {
    const { c, writes } = harness(profiles);
    for (const name of ['Abu Abdillah', 'Worker', 'Missing']) await assert.rejects(c.savePayroll({ ...body, namaPegawai: name }, actor), /Profil payroll/);
    assert.equal(writes.length, 0);
  }
});

test('Management roles can save both branches; other roles and zero salary managers cannot write', async () => {
  const { c, writes } = harness();
  for (const manager of [actor, { ...actor, role: 'manager', access: 'Kendari' }, { ...actor, role: 'direktur', salary: 0 }]) {
    for (const name of ['Abu Abdillah', 'Alif', 'Ardan', 'Abu Naura']) assert.equal((await c.savePayroll({ ...body, namaPegawai: name }, manager)).status, 'sukses');
  }
  const count = writes.length;
  for (const role of ['sales', 'teknisi', 'freelance', 'admin_raha']) await assert.rejects(c.savePayroll(body, { ...actor, role }), /Manajemen/);
  await assert.rejects(c.savePayroll(body, { ...actor, role: 'admin', branch: 'Raha', homeBranch: 'Raha' }), /Manajemen/);
  await assert.rejects(c.savePayroll(body, { ...actor, role: 'manager', salary: 0 }), /Manajemen/);
  assert.equal(writes.length, count);
});

test('Updating the selected month preserves other months and omitted extra holidays', async () => {
  const { c, records } = harness();
  await c.savePayroll(body, actor);
  await c.savePayroll({ ...body, periode: '2026-10', fee: 100, kasbon: 0 }, actor);
  const updated = await c.savePayroll({ ...body, fee: 25000, liburTambahan: undefined }, actor);
  assert.equal(updated.data.fee, 25000); assert.equal(updated.data.liburTambahan, '5, 24');
  assert.equal(records.get('2026-10_abu abdillah').fee_marketing, 100);
  assert.equal(records.size, 2);
});

test('Period locks, invalid amounts and invalid target branches cannot create payroll records', async () => {
  const { c, writes } = harness();
  for (const patch of [{ periode: '2026-08' }, { fee: -1 }, { kasbon: 'NaN' }, { periode: '2026-13' }]) await assert.rejects(c.savePayroll({ ...body, ...patch }, actor));
  const invalid = harness([profile('worker', 'Worker', 'teknisi', 'Unknown')]);
  await assert.rejects(invalid.c.savePayroll({ ...body, namaPegawai: 'Worker' }, actor), /Cabang/);
  assert.equal(writes.length, 0); assert.equal(invalid.writes.length, 0);
});
