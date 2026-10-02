'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const root=__dirname+'/..',read=f=>fs.readFileSync(root+'/'+f,'utf8');
const edge=read('supabase/functions/sla-payroll-attendance/index.ts');
const extract=(html,name)=>{const m=html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];};
test('Both pages ignore legacy/session endpoints, authenticate Supabase and refresh only on 401',async()=>{
  for(const file of ['absen.html','slipgaji.html']) {
    const calls=[],html=read(file);let refreshed=0;
    const c=vm.createContext({console,AbortController,setTimeout,clearTimeout,Response,
      API_ABSEN_URL:'https://db.test/functions/v1/sla-payroll-attendance',API_ABSEN:'https://db.test/functions/v1/sla-payroll-attendance',
      SUPABASE_ANON_KEY:'public',cabangAktif:'Raha',
      pastikanTokenSupabaseAktif_:async force=>{if(force)refreshed++;return force?'fresh-token':'verified-token';},
      responsMenandakanSesiTidakSah_:()=>false,
      fetch:async(url,o)=>{calls.push({url,...o});return calls.length===1?Response.json({status:'gagal'},{status:401}):Response.json({status:'sukses'});}});
    if(file==='absen.html') {
      vm.runInContext(extract(html,'fetchAntiCORS'),c);
      assert.equal((await c.fetchAntiCORS('https://script.google.com/old',{action:'getTinjauanAbsen'})).status,'sukses');
    } else {
      vm.runInContext(extract(html,'mintaPayrollSupabase_')+'\n'+extract(html,'fetchJsonDenganTimeout_'),c);
      assert.equal((await c.fetchJsonDenganTimeout_('https://script.google.com/old',{action:'getPayrollData'},'Payroll',1000)).status,'sukses');
    }
    assert.equal(refreshed,1);assert.equal(calls.length,2);
    for(const call of calls){assert.equal(call.url,'https://db.test/functions/v1/sla-payroll-attendance');assert.equal(call.headers.apikey,'public');assert.match(call.headers.Authorization,/^Bearer /);assert.equal(JSON.parse(call.body).cabang,'Raha');}
    assert.doesNotMatch(html,/https:\/\/script\.google\.com/);
  }
});
function harness({provider=true,insertStatus=200,ackFails=false}={}) {
  const calls=[],acks=[],events=[];let pending=true,handler;
  const c=vm.createContext({console,Response,Request,AbortSignal,Date,Intl,crypto,URLSearchParams,Uint8Array,atob,
    setTimeout:fn=>fn(),
    Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server',SUPABASE_ANON_KEY:'public',FONNTE_TOKEN:'token'})[n]},serve:fn=>handler=fn},
    fetch:async(url,o={})=>{
      calls.push({url,...o});const body=o.body&&String(o.body).startsWith('{')?JSON.parse(o.body):{};
      if(url.includes('sla_attendance_supabase_active'))return Response.json(true);
      if(url.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/sla-attendance-private/leave/test.jpg?token=temporary'});
      if(url.includes('/storage/v1/object/'))return Response.json({Key:'uploaded'});
      if(url.includes('/pengajuan_cuti')&&o.method==='POST') {
        if(insertStatus!==200)return Response.json({message:'Rejected'},{status:insertStatus});
        events.push({id:'event',lease_id:'lease',id_pengajuan:body.id_pengajuan,penerima_username:'manager'});
        return Response.json([body]);
      }
      if(url.includes('/pengajuan_cuti'))return Response.json([{id_pengajuan:'PGJ-1',nama_pegawai:'Employee',role:'teknisi',jenis:'Izin',alasan:'Uji',status:'Menunggu',cabang:'Kendari',pengaju_auth_id:'verified-id'}]);
      if(url.includes('/users?'))return Response.json(url.includes('auth_id=')?[{no_wa:'081234567890'}]:[{username:'manager',role:'manager',hak_akses_cabang:'Semua',no_wa:'082222222222'}]);
      if(url.includes('/rpc/sla_ambil_notif_absensi'))return Response.json(events.length?[events.shift()]:[]);
      if(url.includes('/rpc/sla_selesai_notif_absensi')){acks.push(body);if(ackFails)throw Error('Ack failed');pending=!body.p_terkirim;return Response.json(true);}
      if(url.includes('/sla_notif_absensi?'))return Response.json(pending?[{id:'event'}]:[]);
      if(url.includes('/sla_gaji_program?'))return Response.json([],{status:o.headers.apikey==='sb_secret_job'?200:403});
      if(url.includes('api.fonnte.com'))return Response.json({status:provider});
      throw Error('Unexpected request '+url);
    }});
  vm.runInContext(edge,c);return {c,calls,acks,handler};
}
const actor={username:'employee',name:'Employee',role:'teknisi',branch:'Kendari',access:'Kendari',authId:'verified-id',salary:1500000};
const body={jenis:'Izin',tanggalMulai:'2026-10-02',selesai:'2026-10-02',alasan:'Uji',buktiFotoBase64:'data:image/jpeg;base64,/9j/AA=='};
test('Leave proof is private; verified actor and Storage reference are persisted before WA delivery',async()=>{
  const {c,calls,acks}=harness();const r=await c.submitLeave({...body,namaAsli:'Forged',phone:'089999999999'},actor);
  assert.equal(r.status,'sukses');assert.equal(r.notifikasiWaTerkirim,true);
  const insert=calls.find(x=>x.url.includes('/pengajuan_cuti')&&x.method==='POST'),row=JSON.parse(insert.body);
  assert.equal(row.nama_pegawai,'Employee');assert.equal(row.pengaju_auth_id,'verified-id');assert.match(row.bukti_foto,/^storage:leave\/verified-id\//);
  const wa=calls.find(x=>x.url.includes('api.fonnte.com'));assert.equal(new URLSearchParams(wa.body).get('target'),'6282222222222');assert.equal(acks[0].p_terkirim,true);
  assert.ok(calls.indexOf(insert)<calls.indexOf(wa));assert.ok(!calls.some(x=>/google|script/.test(x.url)));
  assert.match(await c.photoUrl(row.bukti_foto),/^https:\/\/db.test\/storage\/v1\/object\/sign\//);
});
test('WA provider/ack failure preserves saved leave and leaves automatic retry pending',async()=>{
  for(const opts of [{provider:false},{ackFails:true}]){
    const h=harness(opts),r=await h.c.submitLeave(body,actor);
    assert.equal(r.status,'sukses');assert.equal(r.notifikasiWaTerkirim,false);assert.equal(r.notifikasi.tertunda,true);
    assert.ok(!h.calls.some(x=>x.method==='DELETE'));
    if(!opts.ackFails)assert.equal(h.acks[0].p_terkirim,false);
  }
});
test('Confirmed database rejection cleans only the newly uploaded photo; ambiguous failures retain it',async()=>{
  for(const status of [400,503]){
    const h=harness({insertStatus:status});await assert.rejects(h.c.submitLeave(body,actor));
    assert.equal(h.calls.some(x=>x.method==='DELETE'),status===400);
    assert.ok(!h.calls.some(x=>x.url.includes('api.fonnte.com')));
  }
});
test('Scheduler rejects browser/public credentials and can drain the queue with the stored server key',async()=>{
  const h=harness();const request=key=>new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json','x-sla-job-key':key},body:JSON.stringify({action:'prosesNotifAbsensi'})});
  for(const key of ['', 'sb_publishable_bad'])assert.equal((await h.handler(request(key))).status,403);
  assert.ok(!h.calls.some(x=>x.url.includes('sla_ambil_notif_absensi')));
  assert.equal((await h.handler(request('sb_secret_job'))).status,200);
});
