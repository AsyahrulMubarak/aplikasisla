'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
process.env.TZ = 'Asia/Makassar';
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'slipgaji.html'), 'utf8');
const profiles = [
  { 'Nama Asli':'Abu Naura',Role:'teknisi',Hak_Akses_Cabang:'Raha','Gaji Pokok':0 },
  { 'Nama Asli':'Abu Naura',Role:'admin_raha',Hak_Akses_Cabang:'Raha','Gaji Pokok':2000000 },
  { 'Nama Asli':'Abu Adibah',Role:'teknisi',Hak_Akses_Cabang:'Raha','Gaji Pokok':2000000 },
  { 'Nama Asli':'Rendi',Role:'teknisi',Hak_Akses_Cabang:'Raha','Gaji Pokok':2000000 },
  { 'Nama Asli':'Wawan',Role:'teknisi',Hak_Akses_Cabang:'Raha','Gaji Pokok':2000000 },
  { 'Nama Asli':'Ardan',Role:'sales',Hak_Akses_Cabang:'Raha','Gaji Pokok':2000000 },
  { 'Nama Asli':'Ardan',Role:'admin',Hak_Akses_Cabang:'Kendari','Gaji Pokok':9000000 },
  { 'Nama Asli':'Outside',Role:'teknisi',Hak_Akses_Cabang:'Kendari','Gaji Pokok':2000000 }
];
const ticket = (date, technician, points, options={}) => ({ Status:'Selesai','Status Pembayaran':'Lunas',
  'Tanggal Lunas':date, Teknisi:technician,'Bobot Poin':points,'Status SLA':'TERPENUHI',Cabang:'Raha',...options });
const tickets = [
  ticket('2026-09-10T10:00:00+08:00','Abu Naura',10),
  ticket('2026-09-11T10:00:00+08:00','Abu Adibah, Rendi',20),
  ticket('2026-09-12T10:00:00+08:00','Rendi, Wawan, Abu Adibah',15),
  ticket('2026-09-13T10:00:00+08:00','Wawan',5),
  ticket('2026-09-14T10:00:00+08:00','Abu Naura',100,{Cabang:'Kendari'}),
  ticket('2026-08-31T10:00:00+08:00','Abu Naura',100),
  ticket('2026-09-15T10:00:00+08:00','Abu Adibah',100,{'Status SLA':'TERLAMBAT'}),
  ticket('2026-09-16T10:00:00+08:00','Abu Adibah',3,{'Status SLA':'TERLAMBAT','Veto Admin':'Ya'}),
  ticket('2026-09-17T10:00:00+08:00','Outside, Abu Adibah',4)
];
function makeContext() {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-28T12:00:00+08:00'])); } }
  const context = vm.createContext({ Date:FixedDate, Set, globalUsers:structuredClone(profiles),
    globalAbsen:[],globalTickets:structuredClone(tickets),formatRp:value=>'Rp '+Math.round(value),
    ambilVariabelPayroll:()=>({luarKota:'',liburTambahan:'',fee:0,kasbon:0}) });
  vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'),
    html.indexOf('        function generateSlipIndividu')),context);
  return context;
}
test('Poin teknisi Abu Naura dibayar hanya pada profil admin Raha',()=>{
  const context=makeContext();
  const result=context.kalkulasiGajiPegawai('Abu Naura','2026-09',26);
  assert.equal(result.profil.Role,'admin_raha');
  assert.equal(result.totalPoinSla,10);
  assert.equal(result.totalBonusPoin,100000);
  assert.equal(result.totalBonusPoinTeknisiRaha,0);
  assert.match(result.labelBonusPoin,/Abu Naura \(Teknisi\)/);
});
test('Ardan sales mendapat poin Abu Adibah serta seluruh bagian poin teknisi Raha',()=>{
  const context=makeContext();
  const result=context.kalkulasiGajiPegawai('Ardan','2026-09',26);
  assert.equal(result.profil.Role,'sales');
  assert.equal(result.totalPoinSla,20);
  assert.equal(result.totalBonusPoin,200000);
  assert.equal(result.totalPoinTeknisiRaha,55);
  assert.equal(result.totalBonusPoinTeknisiRaha,137500);
  assert.equal(result.tampilkanPoinTeknisiRaha,true);
  assert.match(result.labelBonusPoin,/Abu Adibah/);
  assert.equal(result.totalBersih - result.totalUpahHadir + result.totalPotongan - result.totalLembur -
    result.totalTunjanganTetap - result.feeMarketing + result.kasbon,337500);
});
test('Teknisi lain tetap mendapat poin pribadinya tanpa bonus tim Ardan',()=>{
  const context=makeContext();
  const result=context.kalkulasiGajiPegawai('Abu Adibah','2026-09',26);
  assert.equal(result.totalPoinSla,20);
  assert.equal(result.totalBonusPoin,200000);
  assert.equal(result.totalBonusPoinTeknisiRaha,0);
  assert.equal(result.tampilkanPoinTeknisiRaha,false);
});
test('Jumlah tim memakai pecahan poin sebelum pembulatan per teknisi',()=>{
  const context=makeContext();
  context.globalTickets=[ticket('2026-09-12T10:00:00+08:00','Abu Adibah, Rendi, Wawan',20)];
  const result=context.kalkulasiGajiPegawai('Ardan','2026-09',26);
  assert.equal(result.totalPoinSla,6.7);
  assert.equal(result.totalBonusPoin,67000);
  assert.equal(result.totalPoinTeknisiRaha,20);
  assert.equal(result.totalBonusPoinTeknisiRaha,50000);
});
