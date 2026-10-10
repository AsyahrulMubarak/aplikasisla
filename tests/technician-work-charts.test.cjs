'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), { test } = require('node:test');
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const moduleSource = fs.readFileSync(__dirname + '/../maintenance/technician-work-charts.js', 'utf8') + '\n' + fs.readFileSync(__dirname + '/../maintenance/technician-replacement-rating.js', 'utf8');
function extract(name) {
    const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
    assert.ok(match, name); return match[0];
}
const user = (name, role = 'teknisi', branch = 'Kendari') => ({ Username: name, 'Nama Asli': name, Role: role, Hak_Akses_Cabang: branch, Cabang: branch, SessionToken: 'fixture' });
const ticket = (id, names, extra = {}) => ({ 'ID Tiket': id, Teknisi: names, Status: 'Selesai', Cabang: 'Kendari', 'Waktu Selesai': '2026-10-10T12:00:00+08:00', 'Waktu Lapor': '2026-09-30T09:00:00+08:00', 'Status Pembayaran': 'Belum', 'Status SLA': 'TERLAMBAT', ...extra });
function harness(profile = user('Muaz')) {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: '', style: {}, value: '', selectedOptions: [], textContent: '', classList: { toggle() {} }, setAttribute() {} });
        return nodes.get(id);
    };
    const c = vm.createContext({ console, cabangAktif: 'Kendari', penggunaAktif: profile, API_URL_CABANG: { Kendari: 'test', Raha: 'test' }, document: { getElementById: node }, globalUsers: [], globalTickets: [], globalGaransi: [], globalPenjualan: [], globalProspek: [], hitungDurasiJamKerjaMs: () => 0, formatRp: value => 'Rp ' + value, tetapkanHtmlAman_: (element, content) => { element.innerHTML = content; } });
    const names = ['normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'roleAdalahAdminOperasional_', 'roleAdalahManajemen_', 'penggunaSalesLintasCabang_', 'penggunaBolehMengaksesCabang', 'dataSesuaiCabangAktif_', 'parseSafeDate', 'daftarTeknisiUnikTiket_', 'amanTeks_', 'poinHangusKarenaSLA_', 'statusPoinSudahCair_', 'normalisasiNoTransaksiNota_', 'tanggalNotaDariNomorTransaksi_', 'rekapStatusNotaIpos_', 'renderDashboard', 'buatHtmlKartuTeknisi_', 'buatHtmlKartuSales_', 'buatHtmlPerformaAdmin_', 'aturTataLetakLobby_', 'tampilkanRingkasanLobby_', 'ambilProfilTeknisiRingkasanLobby_'];
    vm.runInContext(moduleSource + '\n' + names.map(extract).join('\n'), c);
    node('filter-bulan-dash').value = '10'; node('filter-tahun-dash').value = '2026'; node('lobby-periode').value = '2026-10';
    return { c, node };
}
function fixture(c) {
    c.globalUsers = ['Muaz', 'Wawan', 'Rendi', 'Zero'].map(name => user(name)).concat(user('Director', 'direktur'), user('Other', 'teknisi', 'Raha'));
    c.globalTickets = [ticket('1', 'Muaz'), ticket('2', 'Muaz, Wawan'), ticket('3', 'Muaz, muaz'), ticket('4', 'Syawal, Muhammad Syawal'), ticket('5', 'Belum Ditugaskan'), ticket('6', 'Wawan', { 'Waktu Selesai': '2026-09-30T16:30:00Z' }), ticket('7', 'Muaz, Wawan, Rendi'), ticket('2', 'Muaz, Wawan'), ticket('1', 'Other', { Cabang: 'Raha' }), ticket('previous', 'Muaz', { 'Waktu Selesai': '2026-09-30T15:59:59Z' }), ticket('next', 'Muaz', { 'Waktu Selesai': '2026-10-31T16:00:00Z' }), ticket('cancel', 'Muaz', { Status: 'Cancel' }), ticket('pending', 'Muaz', { Status: 'Pending' }), ticket('invalid', 'Muaz', { 'Waktu Selesai': 'invalid' }), ticket('missing', 'Muaz', { 'Waktu Selesai': '' }), ticket('SLS-1', 'Muaz'), null];
}
test('completed work counts use WITA completion month and branch, ignore payments and SLA, and deduplicate shared members and ticket IDs', () => {
    const { c } = harness(); fixture(c);
    const result = c.rekapPekerjaanTeknisi_(c.globalTickets, c.globalUsers, '10', '2026');
    assert.equal(result.totalSelesai, 7); assert.equal(result.totalKeterlibatan, 9);
    assert.equal(result.labelPeriode, 'Oktober 2026');
    assert.deepEqual(JSON.parse(JSON.stringify(result.teknisi)), [
        { nama: 'Muaz', solo: 2, tim: 2, total: 4 }, { nama: 'Wawan', solo: 1, tim: 2, total: 3 }, { nama: 'Muhammad Syawal', solo: 1, tim: 0, total: 1 }, { nama: 'Rendi', solo: 0, tim: 1, total: 1 }, { nama: 'Zero', solo: 0, tim: 0, total: 0 }
    ]);
});
test('both personal charts use all completed branch tickets as their denominator and cannot expose another technician card', () => {
    const { c, node } = harness(); fixture(c);
    const rekap = c.renderDashboard({ hitungSaja: true, bulan: '10', tahun: '2026' });
    c.tampilkanRingkasanLobby_(rekap, c.penggunaAktif, c.globalTickets.filter(Boolean), 'Kendari');
    const content = node('lobby-dashboard-content').innerHTML;
    assert.equal((content.match(/2 dari 7 tiket selesai/g) || []).length, 4);
    assert.match(content, /28,6%/); assert.match(content, /PEKERJAAN SOLO/); assert.match(content, /PEKERJAAN TIM/);
    assert.ok(!content.includes('Wawan') && !content.includes('Jumlah Tiket Selesai per Teknisi'));
});
test('Raha and empty periods show independent totals and retain zero-completion technicians without NaN', () => {
    const { c } = harness(); fixture(c); c.cabangAktif = 'Raha';
    const raha = c.rekapPekerjaanTeknisi_(c.globalTickets, c.globalUsers, '10', '2026');
    assert.equal(raha.totalSelesai, 1); assert.equal(raha.teknisi[0].nama, 'Other');
    c.cabangAktif = 'Kendari';
    const empty = c.rekapPekerjaanTeknisi_([], c.globalUsers, '10', '2026');
    assert.equal(empty.teknisi.length, 4);
    const content = c.buatHtmlDiagramPekerjaanTeknisi_('Muaz', empty) + c.buatHtmlDiagramPerbandinganTeknisi_(empty);
    assert.match(content, /Belum ada tiket selesai/); assert.ok(!/NaN|Infinity|undefined/.test(content));
});
test('team dashboard and management lobbies rank descending, retain zero values, and show each solo/team breakdown', () => {
    for (const role of ['manager', 'direktur']) {
        const { c, node } = harness(user('Leader', role)); fixture(c);
        c.renderDashboard(); const dashboard = node('dash-tek-content').innerHTML;
        assert.match(dashboard, /Jumlah Tiket Selesai per Teknisi/); assert.equal((dashboard.match(/data-work-kind="solo"/g) || []).length, 5);
        const rekap = c.renderDashboard({ hitungSaja: true, bulan: '10', tahun: '2026' });
        c.tampilkanRingkasanLobby_(rekap, c.penggunaAktif, c.globalTickets.filter(Boolean), 'Kendari');
        const content = node('lobby-dashboard-content').innerHTML;
        assert.ok(content.indexOf('Muaz') < content.indexOf('Wawan') && content.indexOf('Wawan') < content.indexOf('Zero'));
        assert.match(content, /Solo 2 · Tim 2/); assert.match(content, /4 tiket/); assert.match(content, /7 tiket selesai pada cabang ini/);
    }
});
test('management roster pagination fetches branch technician names without financial, phone or Auth fields', async () => {
    const { c } = harness(), requests = [];
    c.callSupabase = async endpoint => { requests.push(endpoint); return requests.length === 1 ? Array.from({ length: 500 }, (_, i) => ({ username: 'u' + i, nama_asli: 'Tech ' + i, role: 'teknisi', cabang: 'Raha' })) : []; };
    const profiles = await c.ambilProfilTeknisiRingkasanLobby_('Raha');
    assert.equal(profiles.length, 500); assert.equal(requests.length, 2);
    assert.match(requests[1], /cabang=eq.Raha.*offset=500/); assert.match(requests[0], /role=eq.teknisi/);
    assert.ok(!requests.some(value => /gaji|no_wa|auth_id|password/.test(value)));
});
test('chart labels escape technician names before reaching the page', () => {
    const { c } = harness(); const bad = '<img src=x onerror=alert(1)>';
    const rekap = c.rekapPekerjaanTeknisi_([ticket('safe', bad)], [user(bad)], '10', '2026');
    const content = c.buatHtmlDiagramPerbandinganTeknisi_(rekap);
    assert.ok(content.includes('&lt;img')); assert.ok(!content.includes('<img'));
});
