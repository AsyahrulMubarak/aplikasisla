const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test');
process.env.TZ='Asia/Makassar';
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'slipgaji.html'),'utf8');
const shared=fs.readFileSync(path.join(root,'maintenance/payroll-profile.gs'),'utf8');
const save=fs.readFileSync(path.join(root,'maintenance/payroll-allowance-save.gs'),'utf8');
const longBonus='BONUS DISIPLIN  BILA TIDAK TELAT LEBIH DARI 3X ATAU TIDAK ALPA LEBIH DARI 2 KALI';
const staff=[
 {'Nama Asli':'Abu Abdillah',Username:'sales-test',Role:'sales','Gaji Pokok':0},
 {'Nama Asli':'Abu Abdillah',Username:'manager-test',Role:'manager','Gaji Pokok':2600000,'Bonus Tambahan':longBonus+'=300000|Transportasi=150000'},
 {'Nama Asli':'Abu Naura',Username:'technician-test',Role:'teknisi','Gaji Pokok':0,Hak_Akses_Cabang:'Raha'},
 {'Nama Asli':'Abu Naura',Username:'admin-raha-test',Role:'admin_raha','Gaji Pokok':2600000,Hak_Akses_Cabang:'Raha'},
 {'Nama Asli':'ABU ABID',Username:'admin-test',Role:'admin','Gaji Pokok':2600000,'Bonus Tambahan':longBonus+'=300000'},
 {'Nama Asli':'Abu Abid',Username:'sales-admin-test',Role:'sales','Gaji Pokok':0},
];
function harness(users=staff){
 class FixedDate extends Date {constructor(...args){super(...(args.length?args:['2026-09-30T21:00:00+08:00']));}}
 const el={};
 const c=vm.createContext({Date:FixedDate,globalUsers:structuredClone(users),globalAbsen:[],globalTickets:[],formatRp:n=>'Rp '+Math.round(n),
  ambilVariabelPayroll:()=>({luarKota:'',fee:0,kasbon:0}),document:{getElementById:id=>el[id]||(el[id]={value:'2026-09',style:{},innerHTML:'',innerText:''})},penggunaAktif:{Role:'admin'}});
 vm.runInContext(html.slice(html.indexOf('        function normalisasiCabangPayroll'),html.indexOf('        function generateSlipIndividu')),c);
 return {c,el};
}
function monthEvents(name,{alpa=0,telat=0,izin=0}={}){
 const rows=[];
 for(let d=1;d<=30;d++){
  if(new Date(2026,8,d).getDay()===0)continue;
  const day='2026-09-'+String(d).padStart(2,'0');
  const row=(time,type)=>({'Nama Pegawai':name,'Waktu Absen':day+'T'+time+':00+08:00','Tipe Absen':type,'Status Disiplin':'',Keterangan:''});
  if(alpa-->0)continue;
  if(izin-->0){rows.push(row('08:00','Izin'));continue;}
  rows.push(row(telat-->0?'09:00':'08:00','Masuk'),row('17:00','Keluar'));
 }
 return rows;
}

test('Shared selector matches the frontend copy exactly apart from indentation',()=>{
 const clean=s=>s.trim().split('\n').map(l=>l.trim()).join('\n');
 assert.ok(clean(html).includes(clean(shared)));
});
for(const reverse of [false,true])test('Correct manager/admin Raha independent of row order '+reverse,()=>{
 const {c}=harness(reverse?[...staff].reverse():staff);
 for(const [name,role,username] of [['Abu Abdillah','manager','manager-test'],['Abu Naura','admin_raha','admin-raha-test'],['ABU ABID','admin','admin-test']]){
  c.globalAbsen=monthEvents(name);
  const r=c.kalkulasiGajiPegawai(name,'2026-09',26);
  assert.equal(r.profil.Role,role);assert.equal(r.profil.Username,username);assert.equal(r.gajiPokok,2600000);
 }
 assert.equal(c.daftarProfilPayroll().length,3);
});
test('Explicit manager/admin Raha roles take priority even if secondary accounts have a salary',()=>{
 const users=structuredClone(staff);users[0]['Gaji Pokok']=9000000;users[2]['Gaji Pokok']=9000000;
 const {c}=harness(users);assert.equal(c.cariProfilPayroll('Abu Abdillah').Username,'manager-test');assert.equal(c.cariProfilPayroll('Abu Naura').Username,'admin-raha-test');
});
test('Missing intended role never falls back to sales/technician and invented salary',()=>{
 const {c}=harness([staff[0],staff[2]]);assert.equal(c.cariProfilPayroll('Abu Abdillah'),null);assert.equal(c.cariProfilPayroll('Abu Naura'),null);
 assert.throws(()=>c.kalkulasiGajiPegawai('Abu Abdillah','2026-09',26),/Profil payroll/);
});
test('Admin Raha legacy role spelling and surrounding spaces resolve correctly',()=>{
 const user={...staff[3],Role:' Admin ',Hak_Akses_Cabang:' Raha '};const {c}=harness([staff[2],user]);assert.equal(c.cariProfilPayroll('  abu   naura ').Username,user.Username);
});
test('Ambiguous same-role salaried profiles do not silently pick the first account',()=>{
 const {c}=harness([staff[1],{...staff[1],Username:'another-manager'}]);assert.equal(c.cariProfilPayroll('Abu Abdillah'),null);
});

