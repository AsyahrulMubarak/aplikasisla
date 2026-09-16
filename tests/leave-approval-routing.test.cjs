const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const policy = read('maintenance/leave-approval-routing.gs');
const handlers = read('maintenance/leave-approval-handlers.gs');
const complete = process.env.LEAVE_APPROVAL_SOURCE ? fs.readFileSync(path.resolve(process.env.LEAVE_APPROVAL_SOURCE), 'utf8').replace(/\r\n/g, '\n') : '';
const staff = [
  { username:'director', nama_asli:'Direktur Uji', role:'direktur', hak_akses_cabang:'Semua', no_wa:'081111111111' },
  { username:'manager', nama_asli:'Manager Uji', role:'manager', hak_akses_cabang:'Semua', no_wa:'082222222222' },
  { username:'admin', nama_asli:'Admin Uji', role:'admin', hak_akses_cabang:'Semua', no_wa:'083333333333' },
  { username:'admin-raha', nama_asli:'Admin Raha Uji', role:'admin_raha', hak_akses_cabang:'Raha', no_wa:'084444444444' },
  { username:'legacy-raha', nama_asli:'Admin Raha Lama', role:'admin', hak_akses_cabang:'Raha', no_wa:'085555555555' },
  { username:'asyahrul', nama_asli:'Teknisi Uji', role:'teknisi', hak_akses_cabang:'Kendari', no_wa:'086666666666' },
];
const request = (role, extra={}) => ({id_pengajuan:'PGJ-'+role, nama_pegawai:'Pemohon '+role, role, status:'Menunggu', jenis:'Sakit', tanggal_mulai:'2026-09-16', tanggal_selesai:null, ...extra});
function harness(actor, requests=[]) {
  const sent=[],writes=[];
  const context=vm.createContext({console,
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'test-only'})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>JSON.parse(text)})},
    Utilities:{base64Decode:()=>[],newBlob:()=>({}),formatDate:()=> '20260916180000',getUuid:()=> 'test-uuid'},
    DriveApp:{Access:{ANYONE_WITH_LINK:'link'},Permission:{VIEW:'view'},getFolderById:()=>({createFile:()=>({setSharing(){},getUrl:()=> 'https://example.invalid/photo'})})},
  });
  if(complete) vm.runInContext(complete,context);
  else {
    context.SUPABASE_URL='https://example.invalid/rest/v1/';context.FOLDER_DRIVE_ID='test-only';
    context.buatOutputJson_=value=>value;
    context.normalisasiNoWA_=value=>value.replace(/^0/,'62');
    vm.runInContext(policy+'\nfunction runHandlers(data,userLogin,punyaHakKelola){\n'+handlers+'\n}',context);
  }
  context.verifikasiSessionToken_=()=>actor.username;
  context.kirimBroadcastFonnte_=(numbers,message)=>sent.push({numbers:Array.from(numbers),message});
  context.callSupabase_=(endpoint,method='GET',payload)=>{
    const url=new URL(endpoint);
    if(url.pathname.endsWith('/users')) {
      if(url.searchParams.has('username')||url.searchParams.has('username_login'))return [actor];
      assert.ok(url.searchParams.get('select').includes('hak_akses_cabang'));
      return staff;
    }
    assert.ok(url.pathname.endsWith('/pengajuan_cuti'));
    if(method!=='GET'){writes.push({method,payload:structuredClone(payload)});return [payload];}
    const id=url.searchParams.get('id_pengajuan');
    return id?requests.filter(r=>'eq.'+r.id_pengajuan===id):requests;
  };
  return {context,sent,writes,run(data){
    if(complete) return context.doPost({postData:{contents:JSON.stringify({apiKey:vm.runInContext('API_KEY',context),user:{role:'direktur'},...data})}});
    const user={username:actor.username,namaAsli:actor.nama_asli,role:actor.role,hakAksesCabang:actor.hak_akses_cabang};
    const management=['admin','manager','direktur'].includes(actor.role)&&actor.hak_akses_cabang!=='Raha';
    return context.runHandlers(data,user,management);
  }};
}

if(complete)test('Tested routing and handlers match production, ignoring trailing spaces',()=>{
  const clean=value=>value.replace(/[ \t]+$/gm,'').trim();
  assert.ok(clean(complete).includes(clean(policy)));assert.ok(clean(complete).includes(clean(handlers)));new vm.Script(complete);
});

