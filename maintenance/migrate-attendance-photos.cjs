'use strict';
// Dry-run by default. Never removes the original Google Drive files.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const BUCKET='sla-attendance-private',MAX=5*1024*1024;
function driveId(value) {
  let url;try {url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.hostname!=='drive.google.com')return null;
  const id=url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)?.[1]||url.searchParams.get('id');
  return /^[A-Za-z0-9_-]{10,200}$/.test(id||'')?id:null;
}
function imageType(bytes) {
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {mime:'image/jpeg',extension:'.jpg'};
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',extension:'.png'};
  if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return {mime:'image/webp',extension:'.webp'};
  throw Error('Drive belum memberikan foto JPEG/PNG/WebP. Periksa izin file, halaman login, atau file yang dihapus.');
}
async function boundedBytes(response) {
  if(Number(response.headers.get('content-length'))>MAX)throw Error('Foto lebih besar dari batas Storage 5 MB.');
  const chunks=[];let length=0;
  for await(const chunk of response.body) {
    length+=chunk.length;if(length>MAX)throw Error('Foto lebih besar dari batas Storage 5 MB.');
    chunks.push(Buffer.from(chunk));
  }
  if(!length)throw Error('Isi foto kosong.');
  return Buffer.concat(chunks);
}
async function migrate({base,key,apply=false,reportPath,fetcher=fetch}) {
  base=String(base||'').replace(/\/+$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)||!key||String(key).startsWith('sb_publishable_'))
    throw Error('Isi SUPABASE_URL (origin proyek) dan SUPABASE_SERVICE_ROLE_KEY yang valid melalui environment.');
  const headers={apikey:key};if(!String(key).startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
  const get=async route=>{
    const r=await fetcher(base+route,{headers,signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error('Supabase HTTP '+r.status+' pada '+route.split('?')[0]);return r.json();
  };
  const bucket=await get('/storage/v1/bucket/'+BUCKET);
  if(bucket.public!==false)throw Error('Bucket foto harus privat. Terapkan migrasi SQL terlebih dahulu.');
  const report={mode:apply?'apply':'dry-run',startedAt:new Date().toISOString(),rows:[],summary:{candidates:0,migrated:0,failed:0,changed:0,alreadyStorage:0,otherReferences:0}};
  const cached=new Map();
  async function importFile(id) {
    if(cached.has(id))return cached.get(id);
    const response=await fetcher('https://drive.usercontent.google.com/download?id='+encodeURIComponent(id)+'&export=download',{
      signal:AbortSignal.timeout(30000),redirect:'follow'});
    if(!response.ok)throw Error('Unduhan Drive HTTP '+response.status);
    if(response.url&&!/^(drive\.usercontent\.google\.com|drive\.google\.com|(?:[a-z0-9-]+\.)?googleusercontent\.com)$/.test(new URL(response.url).hostname))
      throw Error('Drive mengalihkan unduhan ke host yang tidak dikenali.');
    const bytes=await boundedBytes(response),type=imageType(bytes);
    const digest=crypto.createHash('sha256').update(bytes).digest('hex'),object='legacy/'+digest+type.extension;
    const stored=await fetcher(base+'/storage/v1/object/'+BUCKET+'/'+object,{
      method:'POST',headers:{...headers,'Content-Type':type.mime,'x-upsert':'false'},body:bytes,signal:AbortSignal.timeout(30000)});
    if(!stored.ok) {
      const error=await stored.json().catch(()=>({}));
      if(![400,409].includes(stored.status)||!/duplicate|already exists/i.test(JSON.stringify(error)))throw Error('Unggah Storage HTTP '+stored.status);
      const existing=await fetcher(base+'/storage/v1/object/authenticated/'+BUCKET+'/'+object,{headers,signal:AbortSignal.timeout(30000)});
      if(!existing.ok||crypto.createHash('sha256').update(await boundedBytes(existing)).digest('hex')!==digest)
        throw Error('Objek Storage yang sudah ada belum cocok dengan foto sumber.');
    }
    const reference='storage:'+object;cached.set(id,reference);return reference;
  }
  for(const [table,primary] of [['absensi','id_absen'],['pengajuan_cuti','id_pengajuan']]) {
    for(let offset=0;;offset+=500) {
      const rows=await get('/rest/v1/'+table+'?select='+primary+',bukti_foto&order='+primary+'.asc&limit=500&offset='+offset);
      for(const row of rows) {
        const source=String(row.bukti_foto||'').trim();
        if(source.startsWith('storage:')){report.summary.alreadyStorage++;continue;}
        if(!source||source==='-')continue;
        const id=driveId(source);
        if(!id){report.summary.otherReferences++;continue;}
        report.summary.candidates++;
        const item={table,id:row[primary],original:row.bukti_foto,status:'candidate'};
        report.rows.push(item);
        if(!apply)continue;
        try {
          item.storage=await importFile(id);
          // Compare-and-set prevents overwriting a concurrent edit of the attachment.
          const query=primary+'=eq.'+encodeURIComponent(row[primary])+'&bukti_foto=eq.'+encodeURIComponent(row.bukti_foto);
          const saved=await fetcher(base+'/rest/v1/'+table+'?'+query,{
            method:'PATCH',headers:{...headers,'Content-Type':'application/json',Prefer:'return=representation'},
            body:JSON.stringify({bukti_foto:item.storage}),signal:AbortSignal.timeout(30000)});
          if(!saved.ok)throw Error('Pembaruan referensi HTTP '+saved.status);
          const confirmed=await saved.json();
          item.status=confirmed.length===1&&confirmed[0].bukti_foto===item.storage?'migrated':'changed';
          report.summary[item.status]++;
        }catch(error){item.status='failed';item.error=error.message;report.summary.failed++;}
      }
      if(reportPath){await fs.mkdir(path.dirname(reportPath),{recursive:true});await fs.writeFile(reportPath,JSON.stringify(report,null,2));}
      if(rows.length<500)break;
    }
  }
  report.completedAt=new Date().toISOString();
  if(reportPath)await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  return report;
}
module.exports={driveId,imageType,boundedBytes,migrate};
if(require.main===module) {
  const apply=process.argv.includes('--apply');
  migrate({base:process.env.SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,apply,
    reportPath:path.resolve(__dirname,'../output/attendance-supabase/photo-migration-'+(apply?'apply':'dry-run')+'.json')})
    .then(r=>{console.log(JSON.stringify({mode:r.mode,...r.summary}));if(r.summary.failed||r.summary.changed||r.summary.otherReferences)process.exitCode=2;})
    .catch(e=>{console.error(e.message);process.exitCode=1;});
}
