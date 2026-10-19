const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../supabase/functions/sla-profile/index.ts', 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actor = { username:'admin', nama_asli:'Admin', role:'admin', hak_akses_cabang:'Semua', auth_id:id };
const target = { username:'worker', username_login:'worker', nama_asli:'Worker', role:'teknisi', hak_akses_cabang:'Kendari', auth_id:targetId, gaji_pokok:1750000, target_sales_rp:0 };
const profile = { ...target, email:'worker@example.test', no_wa:'081234567890' };
function harness({users=[{...target}], insertFailure=false, committedTimeout=false, authMismatch=false, provider='missing', session=target}={}) {
  const calls=[], auth=[], events=[], sends=[], logs=[]; let handler;
  const c = vm.createContext({ console:{error:(...args)=>logs.push(args.join(' '))}, Response, Request, URLSearchParams, URL, AbortSignal, Date, Intl, crypto, TextEncoder, Uint8Array,
    Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-only',SUPABASE_ANON_KEY:'public-test',
      FONNTE_TOKEN:!['missing','backup'].includes(provider)?'test-provider':undefined,FONNTE_TOKEN_CADANGAN:provider==='backup'?'test-backup':undefined})[n]},serve:f=>handler=f},
    fetch:async (url,options={})=>{
      if(url==='https://api.fonnte.com/send'){
        const body=Object.fromEntries(options.body);
        sends.push({body,headers:options.headers,profileStored:users.some(p=>body.message.includes('Username: '+p.username_login)),auditRecorded:events.some(e=>e.action==='buatProfil')});
        if(provider==='network')throw Error('Provider failure containing '+body.message);
        if(provider==='malformed')return new Response('not-json');
        return Response.json({status:provider!=='rejected'},{status:provider==='http'?503:200});
      }
      const u=new URL(url), body=options.body?JSON.parse(options.body):null, method=options.method||'GET';
      calls.push({url,method,body});
      if(u.pathname==='/auth/v1/user')return Response.json({id:session.auth_id,email:session.username.toLowerCase().replace(/\s+/g,'')+'@alfacom.local',user_metadata:{role:'admin'}});
      if(u.pathname==='/auth/v1/admin/users'&&method==='POST'){const a={id:targetId,email:body.email};auth.push(a);return Response.json(a);}
      if(u.pathname==='/auth/v1/admin/users/'+targetId){
        if(method==='DELETE'){auth.splice(0);return Response.json({});}
        if(method==='GET')return Response.json({id:targetId,email:authMismatch?'other@alfacom.local':'worker@alfacom.local'});
        return Response.json({id:targetId});
      }
      if(u.pathname==='/rest/v1/users'){
        let rows=users.filter(p=>!u.searchParams.has('username_login')||p.username_login===u.searchParams.get('username_login').slice(3));
        rows=rows.filter(p=>!u.searchParams.has('username')||p.username===u.searchParams.get('username').slice(3));
        if(method==='POST'){
          if(!insertFailure||committedTimeout)users.push({...body,username_login:body.username.toLowerCase().replace(/\s+/g,'')});
          if(insertFailure)throw Error('Simulated insert failure');return Response.json([users.at(-1)]);
        }
        if(method==='PATCH'){rows.forEach(p=>Object.assign(p,body));return Response.json(rows);}
        if(method==='DELETE'){users.splice(users.indexOf(rows[0]),1);return Response.json(rows);}
        return Response.json(rows);
      }
      if(u.pathname==='/rest/v1/rpc/sla_profile_lock_active')return Response.json(true);
      if(u.pathname==='/rest/v1/rpc/sla_complete_password_reset')return Response.json(1);
      if(u.pathname==='/rest/v1/rpc/sla_request_password_reset')return Response.json(null);
      if(u.pathname==='/rest/v1/sla_profile_audit'){events.push(body);return Response.json([body]);}
      throw Error('Unexpected request '+url);
    }
  }); vm.runInContext(source,c); return {c,calls,auth,events,sends,logs,users,handler};
}
test('Self edits ignore forged role, salary, name, branch and Auth ID',async()=>{
  const h=harness();await h.c.manageProfile({action:'ubahProfil',profil:{...profile,role:'direktur',gaji_pokok:9999999,auth_id:id,hak_akses_cabang:'Semua'}},target);
  const patch=h.calls.find(x=>x.method==='PATCH');assert.deepEqual(patch.body,{email:profile.email,no_wa:profile.no_wa});
  assert.equal(h.users[0].role,'teknisi');assert.equal(h.users[0].gaji_pokok,1750000);
});
test('Admin profile updates preserve concurrent salary and reject stale values',async()=>{
  const h=harness();await assert.rejects(h.c.manageProfile({action:'ubahProfil',profil:{...profile,gaji_pokok:1500000}},actor),/Gaji pokok sudah berbeda/);
  await h.c.manageProfile({action:'ubahProfil',profil:profile},actor);
  assert.equal('gaji_pokok' in h.calls.find(x=>x.method==='PATCH').body,false);
});
test('Admin Raha cannot create/delete/edit other profiles or reset Kendari passwords',async()=>{
  const raha={...actor,role:'admin_raha',hak_akses_cabang:'Raha'};
  for(const action of ['buatProfil','ubahProfil','hapusProfil']){
    const h=harness({users:action==='buatProfil'?[]:[{...target}]});
    await assert.rejects(h.c.manageProfile({action,profil:profile,passwordBaru:'TestOnly123!'},raha));
    assert.ok(!h.calls.some(x=>['POST','PATCH','DELETE'].includes(x.method)));
  }
  const h=harness();await assert.rejects(h.c.changePassword({targetUsername:'worker',passwordBaru:'TestOnly123!'},raha),/tidak berhak/);
  assert.ok(!h.calls.some(x=>x.method==='PUT'));
});
test('Kendari-only admin cannot create or manage Raha or central accounts',async()=>{
  for(const branch of ['Raha','Semua']){
    const h=harness({users:[{...target,hak_akses_cabang:branch}]});
    await assert.rejects(h.c.manageProfile({action:'ubahProfil',profil:{...profile,hak_akses_cabang:branch}}, {...actor,hak_akses_cabang:'Kendari'}));
  }
});
test('Auth mismatch prevents password mutation and request completion',async()=>{
  const h=harness({authMismatch:true});await assert.rejects(h.c.changePassword({targetUsername:'worker',passwordBaru:'TestOnly123!'},actor),/Identitas Auth target/);
  assert.ok(!h.calls.some(x=>x.method==='PUT'||x.url.includes('sla_complete_password_reset')));
});
test('Reset targets stored Auth ID, completes pending requests and never records password',async()=>{
  const h=harness(),result=await h.c.changePassword({targetUsername:'worker',passwordBaru:'TestOnly123!',auth_id:id,role:'direktur'},actor);
  assert.equal(result.resetSandiTerselesaikan,true);
  assert.equal(h.calls.find(x=>x.method==='PUT').url,'https://db.test/auth/v1/admin/users/'+targetId);
  assert.deepEqual(h.events,[{actor_auth_id:id,target_username:'worker',action:'resetPassword'}]);
});
test('New account creation binds the server Auth ID and rolls back a failed insert',async()=>{
  for(const fail of [false,true]){
    const h=harness({users:[],insertFailure:fail});
    const task=h.c.manageProfile({action:'buatProfil',profil:{...profile,auth_id:id},passwordBaru:'TestOnly123!'},actor);
    if(fail){await assert.rejects(task);assert.equal(h.auth.length,0);assert.equal(h.users.length,0);}
    else{const r=await task;assert.equal(r.data[0].auth_id,targetId);assert.equal(h.users.length,1);}
  }
});
test('Insert timeout after a committed profile never deletes the successful Auth account',async()=>{
  const h=harness({users:[],insertFailure:true,committedTimeout:true});
  const r=await h.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:'TestOnly123!'},actor);
  assert.equal(r.status,'sukses');assert.equal(h.auth.length,1);assert.ok(!h.calls.some(x=>x.method==='DELETE'));
});
test('Normalized duplicate usernames and invalid roles cannot create Auth accounts',async()=>{
  for(const profil of [{...profile,username:' W o r k e r '},{...profile,username:'new',role:'owner'}]){
    const h=harness();await assert.rejects(h.c.manageProfile({action:'buatProfil',profil,passwordBaru:'TestOnly123!'},actor));
    assert.ok(!h.calls.some(x=>x.url.includes('/admin/users')));
  }
});
test('Forged metadata does not grant admin and stored Auth mismatch rejects session',async()=>{
  const h=harness();const verified=await h.c.authenticate(new Request('https://edge.test',{headers:{Authorization:'Bearer a.b.c'}}));
  assert.equal(verified.role,'teknisi');await assert.rejects(h.c.dispatch({action:'getPermintaanResetSandi',role:'admin'},verified));
  h.users[0].auth_id=id;await assert.rejects(h.c.authenticate(new Request('https://edge.test',{headers:{Authorization:'Bearer a.b.c'}})),/Profil tidak cocok/);
});
test('Public reset stays neutral, private actions require Auth and invalid origins are blocked',async()=>{
  const h=harness();for(const username of ['unknown','worker','']){
    const r=await h.handler(new Request('https://edge.test',{method:'POST',body:JSON.stringify({action:'lupaSandi',username})}));
    const body=await r.json();assert.equal(body.status,'sukses');assert.equal(body.resetSandiVersion,'supabase-v1');assert.equal('idPermintaan' in body,false);
  }
  const denied=await h.handler(new Request('https://edge.test',{method:'POST',body:JSON.stringify({action:'hapusProfil',usernameTarget:'worker',role:'admin'})}));
  assert.equal(denied.status,401);
  const origin=await h.handler(new Request('https://edge.test',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}));assert.equal(origin.status,403);
  const job=await h.handler(new Request('https://edge.test',{method:'POST',body:JSON.stringify({action:'prosesNotifResetSandi'})}));assert.equal(job.status,403);
  const authorized=await h.handler(new Request('https://edge.test',{method:'POST',headers:{'x-sla-job-key':'server-only'},body:JSON.stringify({action:'prosesNotifResetSandi'})}));
  assert.equal(authorized.status,200);assert.equal((await authorized.json()).status,'sukses');
});
test('Frontend uses Supabase for profile mutations, account operations and session restoration',()=>{
  const html=fs.readFileSync(__dirname+'/../index.html','utf8');
  assert.doesNotMatch(html,/callSupabase\(endpointFilterSupabase_\('users'|callSupabase\('users', 'POST'/);
  assert.match(html,/const hasilValidasi = await kirimProfilSupabase_\('validateSession'\)/);
  assert.doesNotMatch(html,/kirimKeBackend_\(API_AUTH_URL, '(?:manageSupabaseAuthUser|reconcileSupabaseAuthProfiles|lupaSandi)'/);
  assert.match(html,/kirimProfilSupabase_\('resetPassword'/);
  assert.match(html,/kirimProfilSupabase_\('hapusProfil'/);
  assert.doesNotMatch(html,/getElementById\('new-bonus'\)/);
});

test('New Kendari and Raha profiles receive one Arabic welcome with their exact login credentials after saving',async()=>{
  for(const branch of ['Kendari','Raha']){
    const h=harness({users:[],provider:'ok'}),password='Welcome-Only<>&"123!';
    const result=await h.c.manageProfile({action:'buatProfil',profil:{...profile,username:'W o r k e r',hak_akses_cabang:branch},passwordBaru:password},actor);
    assert.equal(result.status,'sukses');assert.equal(result.notifikasiSelamatDatang.terkirim,true);
    assert.equal(h.sends.length,1);const sent=h.sends[0];
    assert.equal(sent.profileStored,true);assert.equal(sent.auditRecorded,true);
    assert.equal(sent.body.target,'6281234567890');assert.equal(sent.body.countryCode,'0');
    assert.equal(sent.headers.Authorization,'test-provider');
    for(const text of ['السلام عليكم','أهلًا وسهلًا','نسأل الله','آمين',profile.nama_asli,'Username: worker','Password: '+password,'Cabang: '+branch,'https://aplikasisla.vercel.app/','ganti password'])assert.ok(sent.body.message.includes(text),text);
    assert.ok(!JSON.stringify(result).includes(password));assert.ok(!JSON.stringify(h.events).includes(password));
    assert.ok(!JSON.stringify(h.calls.filter(call=>call.url.includes('/rest/'))).includes(password));
    assert.ok(!h.logs.some(log=>log.includes(password)));
    await assert.rejects(h.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:password},actor),/Username sudah digunakan/);
    assert.equal(h.sends.length,1,'Retry cannot resend the password for an existing account');
  }
});

test('Authenticated create request reaches saved Auth/profile and the employee welcome through the real handler',async()=>{
  const h=harness({users:[{...actor,username_login:'admin'}],provider:'ok',session:actor});
  const response=await h.handler(new Request('https://edge.test',{method:'POST',headers:{Origin:'https://aplikasisla.vercel.app',Authorization:'Bearer a.b.c'},
    body:JSON.stringify({action:'buatProfil',profil:profile,passwordBaru:'HandlerWelcome123!'})}));
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.status,'sukses');assert.equal(result.notifikasiSelamatDatang.terkirim,true);
  assert.equal(h.sends.length,1);assert.equal(h.sends[0].profileStored,true);assert.equal(h.sends[0].auditRecorded,true);
  assert.equal(result.data[0].auth_id,targetId);assert.equal(h.users.length,2);
  assert.equal(response.headers.get('X-SLA-Revision'),'profile-welcome-20261019');
  assert.ok(!JSON.stringify(result).includes('HandlerWelcome123!'));
});

test('Welcome delivery failures preserve the saved account, report uncertainty, and never expose provider errors',async()=>{
  for(const provider of ['rejected','http','network','malformed','missing']){
    const h=harness({users:[],provider}),password='WelcomeFailure123!';
    const result=await h.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:password},actor);
    assert.equal(result.status,'sukses');assert.equal(result.passwordDiubah,true);
    assert.equal(result.notifikasiSelamatDatang.terkirim,false);
    assert.match(result.notifikasiSelamatDatang.pesan,/Profil tersimpan.*belum terkonfirmasi/);
    assert.equal(h.users.length,1);assert.equal(h.auth.length,1);
    assert.equal(h.sends.length,provider==='missing'?0:1);
    assert.ok(!h.calls.some(call=>call.method==='DELETE'));
    assert.ok(!JSON.stringify(result).includes(password));assert.ok(!JSON.stringify(h.logs).includes(password));
    assert.ok(!h.calls.some(call=>call.url.includes('notifications')),'Password is never queued');
  }
});

test('Only a single valid employee WhatsApp number is accepted before creating an account',async()=>{
  for(const phone of ['', 'not-a-number','6281234567890,6289876543210','6281234567890|Admin','123@g.us']){
    const h=harness({users:[],provider:'ok'});
    await assert.rejects(h.c.manageProfile({action:'buatProfil',profil:{...profile,no_wa:phone},passwordBaru:'TestOnly123!'},actor),/nomor WhatsApp/);
    assert.equal(h.auth.length,0);assert.equal(h.users.length,0);assert.equal(h.sends.length,0);
  }
  for(const phone of ['0812-3456-7890','+62 812 3456 7890','81234567890','6281234567890']){
    const h=harness({users:[],provider:'ok'});
    await h.c.manageProfile({action:'buatProfil',profil:{...profile,no_wa:phone},passwordBaru:'TestOnly123!'},actor);
    assert.equal(h.sends[0].body.target,'6281234567890');assert.equal(h.users[0].no_wa,'6281234567890');
  }
});

test('Welcome waits for a confirmed profile, including recovery of an insert timeout after commit',async()=>{
  const failed=harness({users:[],provider:'ok',insertFailure:true});
  await assert.rejects(failed.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:'TestOnly123!'},actor));
  assert.equal(failed.sends.length,0);assert.equal(failed.auth.length,0);
  const recovered=harness({users:[],provider:'ok',insertFailure:true,committedTimeout:true});
  const result=await recovered.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:'TestOnly123!'},actor);
  assert.equal(result.notifikasiSelamatDatang.terkirim,true);assert.equal(recovered.sends.length,1);
});

test('Welcome uses the configured backup provider and never runs for edits, password resets, or forbidden creation',async()=>{
  const backup=harness({users:[],provider:'backup'});
  await backup.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:'TestOnly123!'},actor);
  assert.equal(backup.sends[0].headers.Authorization,'test-backup');
  const existing=harness({provider:'ok'});
  await existing.c.manageProfile({action:'ubahProfil',profil:profile},actor);
  await existing.c.changePassword({targetUsername:'worker',passwordBaru:'TestOnly123!'},actor);
  assert.equal(existing.sends.length,0);
  const denied=harness({users:[],provider:'ok'});
  await assert.rejects(denied.c.manageProfile({action:'buatProfil',profil:profile,passwordBaru:'TestOnly123!'},target));
  assert.equal(denied.sends.length,0);assert.equal(denied.auth.length,0);
});
