// @ts-nocheck
import { createPdf } from './pdf.ts';
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const SERVICE_KEYS=new Set([SECRET,...Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}'))].filter(Boolean));
const PUBLIC=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
const BUCKET='sla-ticket-documents', MAX_BYTES=10*1024*1024, LINK_SECONDS=900;
const ORIGIN='https://aplikasisla.vercel.app';
const norm=value=>String(value??'').trim().toLowerCase().replace(/\s+/g,' ');
const id=value=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(String(value||'').trim())?String(value).trim():'';
const encode=encodeURIComponent;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const publicError=()=>error('Tiket atau identitas pelanggan tidak cocok.');
const SELECT='id_tiket,waktu_lapor,waktu_selesai,klien_lokasi,nama_customer,no_wa_klien,jenis_pekerjaan,teknisi,status,link_pdf_ba,cabang,deskripsi_pekerjaan_ba,kritik_saran,tanda_tangan';
const SNAPSHOT_KEYS=['id_tiket','status','waktu_selesai','klien_lokasi','teknisi','deskripsi_pekerjaan_ba','kritik_saran','nama_customer','tanda_tangan'];
function cors(origin){return {'Access-Control-Allow-Origin':origin===ORIGIN?origin:ORIGIN,
  'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Cache-Control':'no-store','Vary':'Origin','X-SLA-Revision':'client-tracking-supabase-20261008'};}
function reply(body,origin,status=200){return Response.json(body,{status,headers:cors(origin)});}
function serviceHeaders(type){
  const h={apikey:SECRET};if(!String(SECRET).startsWith('sb_secret_'))h.Authorization='Bearer '+SECRET;
  if(type)h['Content-Type']=type;return h;
}
async function rest(table,query='',method='GET',body){
  const response=await fetch(BASE+'/rest/v1/'+table+(query?'?'+query:''),{
    method,headers:{...serviceHeaders(body===undefined?undefined:'application/json'),Prefer:'return=representation'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok){const e=error('Penyimpanan data belum berhasil.',response.status);e.databaseHttpStatus=response.status;throw e;}
  const raw=await response.text();return raw?JSON.parse(raw):[];
}
async function sha(value){
  const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(String(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function normalizePhone(value){
  let phone=String(value||'').replace(/\D/g,'');if(phone.startsWith('0'))phone='62'+phone.slice(1);return phone;
}
function identityMatches(ticket,key){
  const value=String(key||'').trim();if(!value||value.length>160)return false;
  const phone=normalizePhone(value), stored=normalizePhone(ticket.no_wa_klien);
  if(/^[+\d\s().-]+$/.test(value)&&phone.length>=8&&stored&&phone===stored)return true;
  const name=norm(value);
  return name.length>=3&&[ticket.nama_customer,ticket.klien_lokasi].some(v=>norm(v).length>=3&&norm(v)===name);
}
function effectiveWarranty(status,expiry,now=new Date()){
  const stored=String(status||'').trim(),ends=new Date(expiry);
  return stored==='Aktif'&&expiry&&!Number.isNaN(ends.getTime())&&now>ends?'Habis (Expired)':stored;
}
async function ticketById(ticketId){
  const rows=await rest('tiket','id_tiket=eq.'+encode(ticketId)+'&select='+SELECT+'&limit=2');
  return rows.length===1?rows[0]:null;
}
async function signDocument(ticket){
  const reference=String(ticket.link_pdf_ba||'');
  if(!reference.startsWith('storage:'))return '';
  const path=reference.slice(8);
  if(!path.startsWith('ba/'+ticket.id_tiket+'/')||!/^ba\/[A-Za-z0-9._-]+\/[0-9a-f-]+\.pdf$/.test(path))return '';
  const records=await rest('sla_ticket_documents','object_path=eq.'+encode(path)+'&id_tiket=eq.'+encode(ticket.id_tiket)+'&select=object_path&limit=1');
  if(records.length!==1)return '';
  const response=await fetch(BASE+'/storage/v1/object/sign/'+BUCKET+'/'+path.split('/').map(encode).join('/'),{
    method:'POST',headers:serviceHeaders('application/json'),body:JSON.stringify({expiresIn:LINK_SECONDS}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw error('Dokumen belum dapat dibuka.',503);
  const result=await response.json(),signed=result.signedURL;
  if(!signed)throw error('Dokumen belum dapat dibuka.',503);
  const url=signed.startsWith('http')?new URL(signed):new URL(BASE+'/storage/v1'+signed);
  if(url.origin!==new URL(BASE).origin)throw error('Tautan dokumen tidak valid.',503);
  url.searchParams.set('download','BA_'+ticket.id_tiket+'.pdf');return url.href;
}
async function publicTracking(body,request){
  const ticketId=id(body.trackId),key=String(body.trackKey||'').trim();
  if(!ticketId||!key||key.length>160)throw publicError();
  const ip=request.headers.get('x-real-ip')||request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const limits=await Promise.all([
    rest('rpc/sla_consume_tracking_limit','','POST',{p_key:await sha(SECRET+'|ip|'+ip),p_max:60}),
    rest('rpc/sla_consume_tracking_limit','','POST',{p_key:await sha(SECRET+'|ticket|'+ticketId),p_max:120})
  ]);
  if(limits.some(v=>v!==true))throw error('Terlalu banyak percobaan. Tunggu satu menit lalu coba lagi.',429);
  const ticket=await ticketById(ticketId);
  if(!ticket||!identityMatches(ticket,key))throw publicError();
  const warranties=await rest('garansi','referensi_tiket_nota=eq.'+encode(ticketId)+'&select=id_garansi,referensi_tiket_nota,barang_jasa,durasi_hari,status,tanggal_mulai,tanggal_habis,keterangan,waktu_siap_diambil,waktu_diambil,garansi_hangus_pada,biaya_penitipan');
  const safeTicket={};
  for(const field of ['id_tiket','waktu_lapor','waktu_selesai','klien_lokasi','jenis_pekerjaan','teknisi','status'])safeTicket[field]=ticket[field];
  safeTicket.link_pdf_ba=await signDocument(ticket);
  return {status:'sukses',tickets:[safeTicket],garansi:warranties.map(w=>({...w,status:w.garansi_hangus_pada && w.waktu_diambil ? 'Hangus (Lewat 7 Hari)' : effectiveWarranty(w.status,w.tanggal_habis)}))};
}
async function authenticate(request){
  const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(token.split('.').length!==3)throw error('Silakan login kembali.',401);
  const response=await fetch(BASE+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw error('Silakan login kembali.',401);
  const auth=await response.json();
  if(!auth.id)throw error('Silakan login kembali.',401);
  const profiles=await rest('users','auth_id=eq.'+encode(auth.id)+'&select=auth_id,username,nama_asli,role,hak_akses_cabang,cabang&limit=2');
  if(profiles.length!==1)throw error('Profil pengguna tidak tersedia.',403);
  const p=profiles[0];
  if(norm(auth.email)!==norm(p.username).replace(/\s/g,'')+'@alfacom.local')throw error('Profil pengguna tidak sesuai.',403);
  return {...p,role:norm(p.role),home:norm(['kendari','raha'].includes(norm(p.hak_akses_cabang))?p.hak_akses_cabang:(p.cabang||'Kendari'))};
}
function canAccessTicket(actor,ticket,write=false){
  if(!actor||!ticket||!['admin','admin_raha','manager','direktur','sales','teknisi'].includes(actor.role))return false;
  const branch=norm(ticket.cabang||'Kendari');
  if(actor.role==='admin_raha'&&branch!=='raha')return false;
  if(actor.hak_akses_cabang!=='Semua'&&actor.home!==branch)return false;
  if(actor.role==='sales')return !write;
  if(actor.role==='teknisi')return !!norm(actor.nama_asli)&&String(ticket.teknisi||'').split(',').some(n=>norm(n)===norm(actor.nama_asli));
  return true;
}
function snapshot(ticket){return Object.fromEntries(SNAPSHOT_KEYS.map(key=>[key,ticket[key]??null]));}
async function limitedBytes(response){
  if(!response.ok)throw error('Dokumen sumber tidak dapat diunduh.');
  if(Number(response.headers.get('content-length')||0)>MAX_BYTES)throw error('Dokumen melebihi batas 10 MB.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
    if(size>MAX_BYTES)throw error('Dokumen melebihi batas 10 MB.');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(!size||!new TextDecoder().decode(bytes.slice(0,8)).startsWith('%PDF-'))throw error('Sumber bukan dokumen PDF.');
  return bytes;
}
async function putPdf(path,bytes,checksum){
  if(bytes.length>MAX_BYTES)throw error('Dokumen melebihi batas 10 MB.');
  const endpoint=BASE+'/storage/v1/object/'+BUCKET+'/'+path.split('/').map(encode).join('/');
  const response=await fetch(endpoint,{method:'POST',headers:{...serviceHeaders('application/pdf'),'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw error('Dokumen gagal disimpan di Supabase Storage.',503);
  const stored=await limitedBytes(await fetch(BASE+'/storage/v1/object/authenticated/'+BUCKET+'/'+path.split('/').map(encode).join('/'),{headers:serviceHeaders(),signal:AbortSignal.timeout(25000)}));
  if(await sha(stored)!==checksum)throw error('Checksum dokumen tidak cocok.',503);
}
async function cleanup(path){
  try{await fetch(BASE+'/storage/v1/object/'+BUCKET,{method:'DELETE',headers:serviceHeaders('application/json'),
    body:JSON.stringify({prefixes:[path]}),signal:AbortSignal.timeout(10000)});}catch{console.error('Pembersihan dokumen tertunda.');}
}
async function createTicketDocument(ticket,actor){
  if(!canAccessTicket(actor,ticket,true))throw error('Anda tidak berhak membuat BA tiket ini.',403);
  const expected=snapshot(ticket),version=await sha(JSON.stringify(expected));
  if(String(ticket.link_pdf_ba||'').startsWith('storage:')){
    const found=await rest('sla_ticket_documents','object_path=eq.'+encode(ticket.link_pdf_ba.slice(8))+'&id_tiket=eq.'+encode(ticket.id_tiket)+'&source_version=eq.'+version+'&select=object_path&limit=1');
    if(found.length===1)return {status:'sukses',reference:ticket.link_pdf_ba,url:await signDocument(ticket)};
  }
  const bytes=await createPdf(ticket),checksum=await sha(bytes),path='ba/'+ticket.id_tiket+'/'+crypto.randomUUID()+'.pdf';
  await putPdf(path,bytes,checksum);
  try{
    const saved=await rest('rpc/sla_commit_ticket_document','','POST',{
      p_ticket:ticket.id_tiket,p_old_url:ticket.link_pdf_ba??null,p_expected:expected,p_path:path,p_sha:checksum,p_size:bytes.length,
      p_actor:actor.auth_id,p_original:null,p_version:version});
    return {status:'sukses',reference:saved.reference,url:await signDocument({...ticket,link_pdf_ba:saved.reference})};
  }catch(e){
    if([400,401,403,404,409,422].includes(e.databaseHttpStatus))await cleanup(path);
    throw e;
  }
}
function driveId(value){
  let url;try{url=new URL(value);}catch{return '';}
  if(url.protocol!=='https:'||url.hostname!=='drive.google.com')return '';
  const valueId=url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/)?.[1]||url.searchParams.get('id')||'';
  return /^[A-Za-z0-9_-]{10,200}$/.test(valueId)?valueId:'';
}
async function downloadLegacy(value){
  const fileId=driveId(value);if(!fileId)throw error('Tautan Drive lama tidak valid.');
  let url='https://drive.google.com/uc?export=download&id='+encode(fileId);
  for(let step=0;step<6;step++){
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||!(parsed.hostname==='drive.google.com'||parsed.hostname==='drive.usercontent.google.com'||parsed.hostname.endsWith('.googleusercontent.com')))
      throw error('Pengalihan dokumen tidak diizinkan.');
    const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(25000)});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');if(!location)throw error('Pengalihan dokumen tidak valid.');
      url=new URL(location,url).href;continue;
    }
    return limitedBytes(response);
  }
  throw error('Terlalu banyak pengalihan dokumen.');
}
async function migrateOne(ticket){
  const old=await rest('sla_migrasi_dokumen_tiket','id_tiket=eq.'+encode(ticket.id_tiket)+'&select=attempts,original_url&limit=1');
  const log={id_tiket:ticket.id_tiket,original_url:ticket.link_pdf_ba,status:'pending',attempts:old[0]?.original_url===ticket.link_pdf_ba?old[0].attempts+1:1,error:null,updated_at:new Date().toISOString()};
  await rest('sla_migrasi_dokumen_tiket',old.length?'id_tiket=eq.'+encode(ticket.id_tiket):'',old.length?'PATCH':'POST',log);
  try{
    const bytes=await downloadLegacy(ticket.link_pdf_ba),checksum=await sha(bytes),path='ba/'+ticket.id_tiket+'/'+crypto.randomUUID()+'.pdf';
    await putPdf(path,bytes,checksum);
    try{await rest('rpc/sla_commit_ticket_document','','POST',{
      p_ticket:ticket.id_tiket,p_old_url:ticket.link_pdf_ba,p_expected:null,p_path:path,p_sha:checksum,p_size:bytes.length,
      p_actor:null,p_original:ticket.link_pdf_ba,p_version:null});
    }catch(e){if([400,401,403,404,409,422].includes(e.databaseHttpStatus))await cleanup(path);throw e;}
    log.status='imported';log.object_path=path;
  }catch(e){log.status='failed';log.error=String(e.message||'Migrasi gagal').slice(0,240);}
  log.updated_at=new Date().toISOString();
  await rest('sla_migrasi_dokumen_tiket','id_tiket=eq.'+encode(ticket.id_tiket),'PATCH',log);
  return {id:ticket.id_tiket,status:log.status};
}
async function migrateLegacyDocuments(){
  const all=await rest('tiket','select=id_tiket,link_pdf_ba&link_pdf_ba=like.*drive.google.com*&order=id_tiket.asc&limit=500');
  const logs=await rest('sla_migrasi_dokumen_tiket','select=id_tiket,attempts,original_url,status&status=eq.failed');
  const excluded=new Set(logs.filter(x=>x.attempts>=3&&all.some(t=>t.id_tiket===x.id_tiket&&t.link_pdf_ba===x.original_url)).map(x=>x.id_tiket));
  const candidates=all.filter(t=>!excluded.has(t.id_tiket)).slice(0,4);
  const results=await Promise.all(candidates.map(migrateOne));
  return {status:'sukses',remainingBefore:all.length,needsAttention:excluded.size,results};
}
async function handle(request){
  const origin=request.headers.get('origin')||'';
  if(origin&&origin!==ORIGIN)return reply({status:'gagal',pesan:'Origin tidak diizinkan.'},origin,403);
  if(request.method==='OPTIONS')return new Response('ok',{headers:cors(origin)});
  if(request.method!=='POST')return reply({status:'gagal',pesan:'Gunakan POST.'},origin,405);
  try{
    const raw=await request.text();if(raw.length>20000)throw error('Permintaan terlalu besar.',413);
    const body=JSON.parse(raw);
    if(body.action==='trackTicketPublic')return reply(await publicTracking(body,request),origin);
    if(body.action==='migrateLegacyDocuments'){
      const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
      if(!SERVICE_KEYS.has(request.headers.get('apikey'))&&!SERVICE_KEYS.has(token))throw error('Akses migrasi ditolak.',401);
      return reply(await migrateLegacyDocuments(),origin);
    }
    if(!['getTicketDocument','createTicketDocument'].includes(body.action))throw error('Aksi tidak tersedia.',400);
    const actor=await authenticate(request),ticketId=id(body.idTiket),ticket=ticketId?await ticketById(ticketId):null;
    if(!canAccessTicket(actor,ticket,body.action==='createTicketDocument'))throw error('Dokumen tiket tidak tersedia untuk akun ini.',403);
    if(body.action==='createTicketDocument')return reply(await createTicketDocument(ticket,actor),origin);
    const url=await signDocument(ticket);if(!url)throw error('Dokumen BA belum tersedia.',404);
    return reply({status:'sukses',url},origin);
  }catch(e){
    const status=e.status||500;
    return reply({status:'gagal',pesan:status>=500?'Layanan pelacakan belum tersedia. Silakan coba kembali.':e.message},origin,status);
  }
}
Deno.serve(handle);

