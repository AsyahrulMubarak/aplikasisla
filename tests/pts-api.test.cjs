const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createPtsHandler } = require('../lib/pts-server.cjs');
const UID = '10101010-1010-4010-8010-101010101010';
const RID = '20202020-2020-4020-8020-202020202020';
const secret = 'a'.repeat(64);
const token = 'test.header.signature';
function fixture(overrides = {}) {
  const calls = [];
  const env = { PTS_ENABLED: 'true', PTS_BRIDGE_SECRET: secret, PTS_GAS_URL: 'https://script.google.com/macros/s/testOnly/exec', ...overrides.env };
  const fetch = async (url, init) => {
    calls.push({url, init});
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify(overrides.auth || { id: UID, email: 'testuser@alfacom.local' }), {status: overrides.authStatus || 200});
    if (url.includes('/rest/v1/users')) {
      if (overrides.fallback && url.includes('username_login')) return new Response(JSON.stringify({code:'42703'}), {status:400});
      return new Response(JSON.stringify(overrides.profiles || [{username:'Test User', nama_asli:'Test', role:'Manager'}]), {status:overrides.profileStatus || 200});
    }
    return new Response(JSON.stringify(overrides.gas || {success:true,protocol:'pts-v1',data:[]}), {status:overrides.gasStatus || 200});
  };
  const handler = createPtsHandler({env, fetch, now:()=>1000000, nonce:()=>RID});
  async function run(body = {action:'session',username:'Test User'}, headers = {}, method = 'POST') {
    const req = {method,body,headers:{authorization:`Bearer ${token}`,'content-type':'application/json',origin:'https://aplikasisla.vercel.app',...headers}};
    const res = {headers:{}, setHeader(k,v){this.headers[k]=v;}, end(text){this.data=JSON.parse(text);}};
    await handler(req,res); return res;
  }
  return {run,calls};
}
test('PTS API only allows POST JSON and a bearer session', async () => {
  const f=fixture();
  assert.equal((await f.run({}, {}, 'GET')).statusCode,405);
  assert.equal((await f.run({}, {'content-type':'text/plain'})).statusCode,415);
  assert.equal((await f.run({}, {authorization:''})).statusCode,401);
  assert.equal(f.calls.length,0);
});
test('foreign origins and arbitrary dispatch are denied before upstream calls', async()=>{
  const f=fixture();
  assert.equal((await f.run({action:'session'}, {origin:'https://foreign.example'})).statusCode,403);
  assert.equal((await f.run({action:'saveSessionRecord'})).statusCode,400);
  assert.equal(f.calls.length,0);
});
test('missing bridge configuration fails closed without affecting other endpoints',async()=>{
  const f=fixture({env:{PTS_ENABLED:'false'}});
  assert.equal((await f.run()).data.code,'PTS_NOT_READY'); assert.equal(f.calls.length,0);
});
test('forged frontend role cannot grant a non-management user access',async()=>{
  const f=fixture({profiles:[{username:'Test User',nama_asli:'Test',role:'Teknisi'}]});
  assert.equal((await f.run({action:'session',username:'Test User',user:{Role:'Admin'}})).statusCode,403);
  assert.equal(f.calls.length,2);
});
test('the three approved roles are accepted; admin_raha is not silently added',async()=>{
  for(const role of ['Admin','Manager','Direktur']) assert.equal((await fixture({profiles:[{username:'Test User',role}]}).run()).statusCode,200);
  assert.equal((await fixture({profiles:[{username:'Test User',role:'admin_raha'}]}).run()).statusCode,403);
});
test('identity must match verified Auth; duplicate profiles are rejected',async()=>{
  assert.equal((await fixture({profiles:[{username:'Other',role:'Admin'}]}).run()).statusCode,403);
  assert.equal((await fixture({profiles:[{username:'Test User',role:'Admin'},{username:'TestUser',role:'Admin'}]}).run()).statusCode,403);
  assert.equal((await fixture({authStatus:401}).run()).data.sessionExpired,true);
});
test('legacy profile lookup accepts only a username matching Auth identity',async()=>{
  const f=fixture({fallback:true});
  assert.equal((await f.run()).statusCode,200);
  assert.ok(f.calls[2].url.includes('username=eq.Test%20User'));
  assert.equal((await fixture({fallback:true}).run({action:'session',username:'Someone Else'})).statusCode,403);
});
test('GAS receives only authenticated minimal identity and a signed envelope',async()=>{
  const f=fixture(); const r=await f.run({action:'saveScenario',username:'Test User',requestId:RID,payload:{title:'Test'},user:{id:'attacker'},refreshToken:'should-not-leak'});
  assert.equal(r.statusCode,200);
  const outbound=JSON.parse(f.calls.at(-1).init.body);
  const body=JSON.parse(outbound.body);
  assert.equal(body.actor.id,UID); assert.equal(body.actor.role,'manager');
  assert.equal(outbound.signature,createHmac('sha256',secret).update(`${outbound.timestamp}.${outbound.nonce}.${outbound.body}`).digest('hex'));
  assert.doesNotMatch(f.calls.at(-1).init.body,/should-not-leak|test\.header\.signature|attacker/);
  assert.match(r.headers['Cache-Control'],/no-store/);
});
test('backend protocol is required and backend internals are not exposed',async()=>{
  assert.equal((await fixture({gas:{success:true}}).run()).statusCode,502);
  const r=await fixture({gas:{success:false,protocol:'pts-v1',code:'CONFIGURATION',message:'secret-private-detail'}}).run();
  assert.equal(r.statusCode,503); assert.doesNotMatch(r.data.message,/secret-private-detail/);
});
test('writes need request IDs and oversized payloads are rejected',async()=>{
  const f=fixture();
  assert.equal((await f.run({action:'saveScenario',username:'Test User',payload:{title:'Test'}})).statusCode,400);
  assert.equal((await fixture().run({action:'session',data:'x'.repeat(200000)})).statusCode,413);
});
