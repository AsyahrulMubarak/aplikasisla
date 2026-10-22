
// Check the live account and original Auth session; never authorize from JWT metadata.
async function requireActiveAccountSession(token,base,key){
 const r=await fetch(base+'/rest/v1/rpc/sla_assert_account_session',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!r.ok||await r.json()!==true)throw Object.assign(new Error('Akun nonaktif atau sesi sudah dicabut. Silakan hubungi admin atau login kembali.'),{status:401,httpStatus:401});
}
// @ts-nocheck
// Grade and optional team allocation only. This endpoint never sends WA or updates salary.
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const PUBLIC=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
const ORIGINS=new Set(['https://aplikasisla.vercel.app','https://aplikasisla-git-codex-supabase-ce8793-asyahrulmubaraks-projects.vercel.app']);
const ACTIONS=new Set(['read','proposeGrade','approveGrade','rejectGrade','proposeAllocation','approveAllocation','rejectAllocation','postAchievement']);
function cors(origin){return {'Access-Control-Allow-Origin':ORIGINS.has(origin)?origin:'https://aplikasisla.vercel.app','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Cache-Control':'no-store',Vary:'Origin','X-SLA-Revision':'ticket-assessment-v1'};}
function reply(value,origin,status=200){return Response.json(value,{status,headers:cors(origin)});}
function headers(){const h={apikey:SECRET,'Content-Type':'application/json'};if(!String(SECRET).startsWith('sb_secret_'))h.Authorization='Bearer '+SECRET;return h;}
async function rest(path,body){
  const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:headers(),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Object.assign(new Error(r.status===400&&typeof data?.message==='string'?data.message:'Layanan penilaian belum dapat menyimpan data.'),{httpStatus:r.status===400?400:503});
  return data;
}
async function authenticate(request){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  const denied=()=>Object.assign(new Error('Sesi Anda tidak sah atau telah kedaluwarsa.'),{httpStatus:401});
  if(token.split('.').length!==3)throw denied();
  const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw denied();
  const auth=await r.json();
 await requireActiveAccountSession(token,BASE,PUBLIC);
if(!/^[0-9a-f-]{36}$/i.test(String(auth.id||'')))throw denied();
  const profiles=await rest('users?select=username,auth_id&auth_id=eq.'+encodeURIComponent(auth.id)+'&limit=2');
  if(!Array.isArray(profiles)||profiles.length!==1||String(auth.email||'').toLowerCase()!==String(profiles[0].username||'').trim().toLowerCase().replace(/\s+/g,'')+'@alfacom.local')throw denied();
  return auth.id;
}
async function dispatch(body,authId){
  if(!body||Array.isArray(body)||!ACTIONS.has(body.action)||!/^TKT-[A-Za-z0-9-]{1,100}$/.test(String(body.idTiket||'')))throw Object.assign(new Error('Tindakan atau ID tiket tidak valid.'),{httpStatus:400});
  const revision=body.revision??0;if(!Number.isSafeInteger(revision)||revision<0)throw Object.assign(new Error('Versi penilaian tidak valid.'),{httpStatus:400});
  const input=body.data||{};if(Array.isArray(input)||typeof input!=='object')throw Object.assign(new Error('Data penilaian tidak valid.'),{httpStatus:400});
  const data={};
  for(const key of ['grade','reason','mode'])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>2000)throw Object.assign(new Error('Isi penilaian terlalu panjang atau tidak valid.'),{httpStatus:400});data[key]=input[key];}
  if(input.teamConfirmed!==undefined)data.teamConfirmed=input.teamConfirmed===true;
  if(input.members!==undefined){
    if(!Array.isArray(input.members)||input.members.length<1||input.members.length>32)throw Object.assign(new Error('Daftar pelaksana tidak valid.'),{httpStatus:400});
    data.members=input.members.map(m=>{if(!m||typeof m.username!=='string'||m.username.length>180||m.share!==undefined&&(typeof m.share!=='number'||!Number.isFinite(m.share)))throw Object.assign(new Error('Pelaksana/persentase tidak valid.'),{httpStatus:400});return {username:m.username,...(m.share===undefined?{}:{share:m.share})};});
  }
  return rest('rpc/sla_penilaian_tiket',{p_auth_id:authId,p_id_tiket:body.idTiket,p_action:body.action,p_revision:revision,p_data:data});
}
Deno.serve(async request=>{
  const origin=request.headers.get('origin')||'';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
  if(request.method!=='POST')return reply({status:'gagal',pesan:'Gunakan POST.'},origin,405);
  try{
    const authId=await authenticate(request);
    const text=await request.text();if(text.length>64000)return reply({status:'gagal',pesan:'Data terlalu besar.'},origin,413);
    let body;try{body=JSON.parse(text);}catch{return reply({status:'gagal',pesan:'Data JSON tidak valid.'},origin,400);}
    return reply(await dispatch(body,authId),origin);
  }catch(e){return reply({status:'gagal',pesan:e.httpStatus?e.message:'Penilaian belum dapat diproses. Muat ulang dan coba lagi.'},origin,e.httpStatus||503);}
});
