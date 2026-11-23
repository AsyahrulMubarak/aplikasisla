
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
// Bind each decision to its own evidence. Unrelated ticket changes keep reviews.
async function evidenceFor(source,cases){
 const entries=await Promise.all(cases.map(async c=>{
  const t=(source.tickets||[]).find(t=>t.id_tiket===c.ticket)||{};
  const evidence={key:c.key,detail:c.detail,status:t.status,completed:t.waktu_selesai,technicians:t.teknisi,
   events:(t.konteks_pekerjaan?.events||[]).filter(e=>e.kind===(c.kind==='T'?'pending':'replacement'))};
  if(c.kind==='U'){evidence.history=t.riwayat_penggantian_teknisi;evidence.episodes=(source.episodes||[]).filter(e=>e.id_tiket===c.ticket);}
  if(c.kind==='G'){evidence.warranties=(source.warranties||[]).filter(g=>g.referensi_tiket_nota===c.ticket);evidence.claims=(source.tickets||[]).filter(x=>x.referensi_tiket_asal===c.ticket||evidence.warranties.some(g=>g.id_garansi===x.garansi_asal)).map(x=>({id:x.id_tiket,status:x.status,reported:x.waktu_lapor,context:x.konteks_pekerjaan}));}
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(evidence)));
  return [c.key,Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')];
 }));return Object.fromEntries(entries);
}
async function reviewedResult(context){
 const consumed=context.credits.some(c=>c.periode===context.source.data.period&&c.sumber==='performa'&&c.kenaikan_id);
 if(consumed&&context.saved)return {result:context.saved.hasil,consumed,stale:false};
 const activeDraft=context.draft&&context.draft.based_revision===(context.saved?.revision||0)?context.draft:null;
 const saved=activeDraft||context.saved,sourceChanged=!!saved&&saved.source_hash!==context.source.hash;
 const input=saved?.input||{},base=calculate(context.source.data,{effectiveDays:input.effectiveDays,targetReason:input.targetReason});
 const evidence=await evidenceFor(context.source.data,base.cases),decisions={},changed=[];
 for(const c of base.cases){const d=input.decisions?.[c.key];if(!d)continue;
  if(!sourceChanged||input.caseEvidence?.[c.key]===evidence[c.key])decisions[c.key]=d;
  else changed.push({...c,previous:d});
 }
 const result=calculate(context.source.data,{...input,decisions});
 for(const c of result.cases){const old=changed.find(x=>x.key===c.key);if(old){c.note=old.previous.note||'';c.root=old.previous.root||c.ticket;c.evidenceChanged=true;}}
 const stale=!!context.saved&&(context.saved.source_hash!==context.source.hash||context.saved.hasil.policy?.version!==result.policy.version||context.saved.hasil.policy?.kind!==result.policy.kind);
 return {result,consumed,stale,changedCases:changed.map(c=>c.key),draftActive:!!activeDraft,caseEvidence:evidence};
}
function scoreSummary(result){
 return {policy:result.policy,achieved:result.achieved,target:result.target,score:result.score,values:result.values,
  contributions:result.contributions,quality:result.quality,gradeBreakdown:result.gradeBreakdown,points:result.points,complete:result.complete,pass:result.pass,reasons:result.reasons,counts:result.counts};
}
async function dashboardScores(body,id){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period||'')||!['Kendari','Raha'].includes(body.branch))throw Error('Pilih cabang dan bulan penilaian.');
 const access=await rest('rpc/sla_performa_akses',{p_auth_id:id});
 const users=access.users.filter(u=>u.role!=='sales'&&u.branch===body.branch),rows=[];
 for(let n=0;n<users.length;n+=4){
  rows.push(...await Promise.all(users.slice(n,n+4).map(async u=>{
   const context=await rest('rpc/sla_performa_akses',{p_auth_id:id,p_username:u.username,p_periode:body.period});
   const {result,stale,consumed}=await reviewedResult(context);
   return {...u,...scoreSummary(result),stale,consumed};
  })));
 }
 return {status:'sukses',period:body.period,branch:body.branch,rows};
}
async function lobbyProgress(id){
 const data=await rest('rpc/sla_lobby_kredit_sumber',{p_auth_id:id});
 const rows=await Promise.all(data.rows.map(async row=>{
  const programStart=row.programStart?(row.programStart>'2026-11'?row.programStart:'2026-11'):null;
  const attendanceEligible=!!programStart&&data.period>=programStart&&!row.programFinished;
  const official=data.period>='2026-11',attendancePass=row.attendance.telat_pagi<=3&&row.attendance.alpa<=2;
  let r=null;try{
   if(row.role==='sales')r=calculate(row.source.data);
   else {const context=await rest('rpc/sla_performa_akses',{p_auth_id:id,p_username:row.username,p_periode:data.period});r=(await reviewedResult(context)).result;}
  }catch{/* Never invent a result for incomplete sources. */}
  const target=Number(r?.target)||0,achieved=row.role==='sales'&&!official?0:Number(r?.achieved)||0;
  // Lobby progress gives each required sales target equal space; surplus cannot replace another target.
  const salesProgress=r?.sales?Object.fromEntries(['omzet','konversi','tindakLanjut'].map(key=>{
   const value=r.values[key];return [key,typeof value==='number'&&Number.isFinite(value)?Math.min(100,Math.max(0,value)):0];
  })):null;
  const percent=salesProgress?(official?Object.values(salesProgress).reduce((sum,value)=>sum+value,0)/3:0):r?.score??0;
  return {username:row.username,name:row.name,role:row.role,branch:row.branch,programStart,programFinished:row.programFinished,
   attendance:{late:row.attendance.telat_pagi,absent:row.attendance.alpa,lateLimit:3,absentLimit:2,startPeriod:programStart||'2026-11',eligible:attendanceEligible,potentialCredit:attendanceEligible&&attendancePass?1:0},
   achievement:{achieved,target,percent,score:r?.score??null,values:r?.values,contributions:r?.contributions,quality:r?.quality,gradeBreakdown:r?.gradeBreakdown,counts:r?.counts,policy:r?.policy,unit:row.role==='sales'?'rupiah':'skor',
    official,potentialCredit:attendanceEligible&&official&&r?.pass?1:0,qualified:official&&!!r?.pass,complete:!!r?.complete,
    sales:r?.sales?{revenue:r.sales.revenue,revenueTarget:r.sales.target?.omzet||0,conversion:r.sales.conversion,conversionTarget:r.sales.target?.konversi||0,countedFollowups:r.sales.countedFollowups,requiredFollowups:r.sales.requiredFollowups,progress:salesProgress}:null,
    reasons:r?.reasons||['Data pencapaian belum dapat dihitung.']}};
 }));
 return {status:'sukses',period:data.period,allEmployees:data.allEmployees,provisional:true,rows};
}
async function dispatch(body,id){
 if(!body||Array.isArray(body)||!['list','read','preview','save','approve','lobby','dashboard'].includes(body.action))throw Error('Tindakan tidak valid.');
 if(body.action==='lobby')return lobbyProgress(id);
 if(body.action==='dashboard')return dashboardScores(body,id);
 if(body.action==='list')return rest('rpc/sla_performa_akses',{p_auth_id:id});
 if(typeof body.username!=='string'||body.username.length>180||!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period||''))throw Error('Pilih pegawai dan periode.');
 const args={p_auth_id:id,p_username:body.username,p_periode:body.period};
 const context=await rest('rpc/sla_performa_akses',args);
 const input=body.action==='read'?(context.saved?.input||{}):{effectiveDays:body.input?.effectiveDays,targetReason:String(body.input?.targetReason||''),decisions:body.input?.decisions||{}};
 const consumed=context.credits.some(c=>c.periode===body.period&&c.sumber==='performa'&&c.kenaikan_id);
 const reviewed=body.action==='read'?await reviewedResult(context):null;
 const result=reviewed?reviewed.result:calculate(context.source.data,input);
 if(body.action==='save'){
  if(!context.canApprove||consumed)throw Error('Akses penyimpanan tinjauan ditolak.');
  if(!Number.isSafeInteger(body.draftRevision)||body.draftRevision<0)throw Error('Versi draf tidak valid.');
  if(body.hash!==context.source.hash)throw Error('Data tiket berubah. Muat ulang sebelum menyimpan tinjauan.');
  for(const d of Object.values(input.decisions)){if(!d||!['','fault','exempt'].includes(d.outcome)||String(d.note||'').length>2000||String(d.root||'').length>150)throw Error('Isian tinjauan tidak valid.');}
  input.caseEvidence=await evidenceFor(context.source.data,result.cases);
  const draft=await rest('rpc/sla_performa_simpan_draf',{...args,p_revision:body.draftRevision,p_based_revision:context.saved?.revision||0,p_hash:context.source.hash,p_input:input});
  return {status:'sukses',draft,result};
 }
 if(body.action==='approve'){
  if(!Number.isSafeInteger(body.revision)||body.revision<0)throw Error('Versi rekap tidak valid.');
  // The displayed snapshot must still match at submit, including concurrent ticket updates.
  if(body.hash!==context.source.hash)throw Error('Data tiket berubah. Muat ulang rekap sebelum mengesahkan.');
  input.caseEvidence=await evidenceFor(context.source.data,result.cases);
  await rest('rpc/sla_performa_sahkan',{...args,p_revision:body.revision,p_hash:context.source.hash,p_input:input,p_result:result});
  return dispatch({...body,action:'read'},id);
 }
 const {source,...safe}=context;
 return {...safe,canApprove:context.canApprove&&!consumed,consumed,result,profile:source.data.profile,hash:source.hash,stale:reviewed?.stale||false,draftActive:reviewed?.draftActive||false,changedCases:reviewed?.changedCases||[],caseEvidence:reviewed?.caseEvidence||await evidenceFor(source.data,result.cases)};
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Cache-Control':'no-store',Vary:'Origin','X-SLA-Revision':'attendance-credit-november'};
 const reply=(data,status=200)=>Response.json(data,{status,headers:cors});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(origin&&origin!==ORIGIN)return reply({status:'gagal',pesan:'Origin ditolak.'},403);
 if(req.method!=='POST')return reply({status:'gagal',pesan:'Gunakan POST.'},405);
 try{const id=await authenticate(req);const text=await req.text();if(text.length>64000)return reply({status:'gagal',pesan:'Data terlalu besar.'},413);let body;try{body=JSON.parse(text);}catch{throw Error('Data tidak valid.');}return reply(await dispatch(body,id));}
 catch(e){return reply({status:'gagal',pesan:e.status===503?'Rekap belum dapat dimuat. Coba kembali.':e.message||'Rekap belum dapat diproses.'},e.status||400);}
});