for(const jenis of ['Sakit','Izin'])for(const [index,expected] of [[2,[0,1]],[1,[0,2]],[5,[0,1,2]]]) {
  test(`${jenis} from ${staff[index].role}: WA only to permitted approvers`,()=>{
    const h=harness(staff[index]);
    const result=h.run({action:'ajukanSakitIzin',jenis,tanggalMulai:'2026-09-16',selesai:'2026-09-18',alasan:'Uji lokal',buktiFotoBase64:'data:image/jpeg;base64,'+'A'.repeat(100),role:'direktur'});
    assert.equal(result.status,'sukses');assert.equal(h.writes.length,1);
    assert.equal(h.writes[0].payload.role,staff[index].role);
    assert.equal(h.writes[0].payload.tanggal_selesai,jenis==='Sakit'?null:'2026-09-18');
    assert.equal(h.sent.length,1);
    assert.deepEqual(h.sent[0].numbers,expected.map(i=>staff[i].no_wa.replace(/^0/,'62')));
    assert.match(h.sent[0].message,/https:\/\/aplikasisla\.vercel\.app\//);
  });
}

for(const role of ['admin','manager','teknisi'])for(let index=0;index<staff.length;index++)for(const keputusan of ['Disetujui','Ditolak']) {
  const permitted=role==='admin'?[0,1]:role==='manager'?[0,2]:[0,1,2];
  test(`${keputusan}: ${staff[index].username} decides ${role} request only if allowed`,()=>{
    const p=request(role),h=harness(staff[index],[p]);
    const result=h.run({action:'responPengajuan',idPengajuan:p.id_pengajuan,keputusan,role:'direktur',user:{role:'direktur'},namaAsli:'Fake Director'});
    assert.equal(result.status,permitted.includes(index)?'sukses':'gagal');
    assert.equal(h.writes.length,permitted.includes(index)?1:0);
    if(h.writes.length){assert.equal(h.writes[0].payload.status,keputusan);assert.equal(h.writes[0].payload.disetujui_oleh,staff[index].nama_asli);}
    assert.equal(h.sent.length,0);assert.equal(p.status,'Menunggu');
  });
}

for(const [index,expected] of [[0,['admin','manager','teknisi']],[1,['admin','teknisi']],[2,['manager','teknisi']]]) {
  test(`${staff[index].role} queue shows only actionable requests; history remains visible`,()=>{
    const requests=['admin','manager','teknisi'].map(role=>request(role));
    const h=harness(staff[index],requests);
    assert.deepEqual(Array.from(h.run({action:'getDaftarPengajuan'}).data,r=>r.Role),expected);
    assert.equal(h.run({action:'getRiwayatPengajuan'}).data.length,3);
    assert.equal(h.writes.length,0);assert.equal(h.sent.length,0);
  });
}

test('Admin Kendari / Semua / legacy blank accepted; Raha and unknown branch denied',()=>{
  const h=harness(staff[0]);
  for(const field of ['hakAksesCabang','hak_akses_cabang'])for(const [branch,allowed] of [['Kendari',true],['Semua',true],['',true],[null,true],['Raha',false],['Cabang Baru',false]]){
    assert.equal(h.context.bolehMemutuskanPengajuan_({role:' ADMIN ',[field]:branch},{role:' MANAGER '}),allowed);
  }
  assert.equal(h.context.bolehMemutuskanPengajuan_({role:'admin_raha',hak_akses_cabang:'Kendari'},{role:'manager'}),false);
  assert.equal(h.context.bolehMemutuskanPengajuan_(null,{role:'manager'}),false);
  assert.equal(h.context.bolehMemutuskanPengajuan_({role:'direktur'},null),false);
});

test('Final decisions and invalid decisions never overwrite existing requests',()=>{
  for(const status of ['Disetujui','Ditolak']){
    const p=request('admin',{status}),h=harness(staff[0],[p]);
    assert.equal(h.run({action:'responPengajuan',idPengajuan:p.id_pengajuan,keputusan:'Disetujui'}).status,'gagal');
    assert.equal(h.writes.length,0);
  }
  const h=harness(staff[0],[request('admin')]);
  assert.equal(h.run({action:'responPengajuan',idPengajuan:'PGJ-admin',keputusan:'Invalid'}).status,'gagal');
  assert.equal(h.writes.length,0);
});
