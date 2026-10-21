const {test,before,after}=require('node:test'),assert=require('node:assert/strict');const {performanceFixture}=require('../maintenance/performance-credit-test-fixture.cjs'),{edgeHarness}=require('../maintenance/performance-edge-harness.cjs');let f,h;
const req=(body,token='a.b.c',origin='https://aplikasisla.vercel.app')=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:origin},body:JSON.stringify(body)});
before(async()=>{f=await performanceFixture();await f.clock('2026-12-08T06:15:00+08:00');await f.seed();h=await edgeHarness(f.db);});after(async()=>f?.db.close());
test('anonymous, expired auth and hostile origins cannot access reports or writes',async()=>{for(const [t,o] of [['','https://aplikasisla.vercel.app'],['a.b.c','https://hostile.test']]){const before=h.calls.length;const r=await h.handler(req({action:'approve'},t,o));assert.ok([401,403].includes(r.status));assert.equal(h.calls.length,before);}h.setDenied(true);assert.equal((await h.handler(req({action:'list'}))).status,401);h.setDenied(false);});
test('server computes score and ignores forged salary, points, result, branch and eligibility',async()=>{
 const read=await (await h.handler(req({action:'read',username:'tech',period:'2026-11'}))).json();assert.equal(read.result.achieved,24);
 const r=await h.handler(req({action:'approve',username:'tech',period:'2026-11',revision:0,hash:read.hash,input:{},result:{score:100000,pass:true},role:'direktur',salary:9999999,authId:'forged',branch:'Raha'}));assert.equal(r.status,200);
 const d=await r.json();assert.equal(d.saved.hasil.score,read.result.score);assert.equal(d.saved.disahkan_oleh,'admin');assert.ok(d.saved.hasil.score<100);
 assert.ok(!('source' in d));assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');assert.ok(h.calls.every(c=>!c.includes('fonnte')));
});
test('client display hash is required and cross-branch/technician direct writes are rejected',async()=>{
 assert.equal((await h.handler(req({action:'approve',username:'tech',period:'2026-11',revision:1,hash:'wrong',input:{}}))).status,400);
 h.setAuth({id:f.ids.tech,email:'tech@alfacom.local'});const r=await h.handler(req({action:'read',username:'tech2',period:'2026-11'}));assert.equal(r.status,400);
 assert.equal((await h.handler(req({action:'approve',username:'tech',period:'2026-11',revision:1,hash:(await f.raw()).hash,input:{}}))).status,400);
});
