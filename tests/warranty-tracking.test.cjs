const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..', process.env.WARRANTY_SOURCE_DIR || '.');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function extract(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}
const now = '2026-09-07T08:56:00+08:00';
let clock = now;
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return new Date(clock).getTime(); }
}
const original = Object.freeze({
  id_garansi: 'TEST-GARANSI', referensi_tiket_nota: 'TEST-TICKET',
  barang_jasa: 'Contoh barang', durasi_hari: 7, status: 'Aktif',
  tanggal_mulai: '2026-08-25T20:50:00+08:00',
  tanggal_habis: '2026-09-01T20:50:00+08:00'
});
function harness() {
  clock = now;
  const elements = {};
  const context = vm.createContext({
    Date: FixedDate, currentTrackTicket: 'TEST-TICKET', globalTickets: [], globalGaransi: [], globalUsers: [],
    document: { getElementById(id) { return elements[id] ||= { style: {} }; } },
    formatWaktu: value => value || '-',
    tetapkanHtmlAman_(element, value) { element.innerHTML = value; }
  });
  for (const name of ['statusGaransiEfektif_', 'terapkanHasilTrackingPublik_', 'tampilkanDataPelacakanKlien']) {
    vm.runInContext(extract(html, name), context);
  }
  const ticket = { id_tiket: 'TEST-TICKET', status: 'Selesai', jenis_pekerjaan: 'Contoh pekerjaan', teknisi: 'Contoh teknisi' };
  return { context, render(garansi) {
    const mapped = context.terapkanHasilTrackingPublik_({ tickets: [ticket], garansi });
    context.tampilkanDataPelacakanKlien(mapped);
    return elements['track-result-section'].innerHTML;
  }, elements };
}

test('all inline scripts retain valid JavaScript syntax', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(script => script.trim());
  assert.ok(scripts.length > 0);
  scripts.forEach(script => new vm.Script(script));
});

test('old backend response with expired active warranty shows expired and no claim button', () => {
  const { render } = harness();
  const output = render([original]);
  assert.match(output, /badge-habis/);
  assert.match(output, /Habis \(Expired\)/);
  assert.doesNotMatch(output, /Klaim via WhatsApp/);
  assert.equal(original.status, 'Aktif', 'Rendering must not alter the source record');
  assert.equal(original.tanggal_habis, '2026-09-01T20:50:00+08:00');
});

test('unexpired active warranty still shows its claim button', () => {
  const { render } = harness();
  const output = render([{ ...original, tanggal_habis: '2026-09-08T08:56:00+08:00' }]);
  assert.match(output, /badge-aktif/);
  assert.match(output, /Klaim via WhatsApp/);
  assert.doesNotMatch(output, /Habis \(Expired\)/);
});

test('waiting, claimed and no-warranty states keep their meaning', () => {
  for (const status of ['Masa Tunggu', 'Belum Diambil', 'Diklaim (Hangus)', 'Habis (Tanpa Garansi)', 'Habis (Expired)']) {
    const { context, render } = harness();
    const output = render([{ ...original, status }]);
    assert.equal(context.globalGaransi[0].Status, status);
    assert.doesNotMatch(output, /Klaim via WhatsApp/);
    assert.ok(output.includes(status));
  }
});

test('status calculation preserves the current expiry boundary and handles bad dates', () => {
  const { context } = harness();
  const status = context.statusGaransiEfektif_;
  for (const expiry of [null, '', 'Invalid Date', 'not-a-date']) assert.equal(status('Aktif', expiry, now), 'Aktif');
  assert.equal(status('Aktif', now, now), 'Aktif');
  assert.equal(status('Aktif', now, new Date(new Date(now).getTime() + 1)), 'Habis (Expired)');
  assert.equal(status('Aktif', '2026-09-07T00:55:59Z', now), 'Habis (Expired)');
  assert.equal(status('Aktif', '2026-09-07T00:56:01Z', now), 'Aktif');
  assert.equal(status('  Aktif  ', original.tanggal_habis, now), 'Habis (Expired)');
  assert.equal(status('', original.tanggal_habis, now), '');
});

test('displayed status changes when an already-loaded warranty expires', () => {
  const { context, render, elements } = harness();
  const expiry = '2026-09-07T08:56:01+08:00';
  assert.match(render([{ ...original, tanggal_habis: expiry }]), /Klaim via WhatsApp/);
  clock = '2026-09-07T08:56:02+08:00';
  context.tampilkanDataPelacakanKlien(context.globalTickets[0]);
  assert.match(elements['track-result-section'].innerHTML, /Habis \(Expired\)/);
  assert.doesNotMatch(elements['track-result-section'].innerHTML, /Klaim via WhatsApp/);
});

test('header-style response, mixed warranties and another ticket stay isolated', () => {
  const { render } = harness();
  const output = render([
    { 'ID Garansi': 'EXPIRED', 'Referensi (Tiket/Nota)': 'TEST-TICKET', 'Barang / Jasa': 'Expired item', 'Durasi (Hari)': 7, Status: 'Aktif', 'Tanggal Habis': original.tanggal_habis },
    { ...original, id_garansi: 'ACTIVE', tanggal_habis: '2026-10-01T00:00:00Z' },
    { ...original, referensi_tiket_nota: 'ANOTHER-TICKET', barang_jasa: 'Must not appear' }
  ]);
  assert.match(output, /Habis \(Expired\)/);
  assert.equal((output.match(/Klaim via WhatsApp/g) || []).length, 1);
  assert.doesNotMatch(output, /Must not appear/);
  assert.match(output, /Status Pekerjaan/);
  assert.match(output, /Selesai/);
});
