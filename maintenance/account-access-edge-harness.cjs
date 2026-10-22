const fs=require('node:fs'),vm=require('node:vm'),{ids,sessions}=require('./account-access-test-fixture.cjs');
function accountEdgeHarness(f,{authFailure=false,session='admin'}={}){
 let handler;const calls=[],bans=new Map(),state={authFailure,session};
 const token=key=>'x.'+Buffer.from(JSON.stringify({sub:ids[key],session_id:sessions[key],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.x';
 const auth=k=>({id:ids[k],email:k.toLowerCase()+'@alfacom.local',banned_until:bans.get(k)||null});
 const context=vm.createContext({console:{error(){}},fetch:async(url,o={})=>{
  const u=new URL(url),method=o.method||'GET',body=o.body?JSON.parse(o.body):null;calls.push({path:u.pathname,method,body,authorization:o.headers?.Authorization});
  if(u.pathname==='/auth/v1/user')return Response.json(auth(state.session));
  if(u.pathname.startsWith('/auth/v1/admin/users/')){
   const key=Object.keys(ids).find(k=>ids[k]===u.pathname.split('/').pop());if(!key)return Response.json({},{status:404});
   if(method==='PUT'){if(state.authFailure)return Response.json({},{status:503});bans.set(key,body.ban_duration==='none'?null:new Date(Date.now()+86400000).toISOString());}
   return Response.json(auth(key));
  }
  if(u.pathname==='/rest/v1/rpc/sla_assert_account_session'){
   try{await f.as(state.session,'select sla_assert_account_session()');return Response.json(true)}catch{return Response.json({},{status:401})}
  }
  if(u.pathname==='/rest/v1/rpc/sla_profile_lock_active')return Response.json(true);
  if(u.pathname==='/rest/v1/users')return Response.json((await f.db.query('select * from users where username_login=$1',[u.searchParams.get('username_login')?.slice(3)])).rows);
  if(u.pathname.startsWith('/rest/v1/rpc/sla_')){
   const name=u.pathname.split('/').pop(),args=Object.values(body),keys=Object.keys(body);try{return Response.json((await f.db.query('select '+name+'('+keys.map((k,i)=>k+'=>$'+(i+1)).join(',')+') r',args)).rows[0].r)}catch(e){return Response.json({message:e.message},{status:400})}
  }
  throw Error('Unexpected '+method+' '+url);
 },Response,Request,URL,URLSearchParams,AbortSignal,Date,Intl,crypto,TextEncoder,Uint8Array,Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'service-test',SUPABASE_ANON_KEY:'public-test'})[n]},serve:h=>handler=h}});
 const cached=__dirname+'/../tmp/account-access-release/edges/sla-profile/index.ts';
 vm.runInContext(fs.readFileSync(fs.existsSync(cached)?cached:__dirname+'/../supabase/functions/sla-profile/index.ts','utf8'),context);
 const post=async body=>{const r=await handler(new Request('https://db.test/functions/v1/sla-profile',{method:'POST',headers:{Origin:'https://aplikasisla.vercel.app',Authorization:'Bearer '+token(state.session),'Content-Type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
 return {post,state,calls,bans,context,token};
}
module.exports={accountEdgeHarness};

