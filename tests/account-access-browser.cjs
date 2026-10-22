const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{accountFixture}=require('../maintenance/account-access-test-fixture.cjs'),{accountEdgeHarness}=require('../maintenance/account-access-edge-harness.cjs');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),cachedRelease=path.join(root,'tmp/account-access-release/release'),release=fs.existsSync(cachedRelease)?cachedRelease:root,out=path.join(root,'output/account-access-qa');fs.mkdirSync(out,{recursive:true});
(async()=>{const f=await accountFixture(),h=accountEdgeHarness(f),before=await f.history();let browser,page;const errors=[],wa=[];
 try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});page=await browser.newPage({viewport:{width:1200,height:1050}});page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url()),cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type'};
  if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
  if(u.hostname==='aplikasisla.vercel.app'&&u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(release,'index.html'),'utf8')});
  if(u.pathname==='/fixtures/users')return route.fulfill({contentType:'application/json',body:JSON.stringify((await f.db.query('select * from users')).rows)});
  if(u.pathname.endsWith('/sla-profile')){const response=await h.post(r.postDataJSON());return route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.data),headers:cors});}
  if(u.pathname.endsWith('/rpc/sla_assert_account_session')){try{await f.as(h.state.session,'select sla_assert_account_session()');return route.fulfill({contentType:'application/json',body:'true',headers:cors})}catch{return route.fulfill({status:401,contentType:'application/json',body:'{}',headers:cors})}}
  const name=u.pathname.slice(1);if(['employee-account.js','ticket-admin-whatsapp.js','ticket-assessment.js','ticket-assessment.css','ticket-workflow.js','ticket-workflow.css','status-pegawai.js','depan_001.png'].includes(name))return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'image/png',body:fs.readFileSync(path.join(fs.existsSync(path.join(release,name))?release:root,name))});
  if(u.hostname.includes('fonnte'))wa.push(u.href);
  return route.fulfill({contentType:'application/json',body:'[]',headers:cors});
 });
 await page.goto('https://aplikasisla.vercel.app/',{waitUntil:'domcontentloaded'});await page.locator('#login-form').waitFor({state:'visible',timeout:30000});
 await page.evaluate(async(token)=>{
  mulaiRealtimeSLA_=async()=>{};jadwalkanHubungUlangRealtime_=()=>{};pastikanTokenSupabaseAktif_=async()=>penggunaAktif.SessionToken;
  showToast=(text,type)=>window.lastToast={text,type};
  ambilSemuaData=async()=>{globalUsers=(await(await fetch('/fixtures/users')).json()).map(u=>({Username:u.username,'Nama Asli':u.nama_asli,Role:u.role,Hak_Akses_Cabang:u.hak_akses_cabang,'Akun Aktif':u.account_active,'Versi Akses Akun':u.account_access_version,'Sinkron Akses Akun':u.account_sync_pending,'Permintaan Akun Aktif':u.account_requested_active}));renderTabelUser();return true;};
  penggunaAktif={Username:'admin','Nama Asli':'Admin Kendari',Role:'admin',Hak_Akses_Cabang:'Kendari',SessionToken:token};cabangAktif='Kendari';
  document.getElementById('login-wrapper').style.display='none';document.getElementById('app-wrapper').style.display='block';document.querySelectorAll('.tab-page').forEach(el=>el.style.display='none');document.getElementById('page-user').style.display='block';await ambilSemuaData();
 },h.token('admin'));
 const row=()=>page.locator('#tabel-user-body tr').filter({has:page.locator('td strong',{hasText:/^worker$/})});
 assert.equal(await row().getByRole('button',{name:'Nonaktifkan',exact:true}).count(),1);
 assert.equal(await page.locator('#tabel-user-body').getByRole('button',{name:'Del',exact:true}).count(),0);
 await row().getByRole('button',{name:'Nonaktifkan',exact:true}).click();await page.locator('#prompt-input').fill('Pegawai sudah tidak aktif');await page.locator('#btn-prompt-submit').click();await page.locator('#btn-confirm-yes').click();await row().getByRole('button',{name:'Aktifkan kembali',exact:true}).waitFor();
 assert.equal((await f.user()).account_active,false);await page.locator('#tabel-user-wrapper').screenshot({path:path.join(out,'akun-nonaktif-desktop.png')});
 await row().getByRole('button',{name:'Aktifkan kembali',exact:true}).click();await page.locator('#prompt-input').fill('Pegawai kembali bekerja');await page.locator('#btn-prompt-submit').click();await page.locator('#btn-confirm-yes').click();await row().getByRole('button',{name:'Nonaktifkan',exact:true}).waitFor();assert.equal((await f.user()).account_active,true);
 // TKT-153: a confirmed reduction to Muaz must keep the follow-up button clickable.
 await page.evaluate(()=>{const row={id_tiket:'TKT-153',cabang:'Kendari',status:'On Progress',teknisi:'Muaz',riwayat_penggantian_teknisi:[{dari:'Ardi S, Muaz',ke:'Muaz',sumber:'server'}],jenis_pekerjaan:'Maintenance PABX',klien_lokasi:'Klien Uji'};
  globalUsers.push({Username:'Muaz',Role:'teknisi','Nama Asli':'Muaz','No WA':'081234567891',Hak_Akses_Cabang:'Kendari'});globalTickets=[petakanTiketSupabase_(row)];callSupabase=async()=>[row];renderTickets=()=>{};window.fakeFollowUp=[];kirimKeBackend_=async(url,action,payload)=>{window.fakeFollowUp.push({action,payload});return {status:'sukses',terkirim:true}};const box=document.createElement('div');box.id='follow-up-test';document.body.append(box);tambahkanHtmlAman_(box,tombolFollowUpTiket_(globalTickets[0]));});
 assert.equal(await page.locator('#follow-up-test button').isEnabled(),true);await page.locator('#follow-up-test button').click();await page.waitForFunction(()=>window.fakeFollowUp.length===1);assert.equal(await page.evaluate(()=>fakeFollowUp[0].payload.nomorTujuan),'6281234567891');assert.doesNotMatch(await page.evaluate(()=>fakeFollowUp[0].payload.pesan),/Ardi S/);
 // Client chat renders through the same sanitizer as a ticket card, for admins only.
 await page.evaluate(()=>{const box=document.createElement('div');box.id='chat-wa-test';document.body.append(box);tambahkanHtmlAman_(box,htmlTombolChatKlienAdmin_({Cabang:'Kendari','No WA Klien':'082292040122'}));});
 assert.equal(await page.locator('#chat-wa-test a').getAttribute('href'),'https://wa.me/6282292040122');
 assert.match(await page.locator('#chat-wa-test a').getAttribute('rel'),/noopener/);
 await page.evaluate(()=>{globalUsers.push({Username:'sales-fixture',Role:'sales','Nama Asli':'Sales Uji','No WA':'081234567890'});tambahkanHtmlAman_(document.getElementById('chat-wa-test'),htmlTombolChatSalesAdmin_({Cabang:'Kendari',Sales:'Sales Uji'}));});
 assert.equal(await page.locator('#chat-wa-test a').nth(1).getAttribute('href'),'https://wa.me/6281234567890');
 assert.equal(await page.evaluate(()=>{penggunaAktif.Role='teknisi';return htmlTombolChatKlienAdmin_({Cabang:'Kendari','No WA Klien':'082292040122'})}),'');
 // Same browser's old session is cleared after reactivation, without accessing production.
 h.state.session='worker';await page.evaluate(async token=>{penggunaAktif.SessionToken=token;prosesLogout=()=>window.loggedOut=true;await periksaSesiAkunPegawai_().catch(()=>{});},h.token('worker'));assert.equal(await page.evaluate(()=>window.loggedOut),true);assert.equal(await page.evaluate(()=>penggunaAktif),null);
 assert.deepEqual(await f.history(),before);assert.deepEqual(errors,[]);assert.deepEqual(wa,[]);
 console.log(JSON.stringify({passed:true,actualBrowserToEdgeToDatabase:true,disable:true,reactivate:true,oldSessionCleared:true,historyUnchanged:true,realWhatsAppSent:0}));
 }catch(e){await page?.screenshot({path:path.join(out,'failure.png'),fullPage:true});throw e}finally{await browser?.close();await f.db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

