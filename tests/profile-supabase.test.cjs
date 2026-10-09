const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../supabase/functions/sla-profile/index.ts', 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const actor = { username:'admin', nama_asli:'Admin', role:'admin', hak_akses_cabang:'Semua', auth_id:id };
const target = { username:'worker', username_login:'worker', nama_asli:'Worker', role:'teknisi', hak_akses_cabang:'Kendari', auth_id:targetId, gaji_pokok:1750000, target_sales_rp:0 };
const profile = { ...target, email:'worker@example.test', no_wa:'081234567890' };
function harness({users=[{...target}], insertFailure=false, committedTimeout=false, authMismatch=false}={}) {
  const calls=[], auth=[], events=[]; let handler;
  const c = vm.createContext({ console:{error(){}}, Response, Request, URLSearchParams, URL, AbortSignal, Date, Intl, crypto, TextEncoder, Uint8Array,
    Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server-only',SUPABASE_ANON_KEY:'public-test'})[n]},serve:f=>handler=f},
    fetch:async (url,options={})=>{
      const u=new URL(url), body=options.body?JSON.parse(options.body):null, method=options.method||'GET';
      calls.push({url,method,body});
      if(u.pathname==='/auth/v1/user')return Response.json({id:targetId,email:'worker@alfacom.local',user_metadata:{role:'admin'}});
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
  }); vm.runInContext(source,c); return {c,calls,auth,events,users,handler};
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
