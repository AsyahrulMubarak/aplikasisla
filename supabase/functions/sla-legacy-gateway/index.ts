// @ts-nocheck
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const PUBLIC=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
const ORIGINS=new Set(['https://aplikasisla.vercel.app','http://localhost:3000','http://127.0.0.1:3000']);
const ROLES=['admin','admin_raha','manager','direktur','sales','teknisi','freelance'];
const ACTIONS={relayWA:ROLES,laporBug:ROLES,syncCRM:['admin','admin_raha','manager','teknisi'],broadcastCRM:['admin','admin_raha']};
class GatewayError extends Error{constructor(status,message){super(message);this.status=status;}}
function serviceHeaders(){const headers={apikey:SECRET,'Content-Type':'application/json'};if(!String(SECRET).startsWith('sb_secret_'))headers.Authorization='Bearer '+SECRET;return headers;}
async function rest(path,body){
 const response=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:serviceHeaders(),body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new GatewayError(503,'Integrasi operasional belum dapat diakses.');
 return response.json();
}
async function verifiedActor(request){
 const bearer=request.headers.get('Authorization')||'';
 if(!/^Bearer \S+$/i.test(bearer))throw new GatewayError(401,'Sesi login diperlukan.');
 const response=await fetch(BASE+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:bearer},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new GatewayError(401,'Sesi login telah berakhir.');
 const auth=await response.json();
 if(!auth.id)throw new GatewayError(401,'Sesi login tidak valid.');
 const profiles=await rest('users?auth_id=eq.'+encodeURIComponent(auth.id)+'&select=username,nama_asli,role,cabang,hak_akses_cabang&limit=2');
 if(!Array.isArray(profiles)||profiles.length!==1||!profiles[0]?.username)throw new GatewayError(403,'Profil login tidak tersedia.');
 const profile=profiles[0];
 return {username:profile.username,role:String(profile.role||'').trim().toLowerCase(),access:profile.hak_akses_cabang||profile.cabang||'Kendari',branch:profile.cabang||profile.hak_akses_cabang||'Kendari',token:bearer.slice(7)};
}
async function forwardLegacy(payload,actor){
 const action=String(payload.action||'');
 if(!Object.hasOwn(ACTIONS,action))throw new GatewayError(400,'Tindakan integrasi tidak tersedia.');
 if(!ACTIONS[action].includes(actor.role))throw new GatewayError(403,'Akses tindakan integrasi ditolak.');
 const branch=String(payload.cabang||actor.branch);
 if(!['Kendari','Raha'].includes(branch)||!(actor.access==='Semua'||actor.access===branch||actor.role==='sales'))throw new GatewayError(403,'Cabang integrasi tidak sesuai hak akses.');
 if(action==='broadcastCRM'&&(!Array.isArray(payload.klien)||payload.klien.length<1||payload.klien.length>50))throw new GatewayError(400,'Pilih maksimal 50 pelanggan per batch.');
 const config=await rest('rpc/sla_konfigurasi_gateway_lama',{});
 const url=config?.[branch];
 if(!config?.apiKey||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url||''))throw new GatewayError(503,'Konfigurasi integrasi belum tersedia.');
 const data={...payload,action,cabang:branch,apiKey:config.apiKey,user:{Username:actor.username,SessionToken:actor.token}};
 delete data.url;delete data.Authorization;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(data),redirect:'follow',signal:AbortSignal.timeout(action==='broadcastCRM'?240000:60000)});
 if(!response.ok)throw new GatewayError(502,'Integrasi operasional belum merespons.');
 const result=await response.json();
 return sanitizeResult(result);
}
function sanitizeResult(value){
 if(Array.isArray(value))return value.map(sanitizeResult);
 if(!value||typeof value!=='object')return value;
 const result={};
 for(const [key,item] of Object.entries(value)){
  if(/^(apikey|secret|authorization|sessiontoken|password)$/i.test(key))continue;
  Object.defineProperty(result,key,{value:sanitizeResult(item),enumerable:true});
 }
 return result;
}
Deno.serve(async request=>{
 const origin=request.headers.get('Origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-SLA-Revision':'legacy-gateway-20261010'};
 if(origin&&!ORIGINS.has(origin))return Response.json({status:'gagal',pesan:'Origin tidak diizinkan.'},{status:403,headers});
 if(origin){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,apikey,content-type';headers['Access-Control-Allow-Methods']='POST,OPTIONS';}
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return Response.json({status:'gagal',pesan:'Gunakan POST.'},{status:405,headers});
 try{
  const actor=await verifiedActor(request);
  const text=await request.text();
  if(text.length>10000000)throw new GatewayError(413,'Permintaan terlalu besar.');
  let payload;try{payload=JSON.parse(text);}catch{throw new GatewayError(400,'Permintaan tidak valid.');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new GatewayError(400,'Permintaan tidak valid.');
  return Response.json(await forwardLegacy(payload,actor),{headers});
 }catch(error){return Response.json({status:'gagal',pesan:error instanceof GatewayError?error.message:'Integrasi operasional belum berhasil. Silakan coba lagi.'},{status:error instanceof GatewayError?error.status:503,headers});}
});
