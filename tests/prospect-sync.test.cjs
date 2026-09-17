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

function frontendHarness(prospects) {
  const patches = [];
  const context = vm.createContext({
    console,
    Set,
    globalProspek: prospects.map(item => ({
      'ID Prospek': item.id_prospek,
      'Status Prospek': item.status_prospek
    })),
    endpointFilterSupabase_: (_table, _column, id) => `prospek/${id}`,
    pastikanHasilMutasiSupabase_: () => true,
    callSupabase: async (endpoint, method, payload) => {
      if (!method || method === 'GET') return prospects;
      patches.push({ endpoint, method, payload });
      return [{ id_prospek: endpoint.split('/').pop(), ...payload }];
    }
  });

  const names = [
    'normalisasiNamaCustomerProspek_',
    'normalisasiWASementara_',
    'statusProspekAktifUntukSinkron_',
    'sinkronkanStatusProspekOtomatis_',
    'sinkronkanStatusProspekDariTiket_',
    'sinkronkanStatusProspekDariPenjualan_'
  ];
  new vm.Script(names.map(name => extractFunction(frontendSource, name)).join('\n')).runInContext(context);
  context.kirimNotifWAInternal = async () => ({ terkirim: 1, gagal: 0 });
  return { context, patches };
}

test('penjualan langsung menutup prospek aktif hanya saat nama dan WA sama', async () => {
  const prospects = [
    { id_prospek: 'PRP-001', nama_calon_customer: '  Budi   Santoso ', no_wa: '0812-3456-7890', status_prospek: 'Tahap Penawaran', sales_penanggung_jawab: 'Sales A' },
    { id_prospek: 'PRP-002', nama_calon_customer: 'Budi Santoso', no_wa: '6281234567890', status_prospek: 'Kunjungan Toko', sales_penanggung_jawab: 'Sales B' },
    { id_prospek: 'PRP-003', nama_calon_customer: 'Budi Santoso', no_wa: '6281234567890', status_prospek: 'Closing / Deal', sales_penanggung_jawab: 'Sales C' }
  ];
  const { context, patches } = frontendHarness(prospects);

  const result = await context.sinkronkanStatusProspekDariPenjualan_('6281234567890', 'budi santoso');

  assert.equal(result.ditemukan, 2);
  assert.equal(result.diperbarui, 2);
  assert.deepEqual(patches.map(item => item.endpoint), ['prospek/PRP-001', 'prospek/PRP-002']);
  assert.ok(patches.every(item => item.payload.status_prospek === 'Closing / Deal'));
});

test('nama saja atau WA saja tidak pernah mengubah status prospek', async () => {
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
  assert.equal(sameWa.diperbarui, 0);
  assert.equal(second.patches.length, 0);
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
