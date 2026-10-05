const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { test } = require('node:test');
const root = process.env.PAYROLL_EVIDENCE_SOURCE_DIR || path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/sla-payroll-attendance/index.ts'), 'utf8');
const html = fs.readFileSync(path.join(root, 'slipgaji.html'), 'utf8');
const manager = { name:'Manager', username:'manager', authId:'00000000-0000-4000-8000-000000000001', role:'manager',
  salary:3000000, branch:'Kendari', homeBranch:'Kendari', access:'Semua' };
const profiles = [
  {username:'worker-k',nama_asli:'Worker K',role:'teknisi',gaji_pokok:1500000,hak_akses_cabang:'Kendari'},
  {username:'worker-r',nama_asli:'Worker R',role:'sales',gaji_pokok:1500000,hak_akses_cabang:'Raha'},
  {username:'manager',nama_asli:'Manager',role:'manager',gaji_pokok:3000000,hak_akses_cabang:'Semua'},
  {username:'manager-sales',nama_asli:'Manager',role:'sales',gaji_pokok:0,hak_akses_cabang:'Kendari'}
];
const context = {periode:'2026-10',namaPegawai:'Worker K',usernameTarget:'worker-k'};
const pdf = size => { const header='%PDF-1.7\n', tail='\n%%EOF\n'; return Buffer.from(header+'x'.repeat(Math.max(0,size-header.length-tail.length))+tail); };
const upload = (patch={}) => ({action:'unggahBuktiPayroll',...context,jenis:'fee_marketing',idLama:'',namaFile:'bukti.pdf',
  pdfBase64:'data:application/pdf;base64,'+pdf(100).toString('base64'),...patch});
