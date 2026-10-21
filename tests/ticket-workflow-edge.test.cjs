const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {workflowFixture}=require('../maintenance/ticket-workflow-test-fixture.cjs'),{workflowEdgeHarness}=require('../maintenance/ticket-workflow-edge-harness.cjs');let f,h;
const req=(body,token='a.b.c',origin='https://aplikasisla.vercel.app')=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin},body:JSON.stringify(body)});
before(async()=>{f=await workflowFixture();h=await workflowEdgeHarness(f.db);});after(async()=>f?.db.close());
const body=async()=>({action:'pending',idTiket:'TKT-1',revision:(await f.row()).versi_workflow,requestId:crypto.randomUUID(),patch:{status:'Pending'},context:f.pending});
test('expired/anonymous identity and hostile origins cannot write',async()=>{
 for(const [token,origin] of [['','https://aplikasisla.vercel.app'],['a.b.c','https://hostile.test']]){const n=h.calls.length;assert.ok([401,403].includes((await h.handler(req(await body(),token,origin))).status));assert.equal(h.calls.length,n);}
 h.setDenied(true);assert.equal((await h.handler(req(await body()))).status,401);h.setDenied(false);
 h.setAuth({id:f.ids.admin,email:'forged@alfacom.local'});assert.equal((await h.handler(req(await body()))).status,401);h.setAuth({id:f.ids.admin,email:'admin@alfacom.local'});
});
test('auth actor wins over forged role, salary and identity, with atomic validation',async()=>{
 let b=await body();b.authId=f.ids.manager;b.role='direktur';b.salary=9999999;b.context.actor='manager';const r=await h.handler(req(b));assert.equal(r.status,200);assert.equal((await f.row()).konteks_pekerjaan.events.at(-1).actor,'admin');
 b=await body();b.patch.gaji_pokok=9999999;assert.equal((await h.handler(req(b))).status,400);assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');
 b=await body();b.context.followUpAt='2026-11-01T09:00';assert.equal((await h.handler(req(b))).status,400);
});
test('database rechecks branch/role, rejects missing facts and never dispatches WA or salary evaluation',async()=>{
 h.setAuth({id:f.ids.raha,email:'raha@alfacom.local'});assert.equal((await h.handler(req(await body()))).status,400);
 h.setAuth({id:f.ids.tech,email:'tech@alfacom.local'});const b=await body();b.action='replacement';b.patch={teknisi:'Teknisi B'};b.context=f.replacement;assert.equal((await h.handler(req(b))).status,400);
 assert.ok(h.calls.every(c=>/\/auth\/v1\/user$|\/users\?|\/rpc\/sla_tiket_workflow$/.test(c)));
});
