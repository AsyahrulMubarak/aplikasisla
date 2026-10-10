'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const helpers = fs.readFileSync(__dirname + '/../maintenance/technician-replacement-rating.js', 'utf8').trimEnd();
const extract = name => {
    const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
    assert.ok(match, name); return match[0];
};
const user = name => ({ 'Nama Asli': name, Username: name, Role: 'teknisi', Cabang: 'Kendari', Hak_Akses_Cabang: 'Kendari' });
function harness() {
    const nodes = new Map(), node = id => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: '', style: {}, value: '', selectedOptions: [], textContent: '', classList: { toggle() {} }, setAttribute() {} });
        return nodes.get(id);
    };
    const c = vm.createContext({ console, cabangAktif: 'Kendari', penggunaAktif: user('Muaz'), API_URL_CABANG: { Kendari: 'fixture', Raha: 'fixture' }, globalUsers: ['Muaz', 'Wawan', 'Zero'].map(user), globalTickets: [], globalGaransi: [], globalProspek: [], globalPenjualan: [], document: { getElementById: node }, tetapkanHtmlAman_: (element, text) => { element.innerHTML = text; }, hitungDurasiJamKerjaMs: () => 0, formatRp: String });
    const names = ['normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'penggunaSalesLintasCabang_', 'roleAdalahAdminOperasional_', 'roleAdalahManajemen_', 'penggunaBolehMengaksesCabang', 'dataSesuaiCabangAktif_', 'daftarTeknisiUnikTiket_', 'parseSafeDate', 'amanTeks_', 'poinHangusKarenaSLA_', 'statusPoinSudahCair_', 'normalisasiNoTransaksiNota_', 'tanggalNotaDariNomorTransaksi_', 'rekapStatusNotaIpos_', 'renderDashboard', 'buatHtmlKartuTeknisi_', 'buatHtmlKartuSales_', 'buatHtmlPerformaAdmin_', 'aturTataLetakLobby_', 'tampilkanRingkasanLobby_'];
    vm.runInContext(helpers + '\n' + fs.readFileSync(__dirname + '/../maintenance/technician-work-charts.js', 'utf8') + '\n' + names.map(extract).join('\n'), c);
    node('filter-bulan-dash').value = '10'; node('filter-tahun-dash').value = '2026';
    return { c, node };
}
const ticket = (id, events, extra = {}) => ({ 'ID Tiket': id, Cabang: 'Kendari', Teknisi: 'Wawan', Status: 'Selesai', 'Waktu Lapor': '2026-09-01T08:00:00+08:00', 'Waktu Selesai': '2026-11-01T08:00:00+08:00', 'Riwayat Penggantian Teknisi': events, ...extra });
const event = (dari, ke, waktu = '2026-10-02T09:00:00+08:00') => ({ dari, ke, waktu, sumber: 'server' });
const plain = value => JSON.parse(JSON.stringify(value));
test('embedded replacement helpers remain identical to the credential-free module', () => {
    assert.equal(html.slice(html.indexOf('        function namaTeknisiPenggantian_('), html.indexOf('        function kunciNamaPekerjaanTeknisi_(')).trimEnd(), helpers);
});
test('counts repeated removals per technician and unique tickets by replacement month in WITA, including unfinished work', () => {
    const { c } = harness();
    const a = ticket('A', [event('Muaz, Wawan', 'Wawan, Rendi'), event('Rendi', 'Muaz'), event('Muaz', 'Wawan')]);
    const data = [a, a, ticket('B', [event('Muaz', 'Wawan', '2026-09-30T16:00:00Z')], { Status: 'Pending' }), ticket('C', [event('Muaz', 'Wawan', '2026-09-30T15:59:59Z')]), ticket('D', [event('Muaz', 'Wawan', '2026-10-31T16:00:00Z')]), ticket('SLS-1', [event('Muaz', 'Wawan')]), ticket('A', [event('Muaz', 'Wawan')], { Cabang: 'Raha' }), null];
    assert.deepEqual(plain(c.rekapPenggantianTeknisi_(data, '10', '2026')), [
        { nama: 'Muaz', jumlah: 3, tiket: 2, tanpaTanggal: 0 }, { nama: 'Rendi', jumlah: 1, tiket: 1, tanpaTanggal: 0 }
    ]);
});
test('team additions, reordering, duplicate names and Syawal aliases do not penalize retained members', () => {
    const { c } = harness();
    assert.deepEqual(plain(c.rekapPenggantianTeknisi_([ticket('A', [event('Muaz, muaz, Syawal', 'Muhammad Syawal, MUAZ, Wawan'), event('Syawal, Muaz', 'MUAZ')])], '10', '2026')), [{ nama: 'Muhammad Syawal', jumlah: 1, tiket: 1, tanpaTanggal: 0 }]);
});
test('legacy localized and ISO audit dates are recovered, without assigning an invented date to missing metadata', () => {
    const { c } = harness();
    const notes = '[1/10/2026, 10.17.06] 🔄 PERGANTIAN TEKNISI\nDari: Muaz, Wawan\nKe: Wawan\n\n[2026-08-20 08:52:45] PERGANTIAN TEKNISI\r\nDari: Wawan\r\nKe: Rendi';
    assert.equal(c.riwayatPenggantianTeknisi_(ticket('A', null, { Keterangan: notes }))[0].waktu, '2026-10-01T02:17:06.000Z');
    assert.equal(c.tanggalCatatanPenggantian_('31/2/2026, 10.00.00'), null);
    assert.equal(c.tanggalCatatanPenggantian_('1/10/2026, 24.00.00'), null);
    assert.equal(c.tanggalCatatanPenggantian_('bad'), null);
    const data = [ticket('A', null, { Keterangan: notes }), ticket('B', null, { 'Teknisi Sebelumnya': 'Muaz' })];
    assert.deepEqual(plain(c.rekapPenggantianTeknisi_(data, '10', '2026')), [{ nama: 'Muaz', jumlah: 1, tiket: 1, tanpaTanggal: 1 }]);
    assert.deepEqual(plain(c.rekapPenggantianTeknisi_(data, 'all', '2026')), [{ nama: 'Muaz', jumlah: 2, tiket: 2, tanpaTanggal: 1 }, { nama: 'Wawan', jumlah: 1, tiket: 1, tanpaTanggal: 0 }]);
});
test('the server journal prevents duplicate counting from appended notes and handles malformed events safely', () => {
    const { c } = harness();
    const oldNote = '[1/10/2026, 10.17.06] PERGANTIAN TEKNISI\nDari: Muaz\nKe: Wawan';
    const data = [ticket('A', [null, event('Muaz', 'Wawan'), 'bad'], { Keterangan: oldNote }), ticket('B', [], { Keterangan: oldNote })];
    assert.deepEqual(plain(c.rekapPenggantianTeknisi_(data, '10', '2026')), [{ nama: 'Muaz', jumlah: 1, tiket: 1, tanpaTanggal: 0 }]);
});
test('dashboard and personal lobby render the same third tile, preserve points and show safe zero values', () => {
    const { c, node } = harness();
    c.globalTickets = [ticket('A', [event('Muaz', 'Wawan')])];
    const result = c.renderDashboard({ hitungSaja: true, bulan: '10', tahun: '2026' });
    assert.equal(result.statsTeknisi.Muaz.penggantian_count, 1);
    assert.equal(result.statsTeknisi.Muaz.poin_terkumpul, 0);
    c.renderDashboard();
    assert.match(node('dash-tek-content').innerHTML, /Penggantian Teknisi/);
    c.tampilkanRingkasanLobby_(result, c.penggunaAktif, c.globalTickets, 'Kendari');
    const content = node('lobby-dashboard-content').innerHTML;
    assert.match(content, /1 kali/); assert.match(content, /Diganti pada 1 tiket/);
    assert.match(content, /Tuntas Tanpa Pending/); assert.match(content, /Kebocoran Garansi/);
    const zero = c.buatHtmlKartuTeknisi_({ nama: 'Zero' });
    assert.match(zero, /0 kali/); assert.ok(!/NaN|Infinity|undefined/.test(zero));
});
