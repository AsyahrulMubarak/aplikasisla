
// Check the live account and original Auth session; never authorize from JWT metadata.
async function requireActiveAccountSession(token,base,key){
 const r=await fetch(base+'/rest/v1/rpc/sla_assert_account_session',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!r.ok||await r.json()!==true)throw Object.assign(new Error('Akun nonaktif atau sesi sudah dicabut. Silakan hubungi admin atau login kembali.'),{status:401,httpStatus:401});
}
// @ts-nocheck
// Atomic ticket facts + legacy field update. No salary evaluation and no WA sender here.
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const PUBLIC=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
const ORIGIN='https://aplikasisla.vercel.app';
const cors={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Cache-Control':'no-store',Vary:'Origin','X-SLA-Revision':'ticket-workflow-v1'};
const headers={apikey:SECRET,'Content-Type':'application/json',...(!String(SECRET).startsWith('sb_secret_')?{Authorization:'Bearer '+SECRET}:{})};
async function rest(path,body){const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const d=await r.json();if(!r.ok)throw Object.assign(Error(r.status===400?d.message:'Layanan tiket belum dapat menyimpan data.'),{status:r.status===400?400:503});return d;}
async function authenticate(req){const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim(),deny=()=>Object.assign(Error('Sesi tidak sah. Silakan login kembali.'),{status:401});if(token.split('.').length!==3)throw deny();const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw deny();const a=await r.json();
 await requireActiveAccountSession(token,BASE,PUBLIC);
if(!/^[0-9a-f-]{36}$/i.test(a.id||''))throw deny();const ps=await rest('users?select=username&auth_id=eq.'+encodeURIComponent(a.id)+'&limit=2');if(ps.length!==1||String(a.email||'').toLowerCase()!==ps[0].username.trim().toLowerCase().replace(/\s+/g,'')+'@alfacom.local')throw deny();return a.id;}
async function dispatch(b,id){
 if(!b||!['pending','replacement'].includes(b.action)||!/^TKT-[A-Za-z0-9-]{1,100}$/.test(b.idTiket||'')||!Number.isSafeInteger(b.revision)||b.revision<0||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId||''))throw Error('Permintaan tiket tidak valid.');
 if(!b.patch||Array.isArray(b.patch)||typeof b.patch!=='object'||!b.context||Array.isArray(b.context)||typeof b.context!=='object')throw Error('Isi formulir tidak valid.');
 const c={};for(const k of ['category','evidence','reason','handover','followUpAt'])if(b.context[k]!==undefined){if(typeof b.context[k]!=='string'||b.context[k].length>(k==='handover'?4000:2000))throw Error('Isi alasan/bukti tidak valid atau terlalu panjang.');c[k]=b.context[k];}
 if(b.context.resetSla!==undefined){if(typeof b.context.resetSla!=='boolean')throw Error('Pilihan SLA baru tidak valid.');c.resetSla=b.context.resetSla;}
 if(c.followUpAt&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(c.followUpAt))throw Error('Jadwal harus menyertakan zona waktu WITA.');
 return rest('rpc/sla_tiket_workflow',{p_auth_id:id,p_id_tiket:b.idTiket,p_action:b.action,p_revision:b.revision,p_request_id:b.requestId,p_patch:b.patch,p_context:c});
}
Deno.serve(async req=>{const reply=(d,status=200)=>Response.json(d,{status,headers:cors});if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply({status:'gagal',pesan:'Origin ditolak.'},403);if(req.method!=='POST')return reply({status:'gagal',pesan:'Gunakan POST.'},405);try{const id=await authenticate(req),text=await req.text();if(text.length>2*1024*1024)return reply({status:'gagal',pesan:'Formulir terlalu besar.'},413);let b;try{b=JSON.parse(text);}catch{throw Error('Data JSON tidak valid.');}return reply(await dispatch(b,id));}catch(e){return reply({status:'gagal',pesan:e.status===503?'Layanan tiket belum tersedia. Coba kembali.':e.message||'Tiket belum dapat diproses.'},e.status||400);}});
