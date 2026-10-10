'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
process.env.TZ = 'Asia/Makassar';
const [snapshotPath, sourcePath] = process.argv.slice(2);
if (!snapshotPath || !sourcePath) throw new Error('Usage: node verify-warranty-dashboard.cjs SNAPSHOT.json INDEX.html');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const html = fs.readFileSync(sourcePath, 'utf8');
const extract = name => {
  const match = html.match(new RegExp('^([ \\t]*)(?:async )?function ' + name + '\\([^]*?^\\1\\}', 'm'));
  assert.ok(match, name);
  return match[0];
};
const bintang = 'Muhammad Bintang Restu Prabowo';
const profile = { Role: 'teknisi', Username: 'audit-only', 'Nama Asli': bintang, Hak_Akses_Cabang: 'Kendari', Cabang: 'Kendari' };
const columns = { id_tiket: 'ID Tiket', teknisi: 'Teknisi', status: 'Status', waktu_lapor: 'Waktu Lapor',
  waktu_selesai: 'Waktu Selesai', status_sla: 'Status SLA', status_sla_respon: 'Status SLA Respon',
  status_pembayaran: 'Status Pembayaran', tanggal_lunas: 'Tanggal Lunas', bobot_poin: 'Bobot Poin', cabang: 'Cabang' };
const tickets = snapshot.tickets.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [columns[key] || key, value])));
const nodes = new Map();
const c = vm.createContext({ console, penggunaAktif: profile, cabangAktif: 'Kendari',
  API_URL_CABANG: { Kendari: 'audit-only', Raha: 'audit-only' }, globalUsers: [profile], globalTickets: tickets,
  globalGaransi: [], globalPenjualan: [], globalProspek: [], hitungDurasiJamKerjaMs: () => 0,
  document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { innerHTML: '', style: {}, selectedOptions: [] }); return nodes.get(id); } }
});
const names = ['normalisasiCabang', 'rolePengguna', 'hakAksesCabangPengguna', 'roleAdalahAdminOperasional_',
  'roleAdalahManajemen_', 'penggunaSalesLintasCabang_', 'penggunaBolehMengaksesCabang', 'dataSesuaiCabangAktif_',
  'parseSafeDate', 'daftarTeknisiUnikTiket_', 'poinHangusKarenaSLA_', 'statusPoinSudahCair_',
  'statusGaransiEfektif_', 'petakanGaransiSupabase_', 'kunciNamaPekerjaanTeknisi_', 'rekapPekerjaanTeknisi_', 'namaTeknisiPenggantian_', 'tanggalCatatanPenggantian_', 'riwayatPenggantianTeknisi_', 'rekapPenggantianTeknisi_', 'renderDashboard'];
vm.runInContext(names.map(extract).join('\n'), c);
c.globalGaransi = snapshot.garansi.map(c.petakanGaransiSupabase_);
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (match[1].trim()) new vm.Script(match[1]);
const calculate = month => c.renderDashboard({ hitungSaja: true, bulan: month, tahun: '2026' }).statsTeknisi;
const october = calculate('10');
const september = calculate('09');
const result = { tickets: tickets.length, warranties: c.globalGaransi.length,
  bintang: { octoberClaims: october[bintang].garansi_bocor, septemberClaims: september[bintang].garansi_bocor,
    octoberCompleted: october[bintang].tiket_selesai, octoberPoints: october[bintang].poin_terkumpul },
  replacementClaims: october['Muhammad Saharullah Raiya']?.garansi_bocor || 0 };
console.log(JSON.stringify(result, null, 2));
assert.equal(result.bintang.octoberClaims, 1);
assert.equal(result.bintang.septemberClaims, 0);
assert.equal(result.replacementClaims, 0);
