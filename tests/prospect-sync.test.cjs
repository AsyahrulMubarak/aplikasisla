const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const frontendSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const backendRoot = [root, path.resolve(root, '..')].find(candidate =>
  fs.existsSync(path.join(candidate, 'code.js')) && fs.existsSync(path.join(candidate, 'coderaha.js.txt'))
) || null;

function extractFunction(source, functionName) {
  const patterns = [`async function ${functionName}`, `function ${functionName}`];
  const start = patterns.map(pattern => source.indexOf(pattern)).find(index => index >= 0);
  assert.notEqual(start, undefined, `Function ${functionName} tidak ditemukan`);
  const openBrace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Penutup function ${functionName} tidak ditemukan`);
}

function frontendHarness(prospects, options = {}) {
  const patches = [];
  const notifications = [];
  const queries = [];
  const context = vm.createContext({
    console: { ...console, error() {} },
    Set,
    cabangAktif: options.cabang || 'Kendari',
    globalProspek: prospects.map(item => ({
      'ID Prospek': item.id_prospek,
      'Status Prospek': item.status_prospek
    })),
    endpointFilterSupabase_: (_table, _column, id) => `prospek?id_prospek=eq.${id}`,
    callSupabase: async (endpoint, method, payload) => {
      if (options.callSupabase) return options.callSupabase(endpoint, method, payload);
      queries.push(endpoint);
      if (!method || method === 'GET') return prospects;
      if (options.patchError) throw new Error('Pembaruan gagal');
      patches.push({ endpoint, method, payload });
      if (options.race) return [];
      const id = new URL('https://test.invalid/' + endpoint).searchParams.get('id_prospek').slice(3);
      const prospect = prospects.find(item => item.id_prospek === id);
      Object.assign(prospect, payload);
      return [{ ...prospect }];
    }
  });

  const names = [
    'statusProspekKanonis_',
    'normalisasiNamaCustomerProspek_',
    'normalisasiWASementara_',
    'normalisasiCabang',
    'pastikanHasilMutasiSupabase_',
    'statusProspekAktifUntukSinkron_',
    'sinkronkanStatusProspekOtomatis_',
    'sinkronkanStatusProspekDariTiket_',
    'sinkronkanStatusProspekDariPenjualan_'
  ];
  new vm.Script(names.map(name => extractFunction(frontendSource, name)).join('\n')).runInContext(context);
  context.kirimNotifWAInternal = async (sales, message) => {
    notifications.push({ sales, message });
    return options.notificationResult || { terkirim: 1, gagal: 0 };
  };
  return { context, patches, notifications, queries };
}

test('penjualan langsung menutup prospek aktif dan memberi tahu setiap sales penanggung jawab', async () => {
  const prospects = [
    { id_prospek: 'PRP-001', nama_calon_customer: '  Budi   Santoso ', no_wa: '0812-3456-7890', status_prospek: 'Tahap Penawaran', sales_penanggung_jawab: 'Sales A' },
    { id_prospek: 'PRP-002', nama_calon_customer: 'Budi Santoso', no_wa: '6281234567890', status_prospek: 'Kunjungan Toko', sales_penanggung_jawab: 'Sales B' },
    { id_prospek: 'PRP-003', nama_calon_customer: 'Budi Santoso', no_wa: '6281234567890', status_prospek: 'Closing / Deal', sales_penanggung_jawab: 'Sales C' }
  ];
  const { context, patches, notifications } = frontendHarness(prospects);

  const result = await context.sinkronkanStatusProspekDariPenjualan_('6281234567890', 'budi santoso');

  assert.equal(result.ditemukan, 2);
  assert.equal(result.diperbarui, 2);
  assert.deepEqual(patches.map(item => new URL('https://test.invalid/' + item.endpoint).searchParams.get('id_prospek')), ['eq.PRP-001', 'eq.PRP-002']);
  assert.ok(patches.every(item => item.payload.status_prospek === 'Closing / Deal'));
  assert.deepEqual(notifications.map(item => item.sales), ['Sales A', 'Sales B']);
  assert.ok(notifications.every(item => /Closing \/ Deal/.test(item.message)));
  assert.equal(result.notifTerkirim, 2);
  assert.equal((await context.sinkronkanStatusProspekDariPenjualan_('6281234567890', 'budi santoso')).diperbarui, 0);
  assert.equal(notifications.length, 2);
});

test('nama yang sama dengan WA berbeda tidak mengubah prospek; WA sama dengan nama berbeda menutup prospek', async () => {
  const prospects = [
    { id_prospek: 'PRP-010', nama_calon_customer: 'Nama Sama', no_wa: '628111111111', status_prospek: 'Tahap Penawaran', sales_penanggung_jawab: 'Sales A' },
    { id_prospek: 'PRP-011', nama_calon_customer: 'Nama Berbeda', no_wa: '628222222222', status_prospek: 'Kunjungan Toko', sales_penanggung_jawab: 'Sales A' }
  ];
  const first = frontendHarness(prospects);
  const sameName = await first.context.sinkronkanStatusProspekDariPenjualan_('628999999999', 'Nama Sama');
  assert.equal(sameName.diperbarui, 0);
  assert.equal(first.patches.length, 0);

  const second = frontendHarness(prospects);
  const sameWa = await second.context.sinkronkanStatusProspekDariPenjualan_('628222222222', 'Nama Lain');
  assert.equal(sameWa.diperbarui, 1);
  assert.equal(second.patches.length, 1);
  assert.equal(second.notifications[0].sales, 'Sales A');
  assert.match(second.notifications[0].message, /Nama Berbeda/);
});

test('nomor kosong, pendek, atau tidak valid tidak mengubah prospek atau mengirim WA', async () => {
  for (const wa of ['', '0812', '12345678901234567']) {
    const h = frontendHarness([{ id_prospek: 'P-1', nama_calon_customer: 'Pembeli', no_wa: wa, status_prospek: 'Tahap Penawaran' }]);
    assert.equal((await h.context.sinkronkanStatusProspekDariPenjualan_(wa, 'Pembeli')).diperbarui, 0);
    assert.equal(h.patches.length, 0);
    assert.equal(h.notifications.length, 0);
  }
});

test('sinkronisasi penjualan dibatasi pada cabang dan sales transaksi, termasuk sales gabungan', async () => {
  const rows = ['Kendari', 'Raha'].flatMap(cabang => ['Sales A, Sales B', 'Sales C'].map((sales, index) => ({
    id_prospek: `${cabang}-${index}`, nama_calon_customer: 'Pembeli', no_wa: '081234567890',
    status_prospek: 'Tahap Penawaran', sales_penanggung_jawab: sales, cabang
  })));
  const h = frontendHarness(rows, { cabang: 'Raha' });
  const result = await h.context.sinkronkanStatusProspekDariPenjualan_('+62 812-3456-7890', 'Nama alias', { cabang: 'Raha', sales: 'sales b, Sales A' });
  assert.equal(result.diperbarui, 1);
  assert.match(h.patches[0].endpoint, /id_prospek=eq.Raha-0/);
  assert.match(h.queries[0], /cabang=eq.Raha/);
  assert.match(h.patches[0].endpoint, /status_prospek=eq.Tahap%20Penawaran/);
  assert.equal(h.notifications[0].sales, 'Sales A, Sales B');
});

for (const status of ['Tahap Penawaran', 'Kunjungan Toko', 'On Progress', 'Pending', 'Proses Servis', 'Closing / Deal', 'Batal', 'Tanpa Keterangan']) {
  test(`penjualan menutup status aktif dan mempertahankan status akhir: ${status}`, async () => {
    const active = ['Tahap Penawaran', 'Kunjungan Toko', 'On Progress', 'Pending', 'Proses Servis'].includes(status);
    const h = frontendHarness([{ id_prospek: 'P-1', no_wa: '081234567890', nama_calon_customer: 'Pembeli', status_prospek: status, sales_penanggung_jawab: 'Sales A' }]);
    assert.equal((await h.context.sinkronkanStatusProspekDariPenjualan_('6281234567890', 'Pembeli')).diperbarui, Number(active));
    assert.equal(h.notifications.length, Number(active));
  });
}

test('perubahan status bersamaan dan kegagalan PATCH tidak mengirim notifikasi', async () => {
  const prospect = { id_prospek: 'P-1', nama_calon_customer: 'Pembeli', no_wa: '081234567890', status_prospek: 'Tahap Penawaran' };
  const race = frontendHarness([{ ...prospect }], { race: true });
  assert.equal((await race.context.sinkronkanStatusProspekDariPenjualan_('081234567890', 'Pembeli')).diperbarui, 0);
  assert.equal(race.notifications.length, 0);
  const failed = frontendHarness([{ ...prospect }], { patchError: true });
  await assert.rejects(failed.context.sinkronkanStatusProspekDariPenjualan_('081234567890', 'Pembeli'), /Pembaruan gagal/);
  assert.equal(failed.notifications.length, 0);
});

test('kegagalan notifikasi dilaporkan tanpa membatalkan status Closing', async () => {
  const h = frontendHarness([{ id_prospek: 'P-1', nama_calon_customer: 'Pembeli', no_wa: '081234567890', status_prospek: 'Tahap Penawaran' }], { notificationResult: { terkirim: 0, gagal: 0 } });
  const result = await h.context.sinkronkanStatusProspekDariPenjualan_('081234567890', 'Pembeli');
  assert.equal(result.diperbarui, 1);
  assert.equal(result.notifGagal, 1);
  assert.equal(h.context.globalProspek[0]['Status Prospek'], 'Closing / Deal');
});

test('penjualan langsung memperbarui database PostgreSQL lokal dengan trigger Closing aplikasi', async () => {
  const { createSalesTestDatabase } = require('../maintenance/sales-workspace-test-fixture.cjs');
  const { db, actor, actors } = await createSalesTestDatabase();
  try {
    await db.exec("update prospek set no_wa='081234567890' where id_prospek='P-R'");
    const prospects = (await db.query('select * from prospek')).rows;
    const h = frontendHarness(prospects, {
      callSupabase: async (endpoint, method, payload) => {
        const params = new URL('https://db.test.invalid/' + endpoint).searchParams;
        const values = [];
        const filters = [];
        for (const [key, value] of params) {
          if (key === 'select') continue;
          if (key === 'or') { filters.push("(cabang='Kendari' or cabang is null)"); continue; }
          assert.ok(['id_prospek', 'cabang', 'status_prospek'].includes(key));
          assert.ok(value.startsWith('eq.'));
          values.push(value.slice(3));
          filters.push(`${key}=$${values.length}`);
        }
        const where = filters.length ? ' where ' + filters.join(' and ') : '';
        if (method !== 'PATCH') return (await db.query('select * from prospek' + where, values)).rows;
        values.push(payload.status_prospek);
        return (await db.query(`update prospek set status_prospek=$${values.length}${where} returning *`, values)).rows;
      }
    });
    await actor(actors.admin);
    const result = await h.context.sinkronkanStatusProspekDariPenjualan_('+62 812 3456 7890', 'Budi Alias', { cabang: 'Kendari', sales: 'Sales A' });
    assert.equal(result.diperbarui, 1);
    assert.equal((await db.query("select status_prospek from prospek where id_prospek='P-1'")).rows[0].status_prospek, 'Closing / Deal');
    assert.equal((await db.query("select status_prospek from prospek where id_prospek='P-R'")).rows[0].status_prospek, 'Tahap Penawaran');
    assert.equal(h.notifications.length, 1);
    assert.equal((await h.context.sinkronkanStatusProspekDariPenjualan_('081234567890', 'Budi Alias', { cabang: 'Kendari', sales: 'Sales A' })).diperbarui, 0);
    assert.equal(h.notifications.length, 1);
  } finally {
    await db.close();
  }
});

test('sinkronisasi tiket tanpa identitas tiket tidak menebak hubungan customer', async () => {
  const prospects = [
    { id_prospek: 'PRP-020', nama_calon_customer: 'Klien Aktif', no_wa: '628333333333', status_prospek: 'Tahap Penawaran', sales_penanggung_jawab: 'Sales A' },
    { id_prospek: 'PRP-021', nama_calon_customer: 'Klien Aktif', no_wa: '628333333333', status_prospek: 'On Progress', sales_penanggung_jawab: 'Sales A' },
    { id_prospek: 'PRP-022', nama_calon_customer: 'Klien Aktif', no_wa: '628333333333', status_prospek: 'Tanpa Keterangan', sales_penanggung_jawab: 'Sales A' }
  ];
  const { context, patches } = frontendHarness(prospects);
  context.cabangAktif='Kendari';
  context.normalisasiCabang=value=>value;

  const result = await context.sinkronkanStatusProspekDariTiket_('Selesai', '08333333333', 'Klien Aktif');

  assert.equal(result.diperbarui, 0);
  assert.equal(patches.length, 0);
});

test('pilihan Batal dan Tanpa Keterangan tidak lagi dibatasi untuk admin', () => {
  assert.match(frontendSource, /const statusAkhirOptions = `<option value="Batal"[\s\S]*?<option value="Tanpa Keterangan"/);
  assert.doesNotMatch(frontendSource, /if \(roleAdalahAdminOperasional_\(\)\) \{\s*adminOptions/);
  assert.match(frontendSource, /if \(rolePengguna\(\) === 'sales'\)[\s\S]*?Sales Penanggung Jawab/);
});

