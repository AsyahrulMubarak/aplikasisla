const fs=require('node:fs'),vm=require('node:vm');
async function workflowEdgeHarness(db){
 let handler,auth={id:'33333333-3333-4333-8333-333333333333',email:'admin@alfacom.local'},deny=false;const calls=[];
 const context=vm.createContext({console,Response,Request,AbortSignal,Set,Number,encodeURIComponent,
 Deno:{env:{get:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-public'})[k]},serve:fn=>handler=fn},
 fetch:async(url,o={})=>{calls.push(url);
  if(url.endsWith('/auth/v1/user'))return deny?Response.json({},{status:401}):Response.json(auth);
  if(url.endsWith('/rpc/sla_assert_account_session'))return Response.json(true);
  if(url.includes('/users?'))return Response.json((await db.query('select username from users where auth_id=$1',[auth.id])).rows);
  if(!url.endsWith('/rpc/sla_tiket_workflow'))throw Error('Unexpected network '+url);
  const body=JSON.parse(o.body),keys=Object.keys(body);try{return Response.json((await db.query('select sla_tiket_workflow('+keys.map((k,n)=>k+'=> $'+(n+1)).join(',')+') r',Object.values(body).map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].r);}catch(e){return Response.json({message:e.message},{status:400});}
 }});
 vm.runInContext(fs.readFileSync(process.env.SLA_WORKFLOW_EDGE_SOURCE||__dirname+'/../supabase/functions/sla-ticket-workflow/index.ts','utf8'),context);
 return {handler,calls,setAuth:v=>auth=v,setDenied:v=>deny=v};
}
module.exports={workflowEdgeHarness};

