const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {test}=require('node:test'),{webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..',process.env.TRACKING_SOURCE_DIR||'.');
const source=fs.readFileSync(path.join(root,'supabase/functions/sla-client-tracking/index.ts'),'utf8');
function harness(){
  const c=vm.createContext({console,URL,Request,Response,Uint8Array,TextEncoder,TextDecoder,AbortSignal,Date,crypto:webcrypto,
    createPdf:async()=>new TextEncoder().encode('%PDF-1.4\n'),fetch:async()=>{throw Error('Unexpected network call');},
    Deno:{env:{get:key=>({SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-secret',SUPABASE_ANON_KEY:'publishable'})[key]},serve(){}}});
  vm.runInContext(source.replace(/^import .*?;\r?$/mg,''),c);return c;
}
const ticket={id_tiket:'TKT-186',status:'Selesai',no_wa_klien:'081234567890',nama_customer:'Nama Pelanggan',klien_lokasi:'Nama Pelanggan - Kantor',
  teknisi:'Teknisi Satu, Teknisi Dua',cabang:'Kendari',link_pdf_ba:'storage:ba/TKT-186/11111111-1111-1111-1111-111111111111.pdf',
  jenis_pekerjaan:'Perbaikan',nilai_penjualan:800000,poin_performa:90,keterangan:'Internal',tanda_tangan:'private-signature'};
const request=body=>new Request('https://project.supabase.co/functions/v1/sla-client-tracking',{method:'POST',
  headers:{Origin:'https://aplikasisla.vercel.app','Content-Type':'application/json'},body:JSON.stringify(body)});
test('identity requires the complete stored customer name or normalized phone',()=>{
  const c=harness();
  for(const key of ['081234567890','+62 812-3456-7890',' NAMA   PELANGGAN ','Nama Pelanggan - Kantor'])assert.equal(c.identityMatches(ticket,key),true);
  for(const key of ['Nama','Pelanggan','wrong','9999','x081234567890',''])assert.equal(c.identityMatches(ticket,key),false);
});
test('public tracking returns a single verified ticket without internal data and preserves zero days',async()=>{
  const c=harness();let signs=0;
  c.rest=async table=>table.startsWith('rpc/')?true:table==='tiket'?[ticket]:[{id_garansi:'G-1',durasi_hari:0,status:'Habis (Tanpa Garansi)'}];
  c.signDocument=async()=>{signs++;return 'https://project.supabase.co/storage/v1/object/sign/example?token=test';};
  const result=await c.publicTracking({trackId:'TKT-186',trackKey:'Nama Pelanggan'},request({}));
  assert.equal(result.tickets.length,1);assert.equal(result.tickets[0].id_tiket,'TKT-186');assert.equal(result.garansi[0].durasi_hari,0);assert.equal(signs,1);
  for(const field of ['no_wa_klien','nama_customer','nilai_penjualan','poin_performa','keterangan','tanda_tangan'])assert.equal(field in result.tickets[0],false);
});
test('incorrect identity and missing ticket share a response and never sign documents',async()=>{
  const c=harness();let found=true,signs=0;
  c.rest=async table=>table.startsWith('rpc/')?true:found?[ticket]:[];
  c.signDocument=async()=>{signs++;return '';};
  const first=await c.handle(request({action:'trackTicketPublic',trackId:'TKT-186',trackKey:'Wrong Name'}));
  found=false;const second=await c.handle(request({action:'trackTicketPublic',trackId:'TKT-186',trackKey:'Wrong Name'}));
  assert.equal(first.status,400);assert.deepEqual(await first.json(),await second.json());assert.equal(signs,0);
});
test('rate limiting applies before a public ticket is read',async()=>{
  const c=harness();let reads=0;
  c.rest=async table=>{if(!table.startsWith('rpc/'))reads++;return false;};
  const response=await c.handle(request({action:'trackTicketPublic',trackId:'TKT-186',trackKey:'Wrong Name'}));
  assert.equal(response.status,429);assert.equal(reads,0);
});
test('unknown origins and unauthenticated document or migration actions are denied',async()=>{
  const c=harness();
  for(const action of ['getTicketDocument','createTicketDocument','migrateLegacyDocuments']){
    const response=await c.handle(request({action,idTiket:'TKT-186',user:{role:'direktur'}}));assert.equal(response.status,401);
  }
  const foreign=new Request('https://project.supabase.co',{method:'OPTIONS',headers:{Origin:'https://untrusted.test'}});
  assert.equal((await c.handle(foreign)).status,403);
});
test('document permissions use a trusted role, branch and assigned technician',()=>{
  const c=harness(),base={role:'admin',home:'kendari',hak_akses_cabang:'Kendari',nama_asli:'Teknisi Dua'};
  assert.equal(c.canAccessTicket(base,ticket,true),true);
  assert.equal(c.canAccessTicket({...base,role:'admin_raha',home:'raha',hak_akses_cabang:'Semua'},ticket),false);
  assert.equal(c.canAccessTicket({...base,role:'teknisi'},ticket,true),true);
  assert.equal(c.canAccessTicket({...base,role:'teknisi',nama_asli:'Teknisi'},ticket,true),false);
  assert.equal(c.canAccessTicket({...base,role:'sales'},ticket),true);
  assert.equal(c.canAccessTicket({...base,role:'sales'},ticket,true),false);
  assert.equal(c.canAccessTicket({...base,home:'raha'},ticket),false);
});
test('document signing checks its ticket association, origin and 15 minute lifetime',async()=>{
  const c=harness();let payload;
  c.rest=async()=>[{object_path:ticket.link_pdf_ba.slice(8)}];
  c.fetch=async(url,options)=>{payload=JSON.parse(options.body);return Response.json({signedURL:'/object/sign/sla-ticket-documents/ba/TKT-186/document.pdf?token=test'});};
  assert.match(await c.signDocument(ticket),/^https:\/\/project\.supabase\.co\/storage\/v1\/object\/sign\//);assert.equal(payload.expiresIn,900);
  assert.equal(await c.signDocument({...ticket,link_pdf_ba:'storage:ba/TKT-999/111.pdf'}),'');
  c.rest=async()=>[];assert.equal(await c.signDocument(ticket),'');
});
test('legacy downloads reject arbitrary hosts and unsafe redirects',async()=>{
  const c=harness();
  for(const value of ['http://drive.google.com/file/d/123456789012/view','https://evil.test/file/d/123456789012','https://drive.google.com@127.0.0.1/file/d/123456789012']){
    assert.equal(c.driveId(value),'');
  }
  c.fetch=async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});
  await assert.rejects(c.downloadLegacy('https://drive.google.com/file/d/123456789012/view'),/Pengalihan dokumen tidak diizinkan/);
  c.fetch=async()=>new Response('<html>login</html>',{status:200});
  await assert.rejects(c.downloadLegacy('https://drive.google.com/file/d/123456789012/view'),/bukan dokumen PDF/);
});
test('confirmed stale document commit cleans its unused upload without replacing the pointer',async()=>{
  const c=harness();let removed=0;
  c.putPdf=async()=>{};c.cleanup=async()=>{removed++;};
  c.rest=async table=>{if(table==='sla_ticket_documents')return [];throw Object.assign(Error('Changed'),{databaseHttpStatus:400});};
  await assert.rejects(c.createTicketDocument({...ticket,link_pdf_ba:null},{role:'manager',home:'kendari',hak_akses_cabang:'Kendari',auth_id:'actor'}),/Changed/);
  assert.equal(removed,1);assert.equal(ticket.link_pdf_ba.startsWith('storage:'),true);
});
test('a timeout after commit does not delete a document that may already be referenced',async()=>{
  const c=harness();let removed=0;
  c.putPdf=async()=>{};c.cleanup=async()=>{removed++;};
  c.rest=async table=>{if(table==='sla_ticket_documents')return [];throw Error('Timeout');};
  await assert.rejects(c.createTicketDocument({...ticket,link_pdf_ba:null},{role:'manager',home:'kendari',hak_akses_cabang:'Kendari',auth_id:'actor'}),/Timeout/);
  assert.equal(removed,0);
});

