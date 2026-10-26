// Full page + real HTTP handler paths against an isolated PostgreSQL fixture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=process.env.SLA_TEST_RELEASE_ROOT||root,out=path.join(root,'output/warranty-active-points');
(async()=>{
 const db=new PGlite();let browser;const errors=[],writes=[];
 try{
  fs.mkdirSync(out,{recursive:true});await db.exec('create table fixture(kind text,id text,data jsonb,primary key(kind,id))');
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1100,height:950}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,prefer','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
   if(url.hostname==='aplikasisla.vercel.app'&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(release,'index.html'),'utf8')});
   const kind=url.pathname.match(/^\/rest\/v1\/(tiket|garansi)$/)?.[1];
   if(kind){
    let rows=[];
    if(req.method()==='POST'){
     const data=req.postDataJSON(),id=data.id_garansi||data.id_tiket;writes.push({kind,method:'POST',data});
     await db.query('insert into fixture values($1,$2,$3)',[kind,id,JSON.stringify(data)]);rows=[data];
    }else if(req.method()==='PATCH'){
     const id=(url.searchParams.get(kind==='tiket'?'id_tiket':'id_garansi')||'').replace(/^eq\./,''),data=req.postDataJSON();writes.push({kind,method:'PATCH',data});
     rows=(await db.query('update fixture set data=data||$3::jsonb where kind=$1 and id=$2 returning data',[kind,id,JSON.stringify(data)])).rows.map(r=>r.data);
    }else rows=(await db.query('select data from fixture where kind=$1',[kind])).rows.map(r=>r.data);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(rows),headers:cors});
   }
   if(url.hostname==='aplikasisla.vercel.app'&&/\.(js|css|png)$/.test(url.pathname)){
    const name=url.pathname.slice(1),file=path.join(root,name);
    if(fs.existsSync(file))return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'image/png',body:fs.readFileSync(file)});
   }
   if(url.hostname.includes('fonnte'))throw Error('Real WhatsApp is disabled');
   return route.fulfill({contentType:url.pathname.endsWith('.js')?'application/javascript':'application/json',body:url.pathname.endsWith('.js')?'':'[]',headers:cors});
  });
  await page.goto('https://aplikasisla.vercel.app/',{waitUntil:'domcontentloaded'});await page.locator('#login-form').waitFor({state:'visible'});
  for(const branch of ['Kendari','Raha']){
   await db.exec('delete from fixture');const t={id_tiket:'TKT-POINTS',cabang:branch,status:'Selesai',teknisi:'Teknisi Uji',klien_lokasi:'Klien Uji',jenis_pekerjaan:'Perbaikan printer',waktu_selesai:new Date().toISOString(),bobot_poin:0,status_pembayaran:'Poin Beku'};
   await db.query("insert into fixture values('tiket','TKT-POINTS',$1)",[JSON.stringify(t)]);
   await page.evaluate(async branch=>{
    cabangAktif=branch;penggunaAktif={Username:'qa-admin','Nama Asli':'Admin Uji',Role:branch==='Raha'?'admin_raha':'admin',Hak_Akses_Cabang:branch,SessionToken:'fixture.jwt'};
    pastikanTokenSupabaseAktif_=async()=>'fixture.jwt';mulaiRealtimeSLA_=async()=>{};jadwalkanHubungUlangRealtime_=()=>{};showToast=(text,type)=>window.lastToast={text,type};
    ambilSemuaData=async()=>{globalTickets=(await callSupabase('tiket')).map(petakanTiketSupabase_);globalGaransi=(await callSupabase('garansi')).map(petakanGaransiSupabase_);renderTickets();};
    document.getElementById('login-wrapper').style.display='none';document.getElementById('main-lobby-wrapper').style.display='none';document.getElementById('app-wrapper').style.display='block';
    document.querySelectorAll('.tab-page').forEach(el=>el.style.display='none');document.getElementById('page-tiket').style.display='block';
    currentTicketFilter='riwayat';document.getElementById('filter-bulan-tiket').value='all';document.getElementById('filter-tahun-tiket').value='all';
    globalUsers=[];await ambilSemuaData();
   },branch);
   assert.equal(await page.getByRole('button',{name:'⭐ Edit Poin / Veto Admin',exact:true}).count(),0);
   await page.evaluate(()=>bukaModalPoin('TKT-POINTS'));assert.equal(await page.locator('#modal-poin').isVisible(),false);
   // Initial warranty and points follow the existing Garansi submit handler.
   await page.evaluate(async()=>{
    document.getElementById('garansi-id').value='GRS-QA';document.getElementById('garansi-referensi').innerHTML='<option value="TKT-POINTS">TKT-POINTS</option>';
    document.getElementById('garansi-notrans').value='QA/SO/1';document.getElementById('garansi-pelanggan').value='Klien Uji';document.getElementById('garansi-barang').value='Printer';
    document.getElementById('garansi-poin-nilai').value='60';document.getElementById('garansi-poin-veto').checked=false;
    document.getElementById('garansi-status').value='Masa Tunggu';document.getElementById('garansi-item-rows').innerHTML='';
    tambahBarisItemGaransi_('garansi-item-rows',{id:'printer',nama:'Printer Uji',durasi_hari:30});
    await submitGaransi({preventDefault(){}});
   });
   const saved=(await db.query("select data from fixture where kind='tiket'")).rows[0].data;
   assert.equal(saved.bobot_poin,60,JSON.stringify(await page.evaluate(()=>window.lastToast)));
   await page.getByRole('button',{name:'⭐ Edit Poin / Veto Admin',exact:true}).click();
   assert.equal(await page.locator('#poin-nilai-input').inputValue(),'60');await page.locator('#poin-nilai-input').fill('75');await page.locator('#poin-veto-input').check();
   await page.locator('#btn-submit-poin').click();await page.waitForFunction(()=>document.getElementById('modal-poin').style.display==='none');
   const changed=(await db.query("select data from fixture where kind='tiket'")).rows[0].data;assert.equal(changed.bobot_poin,75);assert.equal(changed.veto_admin,'Ya');
   await page.screenshot({path:path.join(out,'points-'+branch+'.png')});
   for(const width of [390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
   await page.setViewportSize({width:1100,height:950});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({verified:true,branches:['Kendari','Raha'],writes:writes.length,pageErrors:errors}));
 }finally{if(browser)await browser.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
