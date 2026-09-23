const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

function extract(source, name) {
  const match = source.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, `Missing function: ${name}`);
  return match[0];
}

function createHarness() {
  const context = vm.createContext({ String });
  for (const name of ['statusPoinSudahCair_', 'statusTiketUntukFilter_', 'tiketCocokFilterTambahan_']) {
    vm.runInContext(extract(html, name), context);
  }
  return context;
}

test('ticket page exposes status and invoice filters', () => {
  assert.match(html, /id="filter-status-tiket"[^>]*onchange="renderTickets\(\)"/);
  assert.match(html, /id="filter-pembayaran-tiket"[^>]*onchange="renderTickets\(\)"/);
  assert.match(html, /<option value="lunas">Nota Lunas<\/option>/);
  assert.match(html, /<option value="belum_lunas">Nota Belum Lunas<\/option>/);
  assert.match(html, /Tidak ada tiket yang cocok dengan status, nota, periode, atau pencarian terpilih/);
});

test('ticket status filter recognizes unassigned work without mutating its source', () => {
  const context = createHarness();
  const ticket = { Status: 'Menunggu', Teknisi: 'Belum Ditugaskan', 'Status Pembayaran': '' };
  assert.equal(context.statusTiketUntukFilter_(ticket), 'Menunggu Teknisi');
  assert.equal(context.tiketCocokFilterTambahan_(ticket, 'Menunggu Teknisi', 'all'), true);
  assert.equal(context.tiketCocokFilterTambahan_(ticket, 'Menunggu', 'all'), false);
  assert.equal(ticket.Status, 'Menunggu');
  assert.equal(ticket.Teknisi, 'Belum Ditugaskan');
});

test('invoice filter treats only the canonical Lunas status as paid', () => {
  const context = createHarness();
  const paid = { Status: 'Selesai', Teknisi: 'Syawal', 'Status Pembayaran': ' LUNAS ' };
  const unpaid = { Status: 'Selesai', Teknisi: 'Syawal', 'Status Pembayaran': 'Poin Beku' };

  assert.equal(context.tiketCocokFilterTambahan_(paid, 'Selesai', 'lunas'), true);
  assert.equal(context.tiketCocokFilterTambahan_(paid, 'all', 'belum_lunas'), false);
  assert.equal(context.tiketCocokFilterTambahan_(unpaid, 'Selesai', 'belum_lunas'), true);
  assert.equal(context.tiketCocokFilterTambahan_(unpaid, 'all', 'lunas'), false);
});
