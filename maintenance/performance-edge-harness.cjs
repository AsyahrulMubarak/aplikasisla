const fs=require('node:fs'),vm=require('node:vm');
async function edgeHarness(db){
 const {calculate}=await import('../supabase/functions/sla-performance-credit/engine.mjs');
 let handler,auth={id:'33333333-3333-4333-8333-333333333333',email:'admin@alfacom.local'},deny=false;const calls=[];
 const context=vm.createContext({console,Response,Request,AbortSignal,Set,Number,encodeURIComponent,calculate,
 Deno:{env:{get:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-public'})[k]},serve:fn=>handler=fn},
 fetch:async(url,o={})=>{
  calls.push(url);if(url.endsWith('/auth/v1/user'))return deny?Response.json({}, {status:401}):Response.json(auth);
  if(url.endsWith('/rpc/sla_assert_account_session'))return Response.json(true);
  if(url.includes('/users?'))return Response.json((await db.query('select username from users where auth_id=$1',[auth.id])).rows);
  const name=url.split('/rpc/')[1],body=JSON.parse(o.body||'{}');
  if(!/^(sla_performa_(akses|sahkan)|sla_lobby_kredit_sumber)$/.test(name||''))throw Error('Unexpected / disallowed network request '+url);
  const keys=Object.keys(body);try{return Response.json((await db.query('select '+name+'('+keys.map((k,n)=>k+'=> $'+(n+1)).join(',')+') r',Object.values(body).map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].r);}catch(e){return Response.json({message:e.message},{status:400});}
 }});
 vm.runInContext(fs.readFileSync(process.env.SLA_PERFORMANCE_EDGE_SOURCE||__dirname+'/../supabase/functions/sla-performance-credit/index.ts','utf8').replace("import {calculate} from './engine.mjs';",''),context);
 return {handler,calls,context,setAuth:v=>auth=v,setDenied:v=>deny=v};
}
module.exports={edgeHarness};