for(const label of ['Bonus Disiplin',longBonus,'  bonus   DISIPLIN bila hadir tertib  '])for(const counts of [{alpa:2,telat:2,izin:1},{alpa:3},{telat:4},{telat:2,izin:2},{alpa:3,telat:4,izin:4}]){
 test('Bonus boundary '+label.slice(0,18)+' '+JSON.stringify(counts),()=>{
  const name='Pegawai Uji';const {c}=harness([{'Nama Asli':name,Role:'teknisi','Gaji Pokok':2600000,'Bonus Tambahan':label+'=300000|TUNJANGAN BBM=300000'}]);
  c.globalAbsen=monthEvents(name,counts);const r=c.kalkulasiGajiPegawai(name,'2026-09',26);
  const violation=(counts.alpa||0)>2||(counts.telat||0)+(counts.izin||0)>3;
  assert.equal(r.dendaDisiplin,0);assert.equal(r.totalTunjanganTetap,violation?300000:600000);assert.equal(r.arrayTunjangan[1].nominal,300000);
  if(violation)assert.match(r.arrayTunjangan[0].nama,/Hangus/);
  assert.equal(c.globalUsers[0]['Bonus Tambahan'],label+'=300000|TUNJANGAN BBM=300000');
 });
}
test('No discipline bonus: one 300k penalty when both limits exceeded; BBM unchanged',()=>{
 const name='Pegawai Uji';const {c}=harness([{'Nama Asli':name,Role:'sales','Gaji Pokok':2600000,'Bonus Tambahan':'TUNJANGAN BBM=300000'}]);
 c.globalAbsen=monthEvents(name,{alpa:3,telat:4});let r=c.kalkulasiGajiPegawai(name,'2026-09',26);assert.equal(r.dendaDisiplin,300000);assert.equal(r.totalTunjanganTetap,300000);
 c.globalAbsen=monthEvents(name,{alpa:2,telat:3});r=c.kalkulasiGajiPegawai(name,'2026-09',26);assert.equal(r.dendaDisiplin,0);
});
test('Late after break never forfeits discipline bonus or creates the 300k penalty',()=>{
 const workdays=[];
 for(let d=1;d<=30;d++)if(new Date(2026,8,d).getDay()!==0){
  const day='2026-09-'+String(d).padStart(2,'0');
  workdays.push({'Nama Pegawai':'Pegawai Uji','Waktu Absen':day+'T14:00:00+08:00','Tipe Absen':'Masuk Setelah Istirahat','Status Disiplin':'Terlambat Setelah Istirahat',Keterangan:''});
  workdays.push({'Nama Pegawai':'Pegawai Uji','Waktu Absen':day+'T17:00:00+08:00','Tipe Absen':'Keluar','Status Disiplin':'',Keterangan:''});
 }
 for(const bonus of [longBonus+'=300000','TUNJANGAN BBM=300000']){
  const {c}=harness([{'Nama Asli':'Pegawai Uji',Role:'sales','Gaji Pokok':2600000,'Bonus Tambahan':bonus}]);
  c.globalAbsen=structuredClone(workdays);const r=c.kalkulasiGajiPegawai('Pegawai Uji','2026-09',26);
  assert.equal(r.countTelatPagi,0);assert.equal(r.dendaDisiplin,0);
  if(bonus.startsWith(longBonus))assert.equal(r.totalTunjanganTetap,300000);
 }
});
test('The full 08:45 minute is on time and lateness starts at 08:46',()=>{
 const {c}=harness([{'Nama Asli':'Pegawai Uji',Role:'sales','Gaji Pokok':2600000,'Bonus Tambahan':'TUNJANGAN BBM=300000'}]);
 c.globalAbsen=monthEvents('Pegawai Uji');
 c.globalAbsen=c.globalAbsen.filter(e=>!e['Waktu Absen'].startsWith('2026-09-01'));
 c.globalAbsen.push({'Nama Pegawai':'Pegawai Uji','Waktu Absen':'2026-09-01T08:45:59+08:00','Tipe Absen':'Masuk','Status Disiplin':'',Keterangan:''},{'Nama Pegawai':'Pegawai Uji','Waktu Absen':'2026-09-01T17:00:00+08:00','Tipe Absen':'Keluar','Status Disiplin':'',Keterangan:''});
 assert.equal(c.kalkulasiGajiPegawai('Pegawai Uji','2026-09',26).countTelatPagi,0);
 c.globalAbsen.find(e=>e['Waktu Absen'].includes('08:45:59'))['Waktu Absen']='2026-09-01T08:46:00+08:00';
 assert.equal(c.kalkulasiGajiPegawai('Pegawai Uji','2026-09',26).countTelatPagi,1);
});
for(const name of ['Fauzan','Dafa','Mubarak','Asyahrul Mubarak'])test('Discipline exceptions preserved: '+name,()=>{
 const {c}=harness([{'Nama Asli':name,Role:'teknisi','Gaji Pokok':2600000}]);c.globalAbsen=monthEvents(name,{alpa:3,telat:4});assert.equal(c.kalkulasiGajiPegawai(name,'2026-09',26).dendaDisiplin,name==='Asyahrul Mubarak'?300000:0);
});
test('All registered discipline components expire together without changing another allowance',()=>{
 const name='Pegawai Uji';const {c}=harness([{'Nama Asli':name,Role:'teknisi','Gaji Pokok':2600000,'Bonus Tambahan':'Bonus Disiplin=100000|'+longBonus+'=200000|Honor=500000'}]);
 c.globalAbsen=monthEvents(name,{alpa:3});const r=c.kalkulasiGajiPegawai(name,'2026-09',26);assert.equal(r.totalTunjanganTetap,500000);assert.equal(r.dendaDisiplin,0);
});
test('Rekap renders correct roles, wages and one entry per person',()=>{
 const {c,el}=harness();
 c.globalAbsen=['Abu Abdillah','Abu Naura','ABU ABID'].flatMap(n=>monthEvents(n));
 vm.runInContext(html.slice(html.indexOf('        function generateDashboardRekap()'),html.indexOf('        function kembaliKeLobiAman()')),c);
 c.generateDashboardRekap();const rows=el['tabel-dashboard'].innerHTML;
 assert.match(rows,/MANAGER/);assert.match(rows,/ADMIN_RAHA/);assert.doesNotMatch(rows,/SALES|TEKNISI|1500000/);assert.equal((rows.match(/<tr/g)||[]).length,3);
});
test('Dropdown uses canonical profile and has no duplicate names',()=>{
 const {c,el}=harness();
 vm.runInContext(html.slice(html.indexOf('        function isiDropdownPegawai('),html.indexOf('        function formatRp(')),c);
 c.isiDropdownPegawai();const options=el['pilih-pegawai'].innerHTML;
 assert.match(options,/Abu Abdillah \(manager\)/);assert.match(options,/Abu Naura \(admin_raha\)/);assert.equal((options.match(/value="Abu Abdillah"/g)||[]).length,1);assert.doesNotMatch(options,/\(sales\)|\(teknisi\)/);
});
for(const name of ['Abu Abdillah','Abu Naura'])for(const provideUsername of [false,true])test('Allowance save targets intended row '+name+' username='+provideUsername,()=>{
 const {c}=harness();vm.runInContext(save,c);const headers=['Nama Asli','Username','Role','Gaji Pokok','Bonus Tambahan','Hak_Akses_Cabang'];
 const rows=[headers,...staff.map(u=>headers.map(h=>u[h]||''))],writes=[];
 const sheet={getDataRange:()=>({getValues:()=>rows}),getRange:(r,col)=>({setValue:v=>writes.push({r,col,v})})};
 const profile=c.cariProfilPayroll(name);c.simpanTunjanganProfilPayroll_(sheet,{namaAsli:name,usernameTarget:provideUsername?profile.Username:'',tunjanganData:'Uji=123'});
 assert.equal(writes.length,1);assert.equal(rows[writes[0].r-1][1],profile.Username);assert.equal(writes[0].col,5);assert.equal(writes[0].v,'Uji=123');
});
test('Conflicting username or missing profile never writes allowance to a namesake',()=>{
 const {c}=harness();vm.runInContext(save,c);let writes=0;
 const rows=[['Nama Asli','Username','Role','Gaji Pokok','Bonus Tambahan'],['Abu Abdillah','sales-test','sales',0,''],['Abu Abdillah','manager-test','manager',2600000,'']];
 const sheet={getDataRange:()=>({getValues:()=>rows}),getRange:()=>({setValue:()=>writes++})};
 assert.throws(()=>c.simpanTunjanganProfilPayroll_(sheet,{namaAsli:'Abu Abdillah',usernameTarget:'sales-test',tunjanganData:'Uji=123'}),/tidak sesuai/);
 rows.pop();assert.throws(()=>c.simpanTunjanganProfilPayroll_(sheet,{namaAsli:'Abu Abdillah',tunjanganData:'Uji=123'}),/tidak ditemukan/);assert.equal(writes,0);
});