function harness(mode='ok',now='2026-10-05T12:00:00+08:00') {
  const calls=[], records=new Map(), objects=new Map(); let handler;
  class FixedDate extends Date { constructor(...a) { super(...(a.length?a:[now])); } }
  const c=vm.createContext({Response,Request,console,Intl,crypto,AbortSignal,URLSearchParams,URL,atob,btoa,Uint8Array,Date:FixedDate,
    Deno:{env:{get:k=>({SUPABASE_URL:'https://pdf.test',SUPABASE_SERVICE_ROLE_KEY:'secret-test',SUPABASE_ANON_KEY:'public-test'})[k]},serve:fn=>{handler=fn;}},
    fetch:async(url,options={})=>{
      const u=new URL(url); calls.push({url,...options});
      if(u.pathname==='/rest/v1/users') return Response.json(profiles);
      if(u.pathname==='/rest/v1/sla_bukti_payroll') return Response.json([...records.values()].filter(r=>
        ['username','periode','jenis','id'].every(k=>!u.searchParams.has(k)||u.searchParams.get(k)==='eq.'+r[k])));
      if(u.pathname==='/rest/v1/rpc/sla_simpan_bukti_payroll') {
        if(mode==='reject') return Response.json({message:'Rejected by database'},{status:400});
        if(mode==='uncertain') throw Error('Network disconnected after commit');
        const p=JSON.parse(options.body), key=[p.p_username,p.p_periode,p.p_jenis].join('|'), old=records.get(key);
        if((old?.id||'')!==p.p_id_lama) return Response.json({message:'Bukti sudah diubah pengguna lain.'},{status:400});
        if(p.p_hapus) {records.delete(key);return Response.json({status:'sukses',idTerhapus:old.id,objectPathLama:old.object_path});}
        const r={id:p.p_id,username:p.p_username,periode:p.p_periode,jenis:p.p_jenis,object_path:p.p_object_path,
          nama_file:p.p_nama_file,ukuran_byte:p.p_ukuran_byte,diperbarui_pada:'2026-10-05T04:00:00Z'};
        records.set(key,r);return Response.json({status:'sukses',data:r,objectPathLama:old?.object_path});
      }
      if(u.pathname.startsWith('/storage/v1/object/sign/')) return Response.json({signedURL:'/object/sign/sla-payroll-private/'+u.pathname.split('/sla-payroll-private/')[1]+'?token=test'});
      if(u.pathname==='/storage/v1/object/sla-payroll-private'&&options.method==='DELETE') {
        JSON.parse(options.body).prefixes.forEach(key=>objects.delete(key));return Response.json([]);
      }
      if(u.pathname.startsWith('/storage/v1/object/sla-payroll-private/')) {
        if(mode==='storage') return Response.json({},{status:500});
        assert.equal(options.headers['Content-Type'],'application/pdf');assert.equal(options.headers['x-upsert'],'false');
        objects.set(decodeURIComponent(u.pathname.split('/sla-payroll-private/')[1]),Buffer.from(options.body));return Response.json({});
      }
      throw Error('Unexpected request '+url);
    }});
  vm.runInContext(edge,c);return {c,calls,records,objects,handler};
}
test('Only Admin Kendari, Manager and Director can upload, replace and delete PDFs for both branches',async()=>{
  for(const actor of [{...manager,role:'admin'},manager,{...manager,role:'direktur',salary:0}]) {
    const h=harness();
    for(const target of profiles.slice(0,2)) {
      const patch={namaPegawai:target.nama_asli,usernameTarget:target.username};
      const first=await h.c.dispatch(upload(patch),actor);
      const second=await h.c.dispatch(upload({...patch,idLama:first.data.id,namaFile:'pengganti.pdf'}),actor);
      assert.notEqual(first.data.id,second.data.id);assert.equal(h.objects.size,1);
      assert.equal(h.calls.filter(c=>c.url.includes('/rpc/')).at(-1).headers.apikey,'secret-test');
      assert.equal(JSON.parse(h.calls.filter(c=>c.url.includes('/rpc/')).at(-1).body).p_auth_id,actor.authId);
      const removed=await h.c.dispatch({action:'hapusBuktiPayroll',...context,...patch,jenis:'fee_marketing',idLama:second.data.id},actor);
      assert.equal(removed.idTerhapus,second.data.id);assert.equal(h.objects.size,0);assert.equal(h.records.size,0);
    }
  }
});
test('Employees and both Admin Raha formats cannot mutate even with forged browser identity',async()=>{
  for(const role of ['teknisi','sales','admin_raha','freelance','unknown','admin']) {
    const h=harness(),actor={...manager,role,branch:'Raha',homeBranch:'Raha'};
    for(const action of ['unggahBuktiPayroll','hapusBuktiPayroll']) await assert.rejects(h.c.dispatch({...upload(),action,Role:'direktur',user:{Role:'direktur'}},actor),/Manajemen/);
    assert.equal(h.calls.length,0);
  }
  const h=harness();await assert.rejects(h.c.dispatch(upload(),{...manager,salary:0}),/Manajemen/);assert.equal(h.calls.length,0);
});
test('Own viewing/download enforce verified employee, branch and record; private paths are never listed',async()=>{
  const h=harness(),saved=await h.c.dispatch(upload(),manager);
  const worker={...manager,role:'teknisi',name:'Worker K',username:'worker-k',branch:'Kendari'};
  const list=await h.c.dispatch({action:'getBuktiPayroll',...context},worker);
  assert.equal(list.data.length,1);assert.equal(list.data[0].namaFile,'bukti.pdf');assert.equal(list.data[0].object_path,undefined);
  for(const unduh of [false,true]) {
    const result=await h.c.dispatch({action:'bukaBuktiPayroll',...context,jenis:'fee_marketing',id:saved.data.id,unduh},worker);
    const url=new URL(result.url);assert.equal(url.origin,'https://pdf.test');assert(url.pathname.includes('/storage/v1/object/sign/sla-payroll-private/'));
    assert.equal(url.searchParams.get('download'),unduh?'bukti.pdf':null);
    assert.equal(JSON.parse(h.calls.at(-1).body).expiresIn,300);
  }
  const count=h.calls.filter(c=>c.url.includes('/object/sign/')).length;
  await assert.rejects(h.c.dispatch({action:'getBuktiPayroll',...context,namaPegawai:'Worker R',usernameTarget:'worker-r'},worker),/pribadi/);
  await assert.rejects(h.c.dispatch({action:'bukaBuktiPayroll',...context,usernameTarget:'worker-r',jenis:'fee_marketing',id:saved.data.id},worker),/tidak cocok/);
  await assert.rejects(h.c.dispatch({action:'getBuktiPayroll',...context},{...worker,branch:'Raha'}),/Cabang/);
  assert.equal(h.calls.filter(c=>c.url.includes('/object/sign/')).length,count);
});
test('Employee, month and evidence kind remain isolated and persist after reload',async()=>{
  const h=harness();
  for(const patch of [{},{jenis:'kasbon'},{periode:'2026-09'},{namaPegawai:'Worker R',usernameTarget:'worker-r'}]) await h.c.dispatch(upload(patch),manager);
  assert.equal(h.records.size,4);assert.equal(h.objects.size,4);
  assert.equal((await h.c.dispatch({action:'getBuktiPayroll',...context},manager)).data.length,2);
  assert.equal((await h.c.dispatch({action:'getBuktiPayroll',...context,periode:'2026-09'},manager)).data.length,1);
  assert.equal((await h.c.dispatch({action:'getBuktiPayroll',...context,periode:'2026-08'},manager)).data.length,0);
});
test('Canonical payroll profile handles secondary zero salary accounts and rejects ambiguous usernames',async()=>{
  const h=harness();await h.c.dispatch(upload({namaPegawai:'Manager',usernameTarget:'manager'}),manager);
  await assert.rejects(h.c.dispatch(upload({namaPegawai:'Manager',usernameTarget:'manager-sales'}),manager),/tidak cocok/);
  assert.equal(h.records.size,1);
});
test('Locked months forbid mutation but still permit viewing stored PDFs',async()=>{
  const h=harness();
  await assert.rejects(h.c.dispatch(upload({periode:'2026-08'}),manager),/dikunci/);
  assert.equal(h.calls.length,0);
  assert.equal((await h.c.dispatch({action:'getBuktiPayroll',...context,periode:'2026-08'},manager)).data.length,0);
});

