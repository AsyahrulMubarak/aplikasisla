// @ts-nocheck
import {phone, norm, branchOf, ticketReminders, prospectReminders, warrantyReminders, storageReminders} from './reminders.ts';
const BASE=(Deno.env.get('SUPABASE_URL')||'').replace(/\/$/,'');
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const PUBLIC=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY');
const ORIGINS=new Set(['https://aplikasisla.vercel.app','http://localhost:3000','http://127.0.0.1:3000']);
const ROLES=['admin','admin_raha','manager','direktur','sales','teknisi','freelance'];
const ACTIONS={relayWA:ROLES,laporBug:[...ROLES,'logistik'],syncCRM:['admin','admin_raha','manager','teknisi'],broadcastCRM:['admin','admin_raha'],getBugReports:['admin','admin_raha'],getOperationsStatus:['admin','admin_raha']};
class ApiError extends Error{constructor(status,message){super(message);this.status=status;}}
function serviceHeaders(){const h={apikey:SECRET};if(!String(SECRET).startsWith('sb_secret_'))h.Authorization='Bearer '+SECRET;return h;}
async function rest(path,method='GET',body,prefer='return=representation'){
 const r=await fetch(BASE+'/rest/v1/'+path,{method,headers:{...serviceHeaders(),'Content-Type':'application/json',Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!r.ok){const d=await r.json().catch(()=>({}));console.error('operations database',path.split('?')[0],r.status,d.code||'');throw Object.assign(new ApiError(r.status===400?400:503,r.status===400&&d.message?d.message:'Penyimpanan operasional belum berhasil.'),{databaseResource:path.split('?')[0],databaseCode:d.code,upstreamStatus:r.status,databaseMessage:d.message});}
 const raw=await r.text();return raw?JSON.parse(raw):null;
}
const rpc=(name,body)=>rest('rpc/'+name,'POST',body);
async function allRows(table,query='select=*'){
 const rows=[];for(;;){const page=await rest(table+'?'+query+'&limit=500&offset='+rows.length);if(!Array.isArray(page))throw new ApiError(503,'Data operasional tidak valid.');rows.push(...page);if(page.length<500)return rows;if(rows.length>50000)throw new ApiError(503,'Data operasional melebihi batas pemrosesan.');}
}
async function actorFor(request){
 const bearer=request.headers.get('Authorization')||'';if(!/^Bearer \S+$/i.test(bearer))throw new ApiError(401,'Sesi login diperlukan.');
 const r=await fetch(BASE+'/auth/v1/user',{headers:{apikey:PUBLIC,Authorization:bearer},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new ApiError(401,'Sesi login telah berakhir.');
 const auth=await r.json();
 const active=await fetch(BASE+'/rest/v1/rpc/sla_assert_account_session',{method:'POST',headers:{apikey:PUBLIC,Authorization:bearer,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
 if(!active.ok||await active.json()!==true)throw new ApiError(401,'Akun nonaktif atau sesi sudah dicabut.');
 const rows=await rest('users?auth_id=eq.'+encodeURIComponent(auth.id)+'&select=username,nama_asli,role,cabang,hak_akses_cabang,account_active&limit=2');
 if(rows.length!==1||rows[0].account_active===false)throw new ApiError(403,'Profil login tidak tersedia.');
 const p=rows[0];return {username:p.username,name:p.nama_asli,role:norm(p.role),access:p.hak_akses_cabang||p.cabang||'Kendari',branch:p.cabang||p.hak_akses_cabang||'Kendari'};
}
function requireAction(p,a){
 if(!Object.hasOwn(ACTIONS,p.action))throw new ApiError(400,'Tindakan operasional tidak tersedia.');
 if(!ACTIONS[p.action].includes(a.role))throw new ApiError(403,'Akses tindakan operasional ditolak.');
 const b=String(p.cabang||a.branch);
 if(!['Kendari','Raha'].includes(b)||!(a.access==='Semua'||a.access===b||a.role==='sales'))throw new ApiError(403,'Cabang tidak sesuai hak akses.');
 if(a.role==='admin_raha'&&b!=='Raha')throw new ApiError(403,'Admin Raha hanya dapat mengakses Raha.');
 return b;
}
function requestId(p){const id=String(p.requestId||crypto.randomUUID());if(!/^[A-Za-z0-9_-]{8,120}$/.test(id))throw new ApiError(400,'ID permintaan tidak valid.');return id;}
async function digest(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
async function enqueue(key,b,messages,kind,actor=null,guard={},marker=null){return rpc('sla_ops_enqueue',{p_key:key,p_branch:b,p_messages:messages,p_kind:kind,p_actor:actor,p_guard:guard,p_marker:marker});}
async function jobAuthorized(request){
 const key=request.headers.get('x-sla-job-key')||'';if(!key)return false;
 if(key===SECRET||Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')).includes(key))return true;
 if(!key.startsWith('sb_secret_'))return false;
 const r=await fetch(BASE+'/rest/v1/sla_ops_control?select=id&limit=1',{headers:{apikey:key},signal:AbortSignal.timeout(10000)});return r.ok;
}
async function sendQueue(key=null,limit=5){
 const events=await rpc('sla_ops_lease',{p_key:key,p_limit:limit}),result={terkirim:0,gagal:0,dilewati:0,perluPemeriksaan:0};
 for(const e of events){
  let outcome='retry',error=null,provider=null;
  try{
   if(!await rpc('sla_ops_guard_valid',{p_guard:e.guard,p_branch:e.cabang})){outcome='obsolete';result.dilewati++;}
   else{
    const token=Deno.env.get('FONNTE_TOKEN_'+e.cabang.toUpperCase())||Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN');
    if(!token)throw new Error('Konfigurasi Fonnte belum tersedia.');
    // Once the request starts, an ambiguous response must not be retried blindly.
    outcome='uncertain';
    const r=await fetch('https://api.fonnte.com/send',{method:'POST',headers:{Authorization:token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({target:e.phone,message:e.message,delay:'2'}),signal:AbortSignal.timeout(15000)});
    const data=await r.json().catch(()=>null);
    if(r.ok&&data?.status===true){outcome='sent';provider=Array.isArray(data.id)?data.id.join(','):String(data.id||'');result.terkirim++;}
    else if(data?.status===false){outcome='retry';error='Provider menolak pengiriman.';result.gagal++;}
    else{error='Hasil provider belum pasti; periksa sebelum mengirim ulang.';result.perluPemeriksaan++;}
   }
  }catch(err){error=outcome==='uncertain'?'Koneksi provider terputus; hasil pengiriman perlu diperiksa.':'Layanan notifikasi belum siap.';if(outcome==='uncertain')result.perluPemeriksaan++;else result.gagal++;}
  await rpc('sla_ops_ack',{p_id:e.id,p_lease:e.lease,p_outcome:outcome,p_error:error,p_provider:provider});
 }
 return result;
}
async function scan(kind,dryRun=false,shared=null){
 const control=await rest('sla_ops_control?select=enabled&limit=1');
 if(!control[0]?.enabled&&!dryRun)return {status:'sukses',dilewati:true,pesan:'Pengingat menunggu pengalihan dari GAS.'};
 if(kind==='storage'&&!dryRun)await rpc('sla_perbarui_penitipan',{});
 const {tickets,users,warranties,prospects,previous}=shared||await rpc('sla_ops_snapshot',{});
 const now=new Date(),events=kind==='prospect'?prospectReminders(prospects,users,now):kind==='warranty'?warrantyReminders(warranties,tickets,now):kind==='storage'?storageReminders(warranties,tickets,previous,now):ticketReminders(tickets,users,warranties,now);
 if(dryRun){const source=kind==='prospect'?prospects:kind==='warranty'||kind==='storage'?warranties:tickets;return {status:'sukses',dryRun:true,jenis:kind,scanned:{Kendari:source.filter(r=>branchOf(r)==='Kendari').length,Raha:source.filter(r=>branchOf(r)==='Raha').length},counts:{Kendari:events.filter(e=>e.branch==='Kendari').length,Raha:events.filter(e=>e.branch==='Raha').length},penerima:events.reduce((n,e)=>n+e.messages.length,0)};}
 let queued=0,expired=0;
 for(const e of events){
  if(e.kind==='storage_expired'){await rpc('sla_ops_expire_storage',{p_id:e.guard.id,p_branch:e.branch,p_guard:e.guard});}
  else if(e.kind==='prospect_expired'){await rpc('sla_ops_expire_prospect',{p_id:e.guard.id,p_branch:e.branch,p_expected:e.guard.expected,p_key:e.key,p_messages:e.messages});expired++;}
  else{await enqueue(e.key,e.branch,e.messages,e.kind,null,e.guard,e.marker||null);queued+=e.messages.length;}
 }
 return {status:'sukses',jenis:kind,terantre:queued,prospekHangus:expired};
}
async function relay(p,a,b){
 const to=phone(p.nomorTujuan),message=String(p.pesan||'').trim();
 if(!to||!message||message.length>6000)throw new ApiError(400,'Nomor atau pesan WhatsApp tidak valid.');
 if(!await rpc('sla_ops_recipient_allowed',{p_phone:to,p_branch:b}))throw new ApiError(403,'Penerima tidak terdaftar pada cabang ini.');
 const id=requestId(p),key=`relay:${a.username}:${id}`;
 await enqueue(key,b,[{phone:to,message}],'relay',a.username);
 await sendQueue(key,1);
 const rows=await rest('sla_ops_outbox?event_key=eq.'+encodeURIComponent(key)+'&select=state');
 const state=rows[0]?.state;
 return {status:'sukses',terkirim:state==='sent',terantre:state==='pending'||state==='sending',perluPemeriksaan:state==='uncertain',requestId:id};
}
async function broadcast(p,a,b){
 if(!Array.isArray(p.klien)||p.klien.length<1||p.klien.length>50)throw new ApiError(400,'Pilih 1 sampai 50 pelanggan per batch.');
 const template=String(p.pesan||'').trim();if(!template||template.length>2000)throw new ApiError(400,'Pesan broadcast maksimal 2.000 karakter.');
 const id=requestId(p),hash=await digest(JSON.stringify({b,template,phones:p.klien.map(k=>phone(k.noWa)).sort()}));
 const batch=await rpc('sla_ops_start_broadcast',{p_request:id,p_branch:b,p_actor:a.username,p_hash:hash});
 const clients=await allRows('database_klien','select=nama_klien,no_wa,cabang&order=no_wa.asc');
 const registered=new Map(clients.filter(c=>branchOf(c)===b).map(c=>[phone(c.no_wa),c]));
 const valid=new Map(),invalid=[];
 for(const c of p.klien){const n=phone(c.noWa),stored=registered.get(n);if(!n||!stored)invalid.push({nama:String(c.nama||'Pelanggan'),noWa:n});else valid.set(n,{phone:n,message:template.replace(/\[Nama\]/g,stored.nama_klien||'Pelanggan')});}
 const key='broadcast:'+batch;
 if(valid.size)await enqueue(key,b,[...valid.values()],'broadcast',a.username);
 await sendQueue(key,2);
 const rows=await rest('sla_ops_outbox?event_key=eq.'+encodeURIComponent(key)+'&select=state'),sent=rows.filter(r=>r.state==='sent').length,pending=rows.filter(r=>['pending','sending'].includes(r.state)).length;
 return {status:valid.size?'sukses':'gagal',requestId:id,total:valid.size,terkirim:sent,tertunda:pending,gagal:invalid.length,daftarGagal:invalid,pesan:`Broadcast diterima untuk ${valid.size} pelanggan. Diterima provider: ${sent}; menunggu antrean: ${pending}; penerima tidak valid: ${invalid.length}.`};
}
function evidence(value){
 if(!value)return null;
 const m=String(value).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
 if(!m||m[2].length>7*1024*1024)throw new ApiError(400,'Bukti bug harus berupa JPEG, PNG, atau WebP maksimal 5 MB.');
 const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));if(bytes.length>5*1024*1024)throw new ApiError(400,'Bukti bug maksimal 5 MB.');
 const valid=m[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:m[1]==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
 if(!valid)throw new ApiError(400,'Isi gambar bukti tidak sesuai jenis file.');
 return {mime:m[1],bytes,ext:m[1].split('/')[1]};
}
async function bugReport(p,a,b){
 const description=String(p.deskripsi||'').trim(),id=requestId(p),file=evidence(p.buktiBug);
 if(!description||description.length>5000)throw new ApiError(400,'Deskripsi bug wajib diisi, maksimal 5.000 karakter.');
 const report=await rpc('sla_ops_create_bug',{p_request:id,p_branch:b,p_actor:a.username,p_reporter:a.name||a.username,p_description:description});
 let warning=null;
 if(file&&!report.evidence_path){
  const path=`${b}/${report.id}.${file.ext}`;
  const r=await fetch(BASE+'/storage/v1/object/sla-bug-private/'+path,{method:'POST',headers:{...serviceHeaders(),'Content-Type':file.mime,'x-upsert':'true'},body:file.bytes,signal:AbortSignal.timeout(20000)});
  if(r.ok)await rest('sla_ops_bug_reports?id=eq.'+report.id,'PATCH',{evidence_path:path});else warning='Laporan tersimpan, tetapi bukti gambar belum berhasil disimpan.';
 }
 const users=await allRows('users','select=username,nama_asli,role,no_wa,hak_akses_cabang,cabang,account_active&order=username.asc');
 const recipients=users.filter(u=>u.account_active!==false&&(u.hak_akses_cabang==='Semua'||(u.hak_akses_cabang||u.cabang)===b)&&[b==='Raha'?'admin_raha':'admin','admin'].includes(norm(u.role)));
 const unique=[...new Set(recipients.map(u=>phone(u.no_wa)).filter(Boolean))];
 const key='bug:'+report.id;
 if(unique.length)await enqueue(key,b,unique.map(n=>({phone:n,message:`🐞 *LAPORAN BUG APLIKASI*\n\nCabang: ${b}\nPelapor: ${a.name||a.username}\nID laporan: ${report.id}\n\n${description}\n\nBukti tersimpan privat di Supabase.`})),'bug_report',a.username);
 await sendQueue(key,1);
 return {status:'sukses',idLaporan:report.id,requestId:id,peringatan:warning};
}
async function reports(b){
 const rows=await rest('sla_ops_bug_reports?cabang=eq.'+b+'&select=*&order=created_at.desc&limit=50');
 for(const r of rows)if(r.evidence_path){const response=await fetch(BASE+'/storage/v1/object/sign/sla-bug-private/'+r.evidence_path,{method:'POST',headers:{...serviceHeaders(),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});const d=await response.json();if(response.ok)r.evidence_url=BASE+'/storage/v1'+d.signedURL;}
 return {status:'sukses',data:rows};
}
async function migrateBugEvidence(){
 const rows=await rest('sla_ops_bug_reports?legacy_evidence_url=not.is.null&evidence_path=is.null&select=id,cabang,legacy_evidence_url&limit=10');
 const result={status:'sukses',dipindahkan:0,gagal:0};
 for(const report of rows){
  try{
   const url=new URL(report.legacy_evidence_url);
   if(url.hostname!=='drive.google.com')throw Error('Unsupported archive source');
   const id=url.pathname.match(/\/d\/([A-Za-z0-9_-]+)/)?.[1]||url.searchParams.get('id');
   if(!/^[A-Za-z0-9_-]{10,150}$/.test(id||''))throw Error('Invalid archive identifier');
   const r=await fetch('https://drive.google.com/uc?export=download&id='+encodeURIComponent(id),{signal:AbortSignal.timeout(15000)});
   const mime=(r.headers.get('content-type')||'').split(';')[0];
   if(!r.ok||!['image/jpeg','image/png','image/webp'].includes(mime)||Number(r.headers.get('content-length')||0)>5242880)throw Error('Archive is not an image');
   const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>5242880)throw Error('Archive image too large');
   const path=`${report.cabang}/${report.id}.${mime.split('/')[1]}`;
   const upload=await fetch(BASE+'/storage/v1/object/sla-bug-private/'+path,{method:'POST',headers:{...serviceHeaders(),'Content-Type':mime,'x-upsert':'true'},body:bytes,signal:AbortSignal.timeout(20000)});
   if(!upload.ok)throw Error('Archive upload failed');
   await rest('sla_ops_bug_reports?id=eq.'+report.id,'PATCH',{evidence_path:path});result.dipindahkan++;
  }catch{result.gagal++;}
 }
 return result;
}
async function importBugEvidence(p){
 const file=evidence(p.buktiBug),id=String(p.idLaporan||'');
 if(!file||!/^[0-9a-f-]{36}$/i.test(id))throw new ApiError(400,'Data pemulihan bukti tidak valid.');
 const rows=await rest('sla_ops_bug_reports?id=eq.'+encodeURIComponent(id)+'&legacy_evidence_url=not.is.null&select=id,cabang,evidence_path&limit=1');
 if(rows.length!==1)throw new ApiError(404,'Laporan arsip tidak ditemukan.');
 if(rows[0].evidence_path)return {status:'sukses',sudahDipindahkan:true};
 const path=`${rows[0].cabang}/${id}.${file.ext}`;
 const r=await fetch(BASE+'/storage/v1/object/sla-bug-private/'+path,{method:'POST',headers:{...serviceHeaders(),'Content-Type':file.mime,'x-upsert':'true'},body:file.bytes,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new ApiError(503,'Bukti arsip belum berhasil disimpan.');
 const verify=await fetch(BASE+'/storage/v1/object/authenticated/sla-bug-private/'+path,{headers:serviceHeaders(),signal:AbortSignal.timeout(20000)});
 const bytes=new Uint8Array(await verify.arrayBuffer());
 if(!verify.ok||bytes.length!==file.bytes.length||bytes.some((b,i)=>b!==file.bytes[i]))throw new ApiError(503,'Verifikasi bukti arsip belum cocok.');
 await rest('sla_ops_bug_reports?id=eq.'+id,'PATCH',{evidence_path:path});
 return {status:'sukses',dipindahkan:1,bytes:bytes.length,diverifikasi:true};
}
Deno.serve(async request=>{
 const origin=request.headers.get('Origin')||'',headers={'Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin','X-SLA-Revision':'operations-supabase-20261022'};
 const reply=(data,status=200)=>Response.json(data,{status,headers});
 if(origin&&!ORIGINS.has(origin))return reply({status:'gagal',pesan:'Origin tidak diizinkan.'},403);
 if(origin){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,apikey,content-type';headers['Access-Control-Allow-Methods']='POST,OPTIONS';}
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return reply({status:'gagal',pesan:'Gunakan POST.'},405);
 let scheduler=false;
 try{
  const raw=await request.text();if(raw.length>8*1024*1024)throw new ApiError(413,'Permintaan terlalu besar.');
  let p;try{p=JSON.parse(raw);}catch{throw new ApiError(400,'Permintaan tidak valid.');}if(!p||typeof p!=='object'||Array.isArray(p))throw new ApiError(400,'Permintaan tidak valid.');
  if(['processQueue','scanTickets','scanProspects','scanWarranty','scanStorage','dryRunReminders','health','migrateBugEvidence','importBugEvidence'].includes(p.action)){
   if(!await jobAuthorized(request))throw new ApiError(401,'Akses scheduler ditolak.');
   scheduler=true;
   if(p.action==='importBugEvidence')return reply(await importBugEvidence(p));
   if(p.action==='migrateBugEvidence')return reply(await migrateBugEvidence());
   if(p.action==='health'){const c=await rest('sla_ops_control?select=enabled,cutover_at&limit=1');return reply({status:'sukses',control:c[0],providerConfigured:!!(Deno.env.get('FONNTE_TOKEN')||Deno.env.get('FONNTE_TOKEN_CADANGAN')),runtime:'supabase'});}
   if(p.action==='dryRunReminders'){const snapshot=await rpc('sla_ops_snapshot',{});return reply({status:'sukses',results:await Promise.all(['ticket','prospect','warranty','storage'].map(k=>scan(k,true,snapshot)))});}
   return reply(p.action==='processQueue'?{status:'sukses',...await sendQueue(null,5)}:await scan({scanTickets:'ticket',scanProspects:'prospect',scanWarranty:'warranty',scanStorage:'storage'}[p.action]));
  }
  const a=await actorFor(request),b=requireAction(p,a);
  if(p.action==='relayWA')return reply(await relay(p,a,b));
  if(p.action==='syncCRM')return reply(await rpc('sla_ops_sync_crm',{p_branch:b,p_source:String(p.sumberTransaksi||''),p_reference:String(p.referensiTransaksi||''),p_phone:String(p.noWaKlien||'')}));
  if(p.action==='broadcastCRM')return reply(await broadcast(p,a,b));
  if(p.action==='laporBug')return reply(await bugReport(p,a,b));
  if(p.action==='getBugReports')return reply(await reports(b));
  if(p.action==='getOperationsStatus'){const rows=await rest('sla_ops_outbox?cabang=eq.'+b+'&state=in.(failed,uncertain)&select=id,kind,state,last_error,created_at&order=created_at.desc&limit=50');return reply({status:'sukses',data:rows});}
  throw new ApiError(400,'Tindakan tidak tersedia.');
 }catch(e){console.error('operations request error',e.name,e.message);return reply({status:'gagal',pesan:e instanceof ApiError?e.message:'Layanan operasional belum berhasil. Silakan coba lagi.',...(scheduler?{diagnostic:{resource:e.databaseResource,code:e.databaseCode,httpStatus:e.upstreamStatus,message:e.databaseMessage||e.message}}:{})},e instanceof ApiError?e.status:503);}
});
