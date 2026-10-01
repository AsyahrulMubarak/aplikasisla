const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

function extract(name) {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

function harness(role, branch) {
  const container = { innerHTML: '' };
  const elements = {
    'ticket-container': container,
    'search-tiket': { value: '' },
    'filter-bulan-tiket': { value: 'all' },
    'filter-tahun-tiket': { value: 'all' },
    'filter-status-tiket': { value: 'all' },
    'filter-pembayaran-tiket': { value: 'all' },
    'ticket-period-help': { textContent: '' },
  };
  const context = vm.createContext({
    document: { getElementById: id => elements[id] },
    currentTicketFilter: 'aktif',
    penggunaAktif: { Role: role, 'Nama Asli': 'Teknisi A' },
    globalGaransi: [],
    globalTickets: ['Kendari', 'Raha'].flatMap(cabang => ['Teknisi A', 'Teknisi B'].map(teknisi => ({
      'ID Tiket': `TKT-KG-${cabang}-${teknisi.slice(-1)}`,
      Status: 'Claim Garansi', Teknisi: teknisi, Cabang: cabang,
      'Klien & Lokasi': 'Pelanggan Garansi', 'Jenis Pekerjaan': 'Perbaikan Garansi',
      'Waktu Lapor': new Date().toISOString(),
    }))),
    rolePengguna: () => role,
    roleAdalahAdminOperasional_: () => role === 'admin',
    dataSesuaiCabangAktif_: row => row.Cabang === branch,
    perbaruiStatusSLAAktualTiket_: () => {},
    formatWaktu: value => String(value || '-'),
    tambahkanHtmlAman_: (element, text) => { element.innerHTML += text; },
  });
  for (const name of ['parseSafeDate', 'statusPoinSudahCair_', 'normalisasiNoTransaksiNota_',
    'nomorTransaksiNotaGratis_', 'notaTiketSudahLunas_', 'statusTiketUntukFilter_',
    'tiketCocokFilterTambahan_', 'renderTickets']) vm.runInContext(extract(name), context);
  return { context, elements, container };
}

test('assigned warranty claims appear in active tickets for branch admins and assigned technicians', () => {
  for (const branch of ['Kendari', 'Raha']) for (const role of ['admin', 'teknisi']) {
    const { context, elements, container } = harness(role, branch);
    context.renderTickets();
    assert.ok(container.innerHTML.includes(`TKT-KG-${branch}-A`), `${role}/${branch}: own warranty missing`);
    assert.equal(container.innerHTML.includes(`TKT-KG-${branch}-B`), role === 'admin');
    assert.ok(container.innerHTML.includes('Claim Garansi'));
    elements['filter-status-tiket'].value = 'Claim Garansi';
    context.renderTickets();
    assert.ok(container.innerHTML.includes(`TKT-KG-${branch}-A`));
    elements['filter-status-tiket'].value = 'Menunggu';
    context.renderTickets();
    assert.ok(!container.innerHTML.includes(`TKT-KG-${branch}-A`));
    elements['filter-status-tiket'].value = 'all';
    context.currentTicketFilter = 'riwayat';
    context.renderTickets();
    assert.ok(!container.innerHTML.includes(`TKT-KG-${branch}-A`));
  }
});

test('ticket status dropdown includes the warranty claim status', () => {
  const dropdown = html.match(/<select id="filter-status-tiket"[^]*?<\/select>/)[0];
  assert.ok(dropdown.includes('<option value="Claim Garansi">Claim Garansi</option>'));
});
