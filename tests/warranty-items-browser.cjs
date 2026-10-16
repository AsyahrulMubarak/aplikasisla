// Browser → actual Edge dispatch → actual PostgreSQL functions → rendered card.
// Sessions and WhatsApp delivery use local test doubles; no production data or messages.
const fs=require('node:fs'),http=require('node:http'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createWarrantyTestDatabase,admin}=require('../maintenance/warranty-items-test-fixture.cjs');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const extract=name=>{const m=html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];};
async function main(){
 const {db}=await createWarrantyTestDatabase();let browser,server,page;
 const calls=[],messages=[],errors=[];
 const actor={role:'admin',authId:admin,access:'Kendari',branch:'Kendari',name:'Admin',salary:0};
 const edge=vm.createContext({console,Response,Request,URLSearchParams,AbortSignal,Date,Intl,crypto,Number,
  Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-public',FONNTE_TOKEN:'test-wa'})[k]},serve(){}},
  fetch:async(url,opt)=>{assert.equal(url,'https://api.fonnte.com/send');messages.push(new URLSearchParams(opt.body).get('message'));return Response.json({status:true});}});
 vm.runInContext(fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8'),edge);
 edge.rest=async(table,query,method,body)=>{
  if(table==='rpc/sla_klaim_item_garansi')return (await db.query('select sla_klaim_item_garansi($1,$2,$3,$4,$5,$6) result',[body.p_auth_id,body.p_id_garansi,body.p_cabang,body.p_item_ids,body.p_request_id,body.p_keluhan])).rows[0].result;
  if(table==='rpc/sla_klaim_garansi')return (await db.query('select sla_klaim_garansi($1,$2,$3) result',[body.p_auth_id,body.p_id_garansi,body.p_cabang])).rows[0].result;
  if(table==='rpc/sla_simpan_item_garansi')return (await db.query('select sla_simpan_item_garansi($1,$2,$3,$4) result',[body.p_auth_id,body.p_id_garansi,body.p_cabang,JSON.stringify(body.p_items)])).rows[0].result;
  if(table==='rpc/sla_ambil_notif_garansi')return (await db.query('select * from sla_ambil_notif_garansi($1)',[body.p_id_garansi])).rows;
  if(table==='rpc/sla_selesai_notif_garansi')return (await db.query('select sla_selesai_notif_garansi($1,$2,$3,$4) result',[body.p_id,body.p_lease,body.p_sukses,body.p_galat])).rows[0].result;
  if(table==='sla_notif_klaim_garansi')return (await db.query('select id from sla_notif_klaim_garansi where id_garansi=$1 and terkirim_pada is null',[new URLSearchParams(query).get('id_garansi').slice(3)])).rows;
  throw Error('Unexpected Edge database request: '+table);
 };
 await db.exec("insert into tiket(id_tiket,cabang,teknisi,waktu_selesai,no_wa_klien,target_sla_jam,target_sla_respon_jam) select 'TKT-BROWSER-ORIG',cabang,teknisi,waktu_selesai,no_wa_klien,target_sla_jam,target_sla_respon_jam from tiket where id_tiket='ORIG'");
 try{
  server=http.createServer(async(req,res)=>{
   try{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET'&&url.pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<meta[^>]+Content-Security-Policy[^>]+>/i,'').replace(/@import url\([^)]*\);/g,''));}
    if(url.pathname==='/cards')return res.end(JSON.stringify((await db.query('select * from garansi order by id_garansi')).rows));
    let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):null;
    if(url.pathname==='/functions/v1/sla-payroll-attendance'){
     assert.equal(req.headers.authorization,'Bearer local-session');calls.push(body);return res.end(JSON.stringify(await edge.dispatch(body,actor)));
    }
    if(['/rest/garansi','/rest/tiket'].includes(url.pathname)){
     const table=url.pathname.split('/').at(-1),key=table==='garansi'?'id_garansi':'id_tiket';
     const columns=Object.keys(body),values=Object.values(body).map((v,i)=>columns[i]==='item_garansi'?JSON.stringify(v):v);
     assert.ok(columns.every(k=>/^[a-z_]+$/.test(k)));
     const sql=req.method==='POST'?'insert into '+table+'('+columns.join(',')+') values('+values.map((_,i)=>'$'+(i+1)).join(',')+') returning *':
      'update '+table+' set '+columns.map((k,i)=>k+'=$'+(i+1)).join(',')+' where '+key+'=$'+(values.length+1)+' returning *';
     if(req.method!=='POST')values.push(url.searchParams.get(key).slice(3));
     return res.end(JSON.stringify((await db.query(sql,values)).rows));
    }
    res.statusCode=404;res.end('{}');
   }catch(e){res.statusCode=400;res.end(JSON.stringify({status:'gagal',pesan:e.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,channel:'chrome'});page=await browser.newPage({viewport:{width:1280,height:960}});
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  await page.goto(base);
  const helpers=['amanTeks_','idAman_','urlAman_','eventHandlerAman_','fragmenHtmlAman_','tetapkanHtmlAman_','tambahkanHtmlAman_','endpointFilterSupabase_',
   'statusGaransiEfektif_','hariMengendapWita_','penitipanGaransi_','peringatanPenitipanGaransi_','petakanGaransiSupabase_',
   'itemGaransi_','statusItemGaransi_','ringkasanItemGaransi_','riwayatKlaimItemGaransi_','htmlItemGaransi_','tambahBarisItemGaransi_','hapusBarisItemGaransi_','bacaFormItemGaransi_','bolehRinciItemGaransi_','bukaRincianItemGaransi','simpanRincianItemGaransi','bukaKlaimItemGaransi','kirimKlaimItemGaransi','renderGaransi',
   'bukaFormGaransi','tutupFormGaransi','autoFillGaransi','toggleGaransiOmzet','submitGaransi','aktifkanGaransi','prosesKlaimGaransi','formatTanggalInputGaransi_','tanggalDariInputGaransi_','sinkronkanFormEditGaransi_','bukaEditGaransi','simpanEditGaransi'];
  await page.addScriptTag({content:`
   let globalGaransi=[],globalPenjualan=[],globalUsers=[],globalTickets=[{'ID Tiket':'TKT-BROWSER-ORIG',Status:'Selesai','Waktu Selesai':new Date(Date.now()-86400000).toISOString(),'Klien & Lokasi':'Pelanggan Uji','Jenis Pekerjaan':'Laptop uji','No Transaksi':'TEST/1026',Cabang:'Kendari'}];
   let cabangAktif='Kendari',draftKlaimItemGaransi_=null;const klaimGaransiSedangDiproses_=new Set(),SUPABASE_URL=location.origin,SUPABASE_ANON_KEY='local-public';
   const rolePengguna=()=> 'admin',roleAdalahAdminOperasional_=()=>true,dataSesuaiCabangAktif_=g=>g.Cabang==='Kendari',normalisasiCabang=x=>x,adminSlaSupabase_=()=> 'admin';
   const formatWaktu=x=>new Date(x).toLocaleString('id-ID'),parseSafeDate=x=>new Date(x),tanggalIsoSupabase_=(x=new Date())=>new Date(x).toISOString(),angkaRupiahSupabase_=x=>Number(x||0);
   const setAutoIDs=()=>document.getElementById('garansi-id').value='BROWSER-CARD',showToast=(message,type)=>{window.lastToast={message,type};},showConfirm=async message=>{window.lastConfirm=message;return true;},pastikanTokenSupabaseAktif_=async()=> 'local-session';
   async function callSupabase(endpoint,method,payload){const r=await fetch('/rest/'+endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw Error(data.pesan);return data;}
   function pastikanHasilMutasiSupabase_(r){if(!r.length)throw Error('Mutation failed');}
   async function ambilSemuaData(){globalGaransi=(await (await fetch('/cards')).json()).map(petakanGaransiSupabase_);renderGaransi();}
   ${helpers.map(extract).join('\n')}
   document.getElementById('login-wrapper').style.display='none';for(let el=document.getElementById('page-garansi');el&&el!==document.body;el=el.parentElement)el.style.display='block';
  `});
  await page.evaluate(()=>ambilSemuaData());await page.evaluate(()=>bukaFormGaransi());
  await page.selectOption('#garansi-referensi','TKT-BROWSER-ORIG');await page.fill('#garansi-notrans','TEST/1026');await page.fill('#garansi-barang','Laptop SN-999');
  await page.locator('#garansi-item-rows .warranty-item-name').fill('Instal ulang');
  await page.locator('#form-garansi button').filter({hasText:'+ Tambah Item'}).click();
  await page.locator('#garansi-item-rows .warranty-item-name').nth(1).fill('SSD SN-123');await page.locator('#garansi-item-rows .warranty-item-days').nth(1).fill('90');
  await page.locator('#form-garansi button').filter({hasText:'+ Tambah Item'}).click();
  await page.locator('#garansi-item-rows .warranty-item-name').nth(2).fill('Keyboard');await page.locator('#garansi-item-rows .warranty-item-days').nth(2).fill('30');
  await page.locator('#btn-submit-garansi').click();await page.waitForFunction(()=>globalGaransi.some(g=>g['ID Garansi']==='BROWSER-CARD'));
  const card=page.locator('#garansi-container .card').filter({hasText:'BROWSER-CARD'});
  assert.equal(await card.locator('.warranty-coverage-row').count(),3);
  await card.getByRole('button',{name:'Catat Pengambilan Barang'}).click();await page.waitForFunction(()=>globalGaransi.find(g=>g['ID Garansi']==='BROWSER-CARD').Status==='Aktif');
  const before=(await db.query("select * from garansi where id_garansi='BROWSER-CARD'")).rows[0];
  await card.getByRole('button',{name:'Klaim Item Garansi & Buat Tiket'}).click();
  await page.locator('#btn-klaim-item-garansi').click();assert.match((await page.evaluate(()=>window.lastToast)).message,/Pilih setidaknya/);assert.equal(calls.length,0);
  await page.locator('#klaim-item-options input').nth(0).check();await page.fill('#klaim-item-keluhan','Windows gagal masuk');await page.locator('#btn-klaim-item-garansi').click();
  await page.waitForFunction(()=>globalGaransi.find(g=>g['ID Garansi']==='BROWSER-CARD')['Riwayat Klaim Item'].length===1);
  let current=(await db.query("select * from garansi where id_garansi='BROWSER-CARD'")).rows[0];
  assert.equal(current.item_garansi[0].status,'Diklaim (Hangus)');assert.deepEqual(current.item_garansi.slice(1),before.item_garansi.slice(1));
  assert.match(await card.innerText(),/2 item aktif · 1 item diklaim/);assert.equal(calls[0].itemIds.length,1);assert.equal(messages.length,3);
  fs.mkdirSync(__dirname+'/../output/warranty-items',{recursive:true});await card.screenshot({path:__dirname+'/../output/warranty-items/partial-desktop.png'});
  await card.getByRole('button',{name:'Klaim Item Garansi & Buat Tiket'}).click();assert.equal(await page.locator('#klaim-item-options input').nth(0).isDisabled(),true);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:__dirname+'/../output/warranty-items/claim-mobile.png',animations:'disabled'});
  assert.ok(await page.locator('#modal-klaim-item-garansi .modal-content').evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
  await page.locator('#klaim-item-options input').nth(1).check();await page.locator('#klaim-item-options input').nth(2).check();await page.fill('#klaim-item-keluhan','SSD dan keyboard bermasalah');await page.locator('#btn-klaim-item-garansi').click();
  await page.waitForFunction(()=>globalGaransi.find(g=>g['ID Garansi']==='BROWSER-CARD')['Riwayat Klaim Item'].length===2);
  current=(await db.query("select * from garansi where id_garansi='BROWSER-CARD'")).rows[0];assert.equal(current.status,'Diklaim (Hangus)');assert.equal(current.tanggal_habis.getTime(),before.tanggal_habis.getTime());assert.equal(messages.length,6);
  assert.ok((await page.locator('#garansi-container').innerText()).includes('TKT-KG-LAMA'));assert.equal((await db.query("select keterangan from garansi where id_garansi='HISTORICAL'")).rows[0].keterangan,'Catatan lama');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',flow:'create 3 items → pickup → claim 1 → retain 2 exact expiries → claim remaining 2 → keep legacy history',claims:calls.length,notifications:messages.length,browserErrors:errors.length}));
 }catch(error){if(page)console.error(await page.evaluate(()=>({toast:window.lastToast,errors:Array.from(document.querySelectorAll('#form-garansi :invalid')).map(x=>({id:x.id,value:x.value,message:x.validationMessage}))})));throw error;}
 finally{if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
