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

test('Poin Raha tetap dihitung ketika manajemen membuka slip dari lobby Kendari',()=>{
  const context=makeContext();
  context.globalTickets=[ticket('2026-09-10T10:00:00+08:00','Abu Naura',100,{Cabang:'Kendari'})];
  context.tiketPayrollPerCabang_={Kendari:context.globalTickets,Raha:structuredClone(tickets)};
  context.cabangAktif='Kendari';
  const abuNaura=context.kalkulasiGajiPegawai('Abu Naura','2026-09',26);
  const ardan=context.kalkulasiGajiPegawai('Ardan','2026-09',26);
  assert.equal(abuNaura.totalPoinSla,10);
  assert.equal(abuNaura.totalBonusPoin,100000);
  assert.equal(ardan.totalPoinSla,20);
  assert.equal(ardan.totalBonusPoinTeknisiRaha,137500);
});

test('Rendi dan Wawan tidak menerima tiga bonus bulanan Raha tetapi poin SLA tetap masuk',()=>{
  const context=makeContext();
  for(const nama of ['Rendi','Wawan']){
    const result=context.kalkulasiGajiPegawai(nama,'2026-09',26);
    assert.equal(result.totalTunjanganTetap,0,nama);
    assert.equal(result.arrayTunjangan.length,0,nama);
    assert.ok(result.totalBonusPoin>0,nama);
    assert.equal(result.totalBonusPoinTeknisiRaha,0,nama);
  }
  const kontrol=context.kalkulasiGajiPegawai('Abu Adibah','2026-09',26);
  assert.equal(kontrol.totalTunjanganTetap,100000);
  assert.equal(kontrol.arrayTunjangan.length,3);
});

test('Bonus Raha lama Rendi dan Wawan dibuang tanpa menghapus honor lain',()=>{
  const context=makeContext();
  const bonusLama='TIDAK TELAT MASUK PAGI, IZIN LEBIH 3X ATAU TIDAK ALPA LEBIH DARI 2X=100000|SHOLAT 5 WAKTU=100000|BONUS KARENA 2 TUNJANGAN DIATAS TERPENUHI=100000|Honor Lain=25000';
  for(const profil of context.globalUsers.filter(p=>['Rendi','Wawan'].includes(p['Nama Asli']))) profil['Bonus Tambahan']=bonusLama;
  for(const nama of ['Rendi','Wawan']){
    const result=context.kalkulasiGajiPegawai(nama,'2026-09',26);
    assert.equal(result.totalTunjanganTetap,25000,nama);
    assert.equal(result.arrayTunjangan.length,1,nama);
    assert.equal(result.arrayTunjangan[0].nama,'Honor Lain',nama);
  }
});

function makeTicketLoaderContext(access='Semua'){
  const requests=[];
  const context=vm.createContext({
    normalisasiCabangPayroll:value=>value==='Kendari'||value==='Raha'?value:'',
    normalisasiCabangSesi:value=>value,
    penggunaAktif:{Hak_Akses_Cabang:access},
    penggunaBolehKelolaPayroll_:()=>true,
    tiketPayrollPerCabang_:{Kendari:[]},
    periodeTiketPayroll_:'2026-09',
    janjiTiketPayrollCabang_:Object.create(null),
    urutanLoadDataPayroll:1,
    controllerLoadDataPayroll_:null,
    apiUrl:'kendari-gas',
    payloadSesiSlip:(action,data)=>({action,...data}),
    pastikanTokenSupabaseAktif_:async()=>{},
    jalankanSumberPayrollDenganUlang_:async(_label,run)=>run(),
    fetchJsonDenganTimeout_:async(url,payload)=>{
      requests.push({url,payload});
      return {cabang:'Raha',tickets:[ticket('2026-09-10T10:00:00+08:00','Abu Naura',10)]};
    },
    document:{getElementById:()=>({value:'2026-09'})},
    buatErrorBatalPayroll_:()=>new Error('dibatalkan'),
    FETCH_TIMEOUT_MS:30000
  });
  vm.runInContext(html.slice(html.indexOf('        async function pastikanTiketPayrollCabang_'),
    html.indexOf('        async function prosesData()')),context);
  return {context,requests};
}

test('Manajemen memuat tiket Raha lewat GAS cabang aktif yang memverifikasi sesi',async()=>{
  const {context,requests}=makeTicketLoaderContext();
  await Promise.all([
    context.pastikanTiketPayrollCabang_('Raha','2026-09'),
    context.pastikanTiketPayrollCabang_('Raha','2026-09')
  ]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'kendari-gas');
  assert.equal(requests[0].payload.action,'getPayrollData');
  assert.equal(requests[0].payload.periode,'2026-09');
  assert.equal(requests[0].payload.cabang,'Raha');
  assert.equal(context.tiketPayrollPerCabang_.Raha.length,1);
});

test('Respons GAS cabang yang keliru tidak pernah dipakai sebagai nol poin Raha',async()=>{
  const {context}=makeTicketLoaderContext();
  context.fetchJsonDenganTimeout_=async()=>({cabang:'Kendari',tickets:[]});
  await assert.rejects(context.pastikanTiketPayrollCabang_('Raha','2026-09'),/tidak sesuai/);
  assert.equal(context.tiketPayrollPerCabang_.Raha,undefined);
});

test('Akun satu cabang tidak mengambil tiket cabang lain',async()=>{
  const {context,requests}=makeTicketLoaderContext('Kendari');
  await assert.rejects(context.pastikanTiketPayrollCabang_('Raha','2026-09'),/tidak memiliki akses/);
  assert.equal(requests.length,0);
});