function backendHarness(source, rows) {
  const writes = [];
  const sheet = {
    getDataRange: () => ({ getValues: () => rows }),
    getRange: (row, column) => ({
      setValue: value => {
        writes.push({ row, column, value });
        rows[row - 1][column - 1] = value;
      }
    })
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => name === 'Prospek' ? sheet : null }) },
    normalisasiNoWA_: value => {
      let digit = String(value || '').replace(/\D/g, '');
      if (digit.startsWith('0')) digit = `62${digit.slice(1)}`;
      else if (digit.startsWith('8')) digit = `62${digit}`;
      return digit;
    }
  });
  new vm.Script(extractFunction(source, 'updateStatusProspekOtomatis_')).runInContext(context);
  return { context, writes };
}

for (const backendName of ['code.js', 'coderaha.js.txt']) {
  test(`${backendName}: pencocokan backend memerlukan nama, WA, dan status aktif`, { skip: !backendRoot }, () => {
    const source = fs.readFileSync(path.join(backendRoot, backendName), 'utf8');
    const rows = [
      ['ID Prospek', 'Nama Calon Customer', 'No WA', 'Status Prospek'],
      ['PRP-101', 'Siti Aminah', '081234567891', 'Tahap Penawaran'],
      ['PRP-102', 'Siti Aminah', '081234567891', 'Batal']
    ];
    const { context, writes } = backendHarness(source, rows);

    assert.equal(context.updateStatusProspekOtomatis_(' siti  aminah ', '6281234567891', 'Closing / Deal'), true);
    assert.deepEqual(writes, [{ row: 2, column: 4, value: 'Closing / Deal' }]);

    const mismatch = backendHarness(source, [
      ['ID Prospek', 'Nama Calon Customer', 'No WA', 'Status Prospek'],
      ['PRP-103', 'Siti Aminah', '081234567891', 'Kunjungan Toko']
    ]);
    assert.equal(mismatch.context.updateStatusProspekOtomatis_('Siti Aminah', '628999999999', 'Closing / Deal'), false);
    assert.equal(mismatch.writes.length, 0);
  });
}

test('seluruh JavaScript yang diubah tetap valid secara sintaks', () => {
  if (backendRoot) {
    for (const backendName of ['code.js', 'coderaha.js.txt']) {
      assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(backendRoot, backendName), 'utf8'), { filename: backendName }));
    }
  }
  const inlineScripts = [...frontendSource.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(inlineScripts.length > 0);
  inlineScripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: `index-inline-${index + 1}.js` }));
  });
});
