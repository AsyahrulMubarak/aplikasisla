'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
process.env.TZ = 'Asia/Makassar';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name);
  return match[0];
}
const user = (role = 'teknisi', salary = 2000000, branch = 'Raha') => ({
  Role: role, 'Nama Asli': 'Wawan', Username: 'wawan', SessionToken: 'test-token',
  Hak_Akses_Cabang: branch, 'Gaji Pokok': salary
});
const functions = [
  'normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'roleAdalahAdminOperasional_',
  'roleAdalahManajemen_', 'penggunaSalesLintasCabang_', 'penggunaBolehMengaksesCabang',
  'penggunaBergajiDiizinkanModul_', 'penggunaBolehMengaksesAbsensi_', 'penggunaBolehMengaksesSlipGaji_',
  'penggunaBolehMengaksesKpi_', 'penggunaAdminKendariKlaim_', 'cabangKlaimSalesDiizinkan_', 'penggunaBolehKelolaKlaimSales_', 'penggunaBolehTabSLA_',
  'penggunaBolehMenuLobby_', 'dataSesuaiCabangAktif_', 'parseSafeDate', 'daftarTeknisiUnikTiket_',
  'pembagianPoinTeknisi_', 'poinHangusKarenaSLA_', 'statusPoinSudahCair_', 'normalisasiNoTransaksiNota_',
  'tanggalNotaDariNomorTransaksi_', 'rekapStatusNotaIpos_', 'renderDashboard',
  'petakanTiketSupabase_', 'petakanGaransiSupabase_', 'petakanPenjualanSupabase_', 'petakanProspekSupabase_',
  'kolomGaransiPengguna_', 'hentikanRingkasanLobby_', 'aturTataLetakLobby_', 'muatRingkasanLobby_', 'amanTeks_', 'buatHtmlPerformaAdmin_',
  'ambilProfilTeknisiRingkasanLobby_', 'kunciNamaPekerjaanTeknisi_', 'rekapPekerjaanTeknisi_', 'namaTeknisiPenggantian_', 'tanggalCatatanPenggantian_', 'riwayatPenggantianTeknisi_', 'rekapPenggantianTeknisi_', 'buatHtmlDiagramPekerjaanTeknisi_', 'buatHtmlDiagramPerbandinganTeknisi_',
  'buatHtmlKartuTeknisi_', 'buatHtmlKartuSales_'
];
function harness(activeUser = user()) {
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, innerHTML: '', textContent: '', value: '', selectedOptions: [], classList: { toggle() {} }, setAttribute() {} });
    return elements.get(id);
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-01T12:00:00+08:00'])); }
  }
  const c = vm.createContext({ Date: FixedDate, AbortController, console, muatStatusPegawaiLobby_: async () => {},
    API_URL_CABANG: { Kendari: 'test', Raha: 'test' }, penggunaAktif: activeUser, cabangAktif: 'Raha',
    globalUsers: [activeUser], globalTickets: [], globalGaransi: [], globalPenjualan: [], globalProspek: [],
    document: { getElementById: node }, hitungDurasiJamKerjaMs: () => 0,
    punyaAksesLobby: () => true, tampilkanRingkasanLobby_: () => {}
  });
  vm.runInContext('let permintaanRingkasanLobby_ = null, urutanRingkasanLobby_ = 0, waktuRingkasanLobby_ = 0;\n' + functions.map(extract).join('\n'), c);
  node('lobby-cabang').value = 'Raha';
  node('lobby-periode').value = '2026-09';
  return { c, node };
}
const ticket = (id, points, options = {}) => ({
  'ID Tiket': id, Teknisi: 'Wawan', Status: 'Selesai', Cabang: 'Raha', 'Status Pembayaran': 'Lunas',
  'Bobot Poin': points, 'Waktu Lapor': '2026-09-28T08:00:00+08:00',
  'Waktu Selesai': '2026-09-28T16:00:00+08:00', 'Tanggal Lunas': '2026-09-29T10:00:00+08:00',
  'Status SLA': 'TERPENUHI', 'Status SLA Respon': 'TERPENUHI', ...options
});
test('Visible menu permissions enforce salary, branch and each role without widening KPI access', () => {
  const { c } = harness();
  const technician = user('teknisi', 0);
  for (const menu of ['dashboard', 'tiket', 'user', 'sla-raha']) assert.equal(c.penggunaBolehMenuLobby_(menu, technician), true, menu);
  for (const menu of ['input', 'penjualan', 'prospek', 'garansi', 'klien', 'absen', 'gaji', 'kpi', 'klaim-sales', 'sla-kendari']) {
    assert.equal(c.penggunaBolehMenuLobby_(menu, technician), false, menu);
  }
  assert.equal(c.penggunaBolehMenuLobby_('absen', user()), true);
  assert.equal(c.penggunaBolehMenuLobby_('gaji', user('direktur', 0, 'Semua')), true);
  assert.equal(c.penggunaBolehMenuLobby_('input', user('direktur', 0, 'Semua')), false);
  assert.equal(c.penggunaBolehMenuLobby_('prospek', user('admin_raha')), false);
  assert.equal(c.penggunaBolehMenuLobby_('kpi', user('admin_raha')), true);
  assert.equal(c.penggunaBolehMenuLobby_('kpi', user('sales', 2000000, 'Kendari')), false);
  assert.equal(c.penggunaBolehMenuLobby_('kpi', { ...user('sales', 2000000, 'Kendari'), Username: 'juna' }), true);
  const alif = { ...user('teknisi', 2000000, 'Kendari'), Username: 'Alif', Username_Login: 'alif' };
  assert.equal(c.penggunaBolehMenuLobby_('kpi', alif), true);
  assert.equal(c.penggunaBolehMenuLobby_('sla-raha', alif), false);
  assert.equal(c.penggunaBolehMenuLobby_('input', alif), false);
  assert.equal(c.penggunaBolehMenuLobby_('tiket', { ...technician, SessionToken: '' }), false);
  assert.equal(c.penggunaBolehMenuLobby_('unknown', user()), false);
  assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user('admin', 0, 'Kendari')), true);
  assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user('admin', 0, 'Semua')), true);
  for (const role of ['manager', 'direktur']) assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user(role, 2000000, 'Semua')), true, role);
  for (const role of ['admin_raha', 'teknisi', 'sales']) {
    assert.equal(c.penggunaBolehMenuLobby_('klaim-sales', user(role, 2000000, 'Semua')), false, role);
  }
});
test('Lobby lists KPI, attendance, payroll, both SLA branches and Sales claims for every account', () => {
  const menuStart = html.indexOf('id="lobby-menu-title"');
  const menu = html.slice(menuStart, html.indexOf('</section>', menuStart));
  assert.deepEqual([...menu.matchAll(/data-lobby-menu="([^"]+)"/g)].map(m => m[1]),
    ['kpi', 'absen', 'gaji', 'sla-kendari', 'sla-raha', 'klaim-sales']);
  assert.ok(!/style="display:none/.test(menu));
});
function enableRendering(c) {
  c.formatRp = value => 'Rp ' + Number(value).toLocaleString('id-ID');
  c.tetapkanHtmlAman_ = (element, value) => { element.innerHTML = value; };
  vm.runInContext(extract('tampilkanRingkasanLobby_'), c);
}
test('Admin Kendari lobby renders live invoice totals and all three SLA panels', () => {
  const profile = { ...user('admin', 2000000, 'Kendari'), 'Nama Asli': 'Admin Kendari A' };
  const { c, node } = harness(profile);
  c.cabangAktif = 'Kendari';
  c.globalTickets = [
    ticket('paid', 0, { Cabang: 'Kendari', 'No Transaksi': '001/KSR/UTM/0926', 'Status SLA': 'TERLAMBAT' }),
    ticket('old-unpaid', 0, { Cabang: 'Kendari', 'No Transaksi': '002/KSR/UTM/0826', 'Status Pembayaran': 'Belum Lunas',
      'Waktu Selesai': '2026-08-31T16:00:00+08:00', 'Waktu Lapor': '2026-08-31T08:00:00+08:00', 'Tanggal Lunas': null })
  ];
  const rekap = c.renderDashboard({ hitungSaja: true, bulan: '09', tahun: '2026' });
  enableRendering(c);
  c.tampilkanRingkasanLobby_(rekap, profile, c.globalTickets, 'Kendari');
  const content = node('lobby-dashboard-content').innerHTML;
  for (const heading of ['Rekap Pelunasan Nota iPOS', 'SLA 1: Distribusi Tugas Teknisi', 'SLA 2: Pembuatan Nota & Garansi', 'SLA 3: Serah Terima Barang']) assert.ok(content.includes(heading), heading);
  assert.match(content, />1<\/div>\s*<div[^>]*>Total Nota — September 2026/);
  assert.match(content, />1<\/div>\s*<div[^>]*>Nota Dilunasi — September 2026/);
  assert.match(content, />1<\/div>\s*<div[^>]*>Nota Belum Lunas — Seluruh Riwayat/);
  assert.equal(node('lobby-point-preview').textContent, 'Poin Admin Kendari · 1');
  assert.ok(!content.includes('Papan Performa Teknisi'));
});
test('Sales and technicians render only their complete personal card and safely escape names', () => {
  for (const role of ['sales', 'teknisi']) {
    const profile = { ...user(role), 'Nama Asli': 'A <img src=x onerror=alert(1)>' };
    const { c, node } = harness(profile);
    enableRendering(c);
    const rekap = {
      statsSales: { mine: { nama: profile['Nama Asli'], target: 5000000, revenue: 1000000, total: 2, selesai: 1, progress: 1, potensi_omzet: 2000000, prospek_deal: 1 }, other: { nama: 'Other Sales' } },
      statsTeknisi: { mine: { nama: profile['Nama Asli'], poin_terkumpul: 6, resp_tepat: 1, resp_total: 1, peng_tepat: 1, peng_total: 1, tiket_selesai: 1 }, other: { nama: 'Other Technician' } }
    };
    c.tampilkanRingkasanLobby_(rekap, profile, [], 'Raha');
    const content = node('lobby-dashboard-content').innerHTML;
    assert.ok(content.includes('A &lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!content.includes('<img'));
    assert.ok(!content.includes('Other Sales') && !content.includes('Other Technician'));
    const headings = role === 'sales' ? ['PENCAPAIAN TARGET', 'STATUS TRANSAKSI', 'Potensi Pipeline', 'Tingkat Konversi'] : ['TOTAL POIN KINERJA BULAN INI', 'SLA RESPON', 'SLA PENGERJAAN', 'Tuntas Tanpa Pending', 'Kebocoran Garansi'];
    for (const heading of headings) assert.ok(content.includes(heading), heading);
    assert.equal(node('lobby-point-preview').textContent, role === 'sales' ? 'Omzet pribadi · Rp 1.000.000' : 'Poin pribadi · 6');
  }
});
test('Sales target remains personal when opening an authorized branch other than the profile branch', async () => {
  const sales = { ...user('sales'), 'Nama Asli': 'Sales A' };
  const { c, node } = harness(sales);
  node('lobby-cabang').value = 'Kendari';
  c.callSupabase = async () => [{ target_sales_rp: 50000000 }];
  c.ambilTabelRingkasanLobby_ = async () => [];
  let shown;
  c.tampilkanRingkasanLobby_ = rekap => { shown = rekap; };
  assert.equal(await c.muatRingkasanLobby_(), true);
  assert.equal(shown.statsSales['Sales A'].target, 50000000);
  assert.equal(c.globalUsers[0], sales);
});
test('Personal points share team work and exclude unpaid, other branches, failed SLA and next-month payment', () => {
  const { c, node } = harness();
  c.globalTickets = [
    ticket('shared', 12, { Teknisi: 'Wawan, Rendi, Wawan' }),
    ticket('unpaid', 50, { 'Status Pembayaran': 'Belum Lunas' }),
    ticket('frozen', 50, { 'Status Pembayaran': 'Poin Beku' }),
    ticket('other-branch', 100, { Cabang: 'Kendari' }),
    ticket('late', 100, { 'Status SLA': 'TERLAMBAT' }),
    ticket('veto', 3, { 'Status SLA': 'TERLAMBAT', 'Veto Admin': 'Ya' }),
    ticket('next-month', 100, { 'Tanggal Lunas': '2026-10-01T09:00:00+08:00' })
  ];
  node('dash-tek-content').innerHTML = 'existing dashboard';
  const stats = c.renderDashboard({ hitungSaja: true, bulan: '09', tahun: '2026' });
  assert.equal(stats.statsTeknisi.Wawan.poin_terkumpul, 9);
  assert.equal(stats.statsTeknisi.Rendi.poin_terkumpul, 6);
  assert.equal(stats.statsTeknisi.Wawan.tiket_selesai, 6);
  assert.equal(node('dash-tek-content').innerHTML, 'existing dashboard');
});
test('Sales uses personal target, actual revenue and open prospects for the selected period', () => {
  const sales = { ...user('sales'), 'Nama Asli': 'Sales A', 'Target Sales (Rp)': 5000000 };
  const { c } = harness(sales);
  c.globalPenjualan = [
    { 'ID Penjualan': 'SLS-1', Cabang: 'Raha', Sales: 'Sales A, Sales B', 'Nominal (Rp)': 2000000, Tanggal: '2026-09-28' },
    { 'ID Penjualan': 'SLS-2', Cabang: 'Raha', Sales: 'Sales B', 'Nominal (Rp)': 7000000, Tanggal: '2026-09-28' },
    { 'ID Penjualan': 'SLS-3', Cabang: 'Raha', Sales: 'Sales A', 'Nominal (Rp)': 9000000, Tanggal: '2026-10-01' }
  ];
  c.globalProspek = ['Penawaran', 'Deal', 'Batal'].map((status, i) => ({
    Cabang: 'Raha', 'Sales Penanggung Jawab': 'Sales A', 'Status Prospek': status,
    'Potensi Nilai': (i + 1) * 1000000, 'Tanggal Input': '2026-09-28'
  }));
  const stats = c.renderDashboard({ hitungSaja: true, bulan: '09', tahun: '2026' }).statsSales['Sales A'];
  assert.equal(stats.target, 5000000);
  assert.equal(stats.revenue, 1000000);
  assert.equal(stats.potensi_omzet, 1000000);
  assert.equal(stats.prospek_deal, 1);
  assert.equal(stats.prospek_batal, 1);
});
test('Loading the lobby restores existing workspace and cancels stale results on navigation', async () => {
  const { c, node } = harness();
  const existing = [ticket('existing', 7)];
  c.globalTickets = existing;
  c.cabangAktif = null;
  const requests = [];
  c.ambilTabelRingkasanLobby_ = async table => { requests.push(table); return []; };
  assert.equal(await c.muatRingkasanLobby_(), true);
  assert.equal(c.cabangAktif, null);
  assert.equal(c.globalTickets, existing);
  assert.deepEqual(requests, ['tiket', 'garansi']);
  assert.match(node('lobby-dashboard-status').textContent, /Diperbarui/);
  let resolve;
  let renders = 0;
  c.ambilTabelRingkasanLobby_ = table => table === 'tiket' ? new Promise(done => { resolve = done; }) : Promise.resolve([]);
  c.tampilkanRingkasanLobby_ = () => { renders++; };
  const pending = c.muatRingkasanLobby_();
  c.hentikanRingkasanLobby_();
  resolve([]);
  assert.equal(await pending, false);
  assert.equal(renders, 0);
  assert.equal(c.globalTickets, existing);
});
test('Failed or unauthorized summary loading never renders a false zero result', async () => {
  const { c, node } = harness();
  let renders = 0;
  c.tampilkanRingkasanLobby_ = () => { renders++; };
  c.ambilTabelRingkasanLobby_ = async () => { throw new Error('Koneksi gagal'); };
  assert.equal(await c.muatRingkasanLobby_(), false);
  assert.equal(renders, 0);
  assert.match(node('lobby-dashboard-content').innerHTML, /Ringkasan belum dapat dimuat/);
  assert.equal(node('lobby-dashboard-status').textContent, 'Koneksi gagal');
  node('lobby-cabang').value = 'Kendari';
  c.ambilTabelRingkasanLobby_ = async () => { throw new Error('Should not fetch unauthorized branch'); };
  assert.equal(await c.muatRingkasanLobby_(), false);
  assert.match(node('lobby-dashboard-status').textContent, /Cabang atau periode.*tidak valid/);
});

test('Manager lobby loads zero-completion technicians and restores the previous workspace', async () => {
  const manager = user('manager', 2000000, 'Semua');
  const { c } = harness(manager);
  const previousUsers = c.globalUsers;
  c.ambilTabelRingkasanLobby_ = async () => [];
  c.callSupabase = async endpoint => {
    assert.match(endpoint, /users\?select=username,nama_asli,role,cabang,hak_akses_cabang/);
    assert.match(endpoint, /role=eq.teknisi&cabang=eq.Raha/);
    return [{ username: 'zero', nama_asli: 'Zero Work', role: 'teknisi', cabang: 'Raha' }];
  };
  let shown;
  c.tampilkanRingkasanLobby_ = rekap => { shown = rekap; };
  assert.equal(await c.muatRingkasanLobby_(), true);
  assert.equal(shown.rekapPekerjaanTeknisi.teknisi[0].nama, 'Zero Work');
  assert.equal(shown.rekapPekerjaanTeknisi.teknisi[0].total, 0);
  assert.equal(c.globalUsers, previousUsers);
});

test('summary downloads omit binary evidence, preserve history pagination and retry a transient GET just once', async () => {
  const { c } = harness(user('admin', 2000000, 'Semua'));
  vm.runInContext(extract('ambilTabelRingkasanLobby_'), c);
  const calls = []; let fail = true;
  c.callSupabase = async endpoint => {
    const url = new URL('https://fixture/' + endpoint); calls.push(url);
    if (url.pathname.endsWith('/tiket') && fail) { fail = false; throw Object.assign(Error('timeout'), { code: 'SUPABASE_TIMEOUT' }); }
    if (url.pathname.endsWith('/tiket')) return url.searchParams.get('offset') === '0' ? Array.from({length:500}, (_, n) => ({id_tiket:n})) : [{id_tiket:500}];
    return [];
  };
  assert.equal((await c.ambilTabelRingkasanLobby_('tiket', 'Kendari')).length, 501);
  assert.deepEqual(calls.map(u => u.searchParams.get('offset')), ['0','0','500']);
  for (const source of ['garansi','penjualan','prospek']) await c.ambilTabelRingkasanLobby_(source, 'Raha');
  for (const url of calls) {
    const columns = url.searchParams.get('select').split(',');
    assert.ok(!columns.includes('*'));
    for (const blob of ['tanda_tangan','bukti_banding','bukti_chat','surat_penawaran']) assert.ok(!columns.includes(blob));
    assert.ok(!url.searchParams.has('tanggal_lunas'), 'unpaid invoices from older months must remain available');
  }
  const ticketColumns = calls[0].searchParams.get('select').split(',');
  for (const field of ['tanggal_lunas','status_pembayaran','penilaian_teknisi','riwayat_penggantian_teknisi']) assert.ok(ticketColumns.includes(field));
  let attempts = 0;c.callSupabase = async () => { attempts++; throw Object.assign(Error('denied'), {status:403}); };
  await assert.rejects(c.ambilTabelRingkasanLobby_('tiket','Raha'), /denied/);assert.equal(attempts,1);
  attempts=0;const controller=new AbortController();c.callSupabase=async()=>{attempts++;controller.abort();throw Object.assign(Error('timeout'),{code:'SUPABASE_TIMEOUT'});};
  await assert.rejects(c.ambilTabelRingkasanLobby_('tiket','Raha',controller.signal),/timeout/);assert.equal(attempts,1);
});

test('admin summary needs only ticket and warranty sources; same-session refresh failure preserves a visibly stale result', async () => {
  const { c, node } = harness(user('admin',2000000,'Semua'));const calls=[];
  c.ambilTabelRingkasanLobby_ = async source => {calls.push(source);return [];};
  c.tampilkanRingkasanLobby_ = () => {node('lobby-dashboard-content').innerHTML='<p>Rekap berhasil</p>';};
  assert.equal(await c.muatRingkasanLobby_(),true);assert.deepEqual(calls,['tiket','garansi']);
  c.ambilTabelRingkasanLobby_ = async()=>{throw Object.assign(Error('timeout'),{code:'SUPABASE_TIMEOUT'});};
  assert.equal(await c.muatRingkasanLobby_(),false);assert.equal(node('lobby-dashboard-content').innerHTML,'<p>Rekap berhasil</p>');
  assert.match(node('lobby-dashboard-status').textContent,/hasil terakhir/);
  node('lobby-periode').value='2026-10';assert.equal(await c.muatRingkasanLobby_(),false);
  assert.doesNotMatch(node('lobby-dashboard-content').innerHTML,/Rekap berhasil/,'another month cannot use the cached report');
});

test('cached summaries are discarded after denied access or a change of account or role',async()=>{
  for(const change of ['denied','account','role','late_error']){
    const {c,node}=harness(user('admin',2000000,'Semua'));c.ambilTabelRingkasanLobby_=async()=>[];
    c.tampilkanRingkasanLobby_=()=>{node('lobby-dashboard-content').innerHTML='<p>Privat admin</p>';};await c.muatRingkasanLobby_();
    if(change==='account')c.penggunaAktif={...c.penggunaAktif,Username:'other'};
    if(change==='role')c.penggunaAktif.Role='teknisi';
    c.ambilTabelRingkasanLobby_=async()=>{throw Object.assign(Error('denied'),{status:change==='denied'?403:503});};
    if(change==='late_error'){
      let reject;c.ambilTabelRingkasanLobby_=source=>source==='tiket'?new Promise((_,no)=>{reject=no;}):Promise.resolve([]);
      const pending=c.muatRingkasanLobby_();c.penggunaAktif={...c.penggunaAktif,Username:'new'};node('lobby-dashboard-content').innerHTML='<p>Account baru</p>';reject(Error('late timeout'));await pending;
      assert.equal(node('lobby-dashboard-content').innerHTML,'<p>Account baru</p>');continue;
    }
    assert.equal(await c.muatRingkasanLobby_(),false);assert.doesNotMatch(node('lobby-dashboard-content').innerHTML,/Privat admin/);
  }
});

test('thin source projections preserve revenue, unpaid history, paid technician points and prospect calculations',async()=>{
  const {c}=harness(user('manager',2000000,'Semua'));c.cabangAktif='Raha';
  c.perbaruiStatusSLAAktualTiket_=row=>row;c.statusGaransiEfektif_=s=>s;c.statusProspekKanonis_=s=>s;
  vm.runInContext(extract('ambilTabelRingkasanLobby_'),c);
  const raw={
    tiket:[{id_tiket:'TKT-1',no_transaksi:'001/KSR/UTM/0926',waktu_lapor:'2026-09-02T08:00:00+08:00',waktu_selesai:'2026-09-02T16:00:00+08:00',tanggal_lunas:'2026-09-03T10:00:00+08:00',status:'Selesai',status_sla:'TERPENUHI',status_sla_respon:'TERPENUHI',status_pembayaran:'Lunas',teknisi:'Wawan',sales:'Sales A',bobot_poin:4,nilai_penjualan:100,cabang:'Raha',tanda_tangan:'data:image/png;base64,unused',bukti_banding:'unused',deskripsi_pekerjaan_ba:'unused'},
      {id_tiket:'TKT-OLD',no_transaksi:'002/KSR/UTM/0826',status:'Selesai',status_pembayaran:'Belum Lunas',teknisi:'Wawan',cabang:'Raha',waktu_lapor:'2026-08-02T08:00:00+08:00',waktu_selesai:'2026-08-02T16:00:00+08:00'}],
    garansi:[{id_garansi:'G1',referensi_tiket_nota:'TKT-1',status:'Aktif',tanggal_mulai:'2026-09-03T10:00:00+08:00',tanggal_habis:'2026-11-03T10:00:00+08:00',sales:'Sales A',omzet:100,cabang:'Raha',waktu_siap_diambil:'2026-09-02T17:00:00+08:00',waktu_diambil:'2026-09-03T10:00:00+08:00'}],
    penjualan:[{id_penjualan:'SLS-1',no_transaksi:'SALE-1',waktu_lapor:'2026-09-04T10:00:00+08:00',sales:'Sales A',nominal_rp:250,cabang:'Raha'}],
    prospek:[{id_prospek:'P1',tanggal_input:'2026-09-01T10:00:00+08:00',status_prospek:'Closing / Deal',sales_penanggung_jawab:'Sales A',estimasi_rp:500,cabang:'Raha',bukti_chat:'data:image/png;base64,unused',surat_penawaran:'unused'}]
  };
  const map={tiket:c.petakanTiketSupabase_,garansi:c.petakanGaransiSupabase_,penjualan:c.petakanPenjualanSupabase_,prospek:c.petakanProspekSupabase_};
  const calculate=rows=>{c.globalTickets=rows.tiket.map(map.tiket);c.globalGaransi=rows.garansi.map(map.garansi);c.globalPenjualan=rows.penjualan.map(map.penjualan);c.globalProspek=rows.prospek.map(map.prospek);return JSON.parse(JSON.stringify(c.renderDashboard({hitungSaja:true,bulan:'09',tahun:'2026'})));};
  const full=calculate(raw);assert.ok(full.ringkasanEksekutif.omzet>0);assert.equal(full.rekapNotaIpos.belumLunasSeluruhRiwayat,1);assert.ok(full.statsTeknisi.Wawan.poin_terkumpul>0);
  c.callSupabase=async endpoint=>{const url=new URL('https://fixture/'+endpoint),table=url.pathname.slice(1),fields=url.searchParams.get('select').split(',');return raw[table].map(row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]])));};
  const thin={};for(const table of Object.keys(raw))thin[table]=await c.ambilTabelRingkasanLobby_(table,'Raha');
  assert.deepEqual(calculate(thin),full);
});
