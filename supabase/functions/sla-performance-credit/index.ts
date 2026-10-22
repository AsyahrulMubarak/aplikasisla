
// Check the live account and original Auth session; never authorize from JWT metadata.
async function requireActiveAccountSession(token,base,key){
 const r=await fetch(base+'/rest/v1/rpc/sla_assert_account_session',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!r.ok||await r.json()!==true)throw Object.assign(new Error('Akun nonaktif atau sesi sudah dicabut. Silakan hubungi admin atau login kembali.'),{status:401,httpStatus:401});
}
// @ts-nocheck
import {calculate} from './engine.mjs';
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const PUBLIC=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
const ORIGIN='https://aplikasisla.vercel.app';
const headers={apikey:SECRET,'Content-Type':'application/json',...(!String(SECRET).startsWith('sb_secret_')?{Authorization:'Bearer '+SECRET}:{})};
async function rest(path,body){const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(r.status===400?d.message:'Layanan rekap belum tersedia.'),{status:r.status===400?400:503});return d;}
async function authenticate(req){
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();const deny=()=>Object.assign(Error('Silakan login kembali.'),{status:401});
 if(token.split('.').length!==3)throw deny();
 const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw deny();
 const a=await r.json();
 await requireActiveAccountSession(token,BASE,PUBLIC);
if(!/^[0-9a-f-]{36}$/i.test(String(a.id||'')))throw deny();
 const profiles=await rest('users?select=username&auth_id=eq.'+encodeURIComponent(a.id)+'&limit=2');
 if(profiles.length!==1||String(a.email||'').toLowerCase()!==profiles[0].username.trim().toLowerCase().replace(/\s+/g,'')+'@alfacom.local')throw deny();return a.id;
}
async function lobbyProgress(id){
 const data=await rest('rpc/sla_lobby_kredit_sumber',{p_auth_id:id});
 const rows=data.rows.map(row=>{
  const attendanceEligible=!!row.programStart&&data.period>=row.programStart&&!row.programFinished;
  const official=data.period>='2026-11',attendancePass=row.attendance.telat_pagi<=3&&row.attendance.alpa<=2;
  let r=null;try{r=calculate(row.source.data);}catch{/* Never invent a result for incomplete sources. */}
  const target=Number(r?.target)||0,achieved=official?Number(r?.achieved)||0:0;
  return {username:row.username,name:row.name,role:row.role,branch:row.branch,programStart:row.programStart,programFinished:row.programFinished,
   attendance:{late:row.attendance.telat_pagi,absent:row.attendance.alpa,lateLimit:3,absentLimit:2,eligible:attendanceEligible,potentialCredit:attendanceEligible&&attendancePass?1:0},
   achievement:{achieved,target,percent:target>0?Math.min(100,Math.max(0,achieved/target*100)):0,unit:row.role==='sales'?'rupiah':'poin',
    official,potentialCredit:attendanceEligible&&official&&r?.pass?1:0,qualified:official&&!!r?.pass,complete:!!r?.complete,
    sales:r?.sales?{conversion:r.sales.conversion,conversionTarget:r.sales.target?.konversi,countedFollowups:r.sales.countedFollowups,requiredFollowups:r.sales.requiredFollowups}:null,
    reasons:r?.reasons||['Data pencapaian belum dapat dihitung.']}};
 });
 return {status:'sukses',period:data.period,allEmployees:data.allEmployees,provisional:true,rows};
}
async function dispatch(body,id){
 if(!body||Array.isArray(body)||!['list','read','preview','approve','lobby'].includes(body.action))throw Error('Tindakan tidak valid.');
 if(body.action==='lobby')return lobbyProgress(id);
 if(body.action==='list')return rest('rpc/sla_performa_akses',{p_auth_id:id});
 if(typeof body.username!=='string'||body.username.length>180||!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period||''))throw Error('Pilih pegawai dan periode.');
 const args={p_auth_id:id,p_username:body.username,p_periode:body.period};
 const context=await rest('rpc/sla_performa_akses',args);
 const input=body.action==='read'?(context.saved?.input||{}):{effectiveDays:body.input?.effectiveDays,targetReason:String(body.input?.targetReason||''),decisions:body.input?.decisions||{}};
 const consumed=context.credits.some(c=>c.periode===body.period&&c.sumber==='performa'&&c.kenaikan_id);
 const result=body.action==='read'&&consumed&&context.saved?context.saved.hasil:calculate(context.source.data,input);
 if(body.action==='approve'){
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('Versi rekap tidak valid.');
  // The displayed snapshot must still match at submit, including concurrent ticket updates.
  if(body.hash!==context.source.hash)throw Error('Data tiket berubah. Muat ulang rekap sebelum mengesahkan.');
  await rest('rpc/sla_performa_sahkan',{...args,p_revision:body.revision,p_hash:context.source.hash,p_input:input,p_result:result});
  return dispatch({...body,action:'read'},id);
 }
 const {source,...safe}=context;
 return {...safe,canApprove:context.canApprove&&!consumed,consumed,result,profile:source.data.profile,hash:source.hash,stale:!consumed&&!!context.saved&&context.saved.source_hash!==source.hash};
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Cache-Control':'no-store',Vary:'Origin','X-SLA-Revision':'performance-credit-v1'};
 const reply=(data,status=200)=>Response.json(data,{status,headers:cors});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(origin&&origin!==ORIGIN)return reply({status:'gagal',pesan:'Origin ditolak.'},403);
 if(req.method!=='POST')return reply({status:'gagal',pesan:'Gunakan POST.'},405);
 try{const id=await authenticate(req);const text=await req.text();if(text.length>64000)return reply({status:'gagal',pesan:'Data terlalu besar.'},413);let body;try{body=JSON.parse(text);}catch{throw Error('Data tidak valid.');}return reply(await dispatch(body,id));}
 catch(e){return reply({status:'gagal',pesan:e.status===503?'Rekap belum dapat dimuat. Coba kembali.':e.message||'Rekap belum dapat diproses.'},e.status||400);}
});
