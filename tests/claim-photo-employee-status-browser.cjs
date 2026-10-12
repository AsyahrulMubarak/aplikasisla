const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'tmp/employee-status-qa');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const checks=[],calls=[];
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname==='aplikasisla.vercel.app'&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(root,'index.html'),'utf8')});
   if(url.pathname==='/status-pegawai.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'status-pegawai.js'),'utf8')});
   if(url.pathname==='/depan_001.png')return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join(root,'depan_001.png'))});
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(url.pathname.endsWith('/functions/v1/sla-payroll-attendance')) {
    const body=req.postDataJSON();calls.push(body);const result={status:'sukses',cabang:body.cabang||'Kendari'};
    if(body.action==='getStatusKehadiranCabang')result.data=[{nama:'Pegawai Contoh',status:'Izin',mulai:'2026-10-12',selesai:'2026-10-13'}];
    if(body.action==='getTeknisiOnProgress')result.data=[{nama:'Teknisi Contoh',tiket:['TKT-EXAMPLE','TKT-EXAMPLE-2']}];
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result),headers});
   }
   return route.fulfill({contentType:'application/json',body:'[]',headers});
  });
  await page.goto('https://aplikasisla.vercel.app/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{pastikanTokenSupabaseAktif_=async()=>'fixture-token';ambilSemuaData=async()=>{};showToast=()=>{};});
  for(const [role,cabang] of [['sales','Kendari'],['teknisi','Raha'],['admin','Kendari'],['admin_raha','Raha'],['manager','Kendari'],['direktur','Raha']]) {
   calls.length=0;
   await page.evaluate(({role,cabang})=>{
    penggunaAktif={Username:'fixture','Nama Asli':'Pegawai Uji',Role:role,Cabang:cabang,Hak_Akses_Cabang:['manager','direktur'].includes(role)?'Semua':cabang,SessionToken:'fixture-token','Gaji Pokok':0};
    document.getElementById('login-wrapper').style.display='none';
    tampilkanLobbyUtama();
    const select=document.getElementById('lobby-cabang');select.value=cabang;
    return muatStatusPegawaiLobby_(cabang);
   },{role,cabang});
   await page.waitForFunction(()=>document.getElementById('lobby-kehadiran-content').textContent.includes('Pegawai Contoh'));
   assert.match(await page.locator('#lobby-kehadiran-content').innerText(),new RegExp(cabang));
   const management=['admin','admin_raha','manager','direktur'].includes(role);
   assert.equal(await page.locator('#lobby-pekerjaan-panel').isVisible(),management);
   if(management)assert.match(await page.locator('#lobby-pekerjaan-content').innerText(),/Teknisi Contoh[\s\S]*2 tiket/);
   checks.push(role+' sees branch leave status; active work panel follows management access');
  }
  await page.screenshot({path:path.join(out,'lobby-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#lobby-pekerjaan-panel').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'lobby-mobile.png'),fullPage:true});
  assert.equal(await page.locator('#lobby-pekerjaan-content').isVisible(),true);
  await page.locator('#lobby-menu-title').scrollIntoViewIfNeeded();
  checks.push('mobile employee panels and menu remain reachable by scrolling');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  checks.push('mobile lobby has no horizontal overflow');
  await page.evaluate(()=>{
   document.getElementById('main-lobby-wrapper').style.display='none';
   penggunaAktif={Username:'sales-fixture',Role:'sales',Hak_Akses_Cabang:'Kendari'};cabangAktif='Kendari';
   bukaModalBanding('TKT-EXAMPLE');
  });
  const sources=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=80;canvas.height=160;
   const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,80,160);ctx.fillStyle='#118877';ctx.fillRect(12,12,56,136);
   return ['image/png','image/jpeg','image/webp'].map(type=>({type,data:canvas.toDataURL(type,0.8)}));
  });
  for(const [i,source] of sources.entries()) {
   calls.length=0;
   await page.locator('#banding-bukti').setInputFiles({name:'bukti.'+['png','jpg','webp'][i],mimeType:source.type,buffer:Buffer.from(source.data.split(',')[1],'base64')});
   await page.waitForFunction(()=>document.querySelector('#banding-preview img')?.naturalWidth===80);
   assert.equal(await page.locator('#banding-preview img').getAttribute('src'),source.data);
   if(i===0)await page.screenshot({path:path.join(out,'claim-preview-mobile.png'),fullPage:true});
   await page.locator('#btn-submit-banding').click();
   await page.waitForFunction(()=>document.getElementById('modal-banding').style.display==='none');
   const submitted=calls.find(c=>c.action==='ajukanBanding');assert.ok(submitted);assert.equal(submitted.buktiBanding,source.data);
   checks.push(source.type+' preview and submitted evidence preserve exact original bytes');
   await page.evaluate(()=>bukaModalBanding('TKT-EXAMPLE'));
  }
  await page.evaluate(()=>{
   let error='';try{validasiUkuranBuktiKlaim_([{size:3000000}]);}catch(e){error=e.message;}if(!error)throw Error('Oversized file accepted');
  });checks.push('oversized originals fail before submission');
  const rejected=await page.evaluate(async()=>{try{await prosesUploadBuktiKlaim_(new File(['invalid'], 'bad.png',{type:'image/png'}));return false;}catch{return true;}});
  assert.equal(rejected,true);checks.push('undecodable source image cannot be submitted');
  const pendingText=await page.evaluate(()=>{
   document.getElementById('modal-banding').style.display='none';penggunaAktif={Username:'admin-fixture',Role:'admin',Hak_Akses_Cabang:'Kendari'};
   globalTickets=[petakanTiketSupabase_({id_tiket:'TKT-PAUSE',cabang:'Kendari',teknisi:'Teknisi Contoh',status:'pending',target_sla_jam:'4',sla_jeda_mulai:'2026-10-10T10:00:00+08:00',sla_jeda_sisa_detik:7200,tenggat_waktu:'2026-10-10T12:00:00+08:00',waktu_penugasan:'2026-10-10T08:00:00+08:00',waktu_lapor:'2026-10-10T08:00:00+08:00'})];
   globalUsers=[];globalGaransi=[];currentTicketFilter='aktif';
   for(const id of ['filter-bulan-tiket','filter-tahun-tiket','filter-status-tiket','filter-pembayaran-tiket'])document.getElementById(id).value='all';
   renderTickets();return document.getElementById('ticket-container').textContent;
  });
  assert.match(pendingText,/SLA Pengerjaan Berhenti/);assert.match(pendingText,/Sisa waktu: 2 jam 0 menit kerja/);checks.push('legacy lowercase Pending displays frozen two-hour SLA and resume instructions');
  fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