test('PDF upload, replacement and deletion accept day 7 and reject day 8 while viewing remains available',async()=>{
  for(const now of ['2026-10-06T00:00:00+08:00','2026-10-07T23:59:59.999+08:00']) {
    const h=harness('ok',now),first=await h.c.dispatch(upload({periode:'2026-09'}),manager);
    const next=await h.c.dispatch(upload({periode:'2026-09',idLama:first.data.id}),manager);
    assert.equal((await h.c.dispatch({action:'hapusBuktiPayroll',...context,periode:'2026-09',jenis:'fee_marketing',idLama:next.data.id},manager)).idTerhapus,next.data.id);
  }
  const h=harness('ok','2026-10-08T00:00:00+08:00');
  for(const action of ['unggahBuktiPayroll','hapusBuktiPayroll']) await assert.rejects(h.c.dispatch({...upload({periode:'2026-09'}),action,idLama:'previous-document'},manager),/masa tenggang 7 hari/);
  assert.equal(h.calls.length,0);
  assert.equal((await h.c.dispatch({action:'getBuktiPayroll',...context,periode:'2026-09'},manager)).status,'sukses');
});
test('Invalid formats, empty files, spoofed PDFs, excessive size and bad names never reach Storage',async()=>{
  const bad=[{jenis:'other'},{idLama:undefined},{namaFile:'x.jpg'},{namaFile:'../x.pdf'},{namaFile:'x'.repeat(180)+'.pdf'},
    {pdfBase64:'data:image/png;base64,YQ=='},{pdfBase64:'data:application/pdf;base64,'},
    {pdfBase64:'data:application/pdf;base64,'+Buffer.from('fake %%EOF').toString('base64')},
    {pdfBase64:'data:application/pdf;base64,'+Buffer.from('%PDF-1.7 incomplete').toString('base64')},
    {pdfBase64:'data:application/pdf;base64,'+pdf(5*1024*1024+1).toString('base64')}];
  for(const patch of bad){const h=harness();await assert.rejects(h.c.dispatch(upload(patch),manager));assert.equal(h.objects.size,0);assert(!h.calls.some(c=>c.url.includes('/storage/')));}
  const h=harness();assert.equal((await h.c.dispatch(upload({pdfBase64:'data:application/pdf;base64,'+pdf(5*1024*1024).toString('base64')}),manager)).data.ukuran,5*1024*1024);
});
test('Stale replacements and deletes preserve the latest evidence and clean rejected uploads',async()=>{
  const h=harness(),first=await h.c.dispatch(upload(),manager),second=await h.c.dispatch(upload({idLama:first.data.id}),manager);
  await assert.rejects(h.c.dispatch(upload({idLama:first.data.id}),manager),/diubah pengguna lain/);
  await assert.rejects(h.c.dispatch({action:'hapusBuktiPayroll',...context,jenis:'fee_marketing',idLama:first.data.id},manager),/diubah pengguna lain/);
  assert.equal(h.objects.size,1);assert.equal([...h.records.values()][0].id,second.data.id);
  await assert.rejects(h.c.dispatch({action:'bukaBuktiPayroll',...context,jenis:'fee_marketing',id:first.data.id},manager),/diganti/);
});
test('Failed storage or confirmed DB rejection do not leave uploaded files; uncertain commits retain PDFs',async()=>{
  for(const [mode,left] of [['storage',0],['reject',0],['uncertain',1]]){const h=harness(mode);await assert.rejects(h.c.dispatch(upload(),manager));assert.equal(h.objects.size,left);}
});
test('Unauthenticated evidence requests fail before DB or Storage access',async()=>{
  const h=harness();for(const action of ['getBuktiPayroll','bukaBuktiPayroll','unggahBuktiPayroll','hapusBuktiPayroll']) {
    const response=await h.handler(new Request('https://pdf.test/functions/v1/sla-payroll-attendance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}));
    assert.equal(response.status,401);
  }assert.equal(h.calls.length,0);
});
test('HTML script compiles and uploads never call the monthly nominal save or Apps Script',()=>{
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  const part=html.slice(html.indexOf('let konteksBuktiPayroll_'),html.indexOf('async function muatRekeningPegawai_'));
  assert(!part.includes('simpanVariabelPayroll'));assert(!part.includes('script.google.com'));
  assert(part.includes('penggunaBolehKelolaPayroll_() && penggunaBolehKelolaRekening_()'));
});
