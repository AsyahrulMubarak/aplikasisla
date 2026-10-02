'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const {driveId,migrate}=require('../maintenance/migrate-attendance-photos.cjs');
const original='https://drive.google.com/file/d/abc1234567890/view';
function harness({apply=false,html=false,changed=false}={}) {
  const calls=[],rows={absensi:[{id_absen:'ABS-1',bukti_foto:original},{id_absen:'ABS-2',bukti_foto:'storage:attendance/known.jpg'}],pengajuan_cuti:[{id_pengajuan:'PGJ-1',bukti_foto:original}]};
  const fetcher=async(url,o={})=>{
    calls.push({url,...o});
    if(url.includes('/bucket/'))return Response.json({public:false});
    if(url.includes('drive.usercontent'))return new Response(html?'<html>Login</html>':Buffer.from([255,216,255,0]),{headers:{'content-type':html?'text/html':'image/jpeg'}});
    if(url.includes('/storage/v1/object/'))return Response.json({Key:'stored'});
    const table=url.includes('/absensi?')?'absensi':'pengajuan_cuti';
    if(o.method==='PATCH'){const value=JSON.parse(o.body).bukti_foto;return Response.json(changed?[]:[{...rows[table][0],bukti_foto:value}]);}
    return Response.json(rows[table]);
  };
  return {calls,run:()=>migrate({base:'https://db.supabase.co',key:'sb_secret_test',apply,fetcher})};
}
test('Drive IDs are accepted only on the expected HTTPS host',()=>{
  assert.equal(driveId(original),'abc1234567890');assert.equal(driveId('https://drive.google.com/open?id=abc1234567890'),'abc1234567890');
  for(const url of ['http://drive.google.com/open?id=abc1234567890','https://evil.test/open?id=abc1234567890','https://drive.google.com/open?id=../bad'])assert.equal(driveId(url),null);
});
test('Dry run inventories both tables without downloading, uploading or modifying references',async()=>{
  const h=harness(),r=await h.run();assert.equal(r.summary.candidates,2);assert.equal(r.summary.alreadyStorage,1);
  assert.ok(h.calls.every(x=>!x.method));assert.ok(!h.calls.some(x=>x.url.includes('drive.usercontent')));
});
test('Migration deduplicates downloads and updates references only if the original value still matches',async()=>{
  const h=harness({apply:true}),r=await h.run();assert.equal(r.summary.migrated,2);
  assert.equal(h.calls.filter(x=>x.url.includes('drive.usercontent')).length,1);assert.equal(h.calls.filter(x=>x.method==='POST').length,1);
  for(const call of h.calls.filter(x=>x.method==='PATCH')){assert.ok(decodeURIComponent(call.url).includes('bukti_foto=eq.'+original));assert.match(JSON.parse(call.body).bukti_foto,/^storage:legacy\/[a-f0-9]{64}\.jpg$/);}
  assert.ok(!h.calls.some(x=>x.method==='DELETE'));
});
test('Inaccessible/non-image Drive responses and concurrent edits preserve original references',async()=>{
  const h=harness({apply:true,html:true}),r=await h.run();assert.equal(r.summary.failed,2);assert.ok(!h.calls.some(x=>x.method==='PATCH'));
  const concurrent=await harness({apply:true,changed:true}).run();assert.equal(concurrent.summary.changed,2);assert.equal(concurrent.summary.migrated,0);
});
