const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture,ids}=require('../maintenance/ticket-assessment-test-fixture.cjs');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=process.env.SLA_TEST_RELEASE_ROOT||path.join(root,'tmp/ticket-assessment-release/release'),out=process.env.SLA_QA_OUTPUT||path.join(root,'output/ticket-assessment-qa');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const {db}=await fixture();let browser,actor='tech',handler;const errors=[],messages=[];
 const context=vm.createContext({console,Response,Request,AbortSignal,Set,Number,encodeURIComponent,
 Deno:{env:{get:k=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-public'})[k]},serve:fn=>handler=fn},
 fetch:async(url,options={})=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:ids[actor],email:actor+'@alfacom.local'});
  if(url.includes('/users?'))return Response.json((await db.query('select username,auth_id from users where auth_id=$1',[ids[actor]])).rows);
  if(url.endsWith('/rpc/sla_penilaian_tiket')){const b=JSON.parse(options.body);try{return Response.json((await db.query('select sla_penilaian_tiket($1,$2,$3,$4,$5) result',[b.p_auth_id,b.p_id_tiket,b.p_action,b.p_revision,JSON.stringify(b.p_data)])).rows[0].result);}catch(e){return Response.json({message:e.message},{status:400});}}
  throw Error('Unexpected Edge request: '+url);
 }});
 vm.runInContext(fs.readFileSync(path.join(release,'supabase/functions/sla-ticket-assessment/index.ts'),'utf8'),context);
 try{
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1100,height:950}});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
   if(url.hostname==='aplikasisla.vercel.app'&&url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(release,'index.html'),'utf8')});
   if(url.pathname==='/fixtures/tickets')return route.fulfill({contentType:'application/json',body:JSON.stringify((await db.query('select * from tiket')).rows),headers:cors});
   if(url.pathname.endsWith('/sla-ticket-assessment')){const r=await handler(new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postData()}));return route.fulfill({status:r.status,contentType:'application/json',body:await r.text(),headers:cors});}
   if(['ticket-assessment.js','ticket-assessment.css','ticket-workflow.js','ticket-workflow.css','status-pegawai.js','depan_001.png'].includes(url.pathname.slice(1))){const name=url.pathname.slice(1),dir=name.startsWith('ticket-')?release:root;return route.fulfill({contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'image/png',body:fs.readFileSync(path.join(dir,name))});}
   if(url.hostname.includes('fonnte')){messages.push(request.url());throw Error('No real WA allowed');}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname.includes('/functions/')?{status:'sukses',data:[]}:[]),headers:cors});
  });
  await page.goto('https://aplikasisla.vercel.app/',{waitUntil:'domcontentloaded'});
  await page.locator('#login-form').waitFor({state:'visible',timeout:30000});
  await page.evaluate(()=>{pastikanTokenSupabaseAktif_=async()=>'fixture.jwt.token';mulaiRealtimeSLA_=async()=>{};jadwalkanHubungUlangRealtime_=()=>{};showToast=(text,type)=>window.lastToast={text,type};
   ambilSemuaData=async()=>{globalTickets=(await(await fetch('/fixtures/tickets')).json()).map(petakanTiketSupabase_);renderTickets();};
   document.getElementById('login-wrapper').style.display='none';document.getElementById('main-lobby-wrapper').style.display='none';document.getElementById('app-wrapper').style.display='block';
   document.querySelectorAll('.tab-page').forEach(el=>el.style.display='none');document.getElementById('page-tiket').style.display='block';currentTicketFilter='aktif';cabangAktif='Kendari';
  });
  async function asUser(name){actor=name;const profile=(await db.query('select * from users where username=$1',[name])).rows[0];await page.evaluate(async p=>{penggunaAktif={Username:p.username,'Nama Asli':p.nama_asli,Role:p.role,Hak_Akses_Cabang:p.hak_akses_cabang,SessionToken:'fixture.jwt.token','Gaji Pokok':p.gaji_pokok};await ambilSemuaData();},profile);}
  await asUser('tech');
  const card=page.locator('[data-ticket-id="TKT-1"]');await card.locator('.ticket-assessment>summary').click();
  assert.match(await card.innerText(),/Bagi rata otomatis/);
  await card.getByRole('button',{name:'Ajukan grade',exact:true}).click();
  await page.locator('#assessment-grade').selectOption('A');await page.locator('#assessment-reason').fill('Paket integrasi perangkat dan uji akhir. <img src=x onerror=alert(1)>');
  await page.locator('#assessment-form').getByRole('button',{name:'Ajukan grade',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  assert.equal((await db.query("select penilaian_teknisi->'grade'->>'status' value from tiket where id_tiket='TKT-1'")).rows[0].value,'pending');
  await asUser('manager');await card.locator('.ticket-assessment>summary').click();await card.getByRole('button',{name:'Tinjau grade',exact:true}).click();
  assert.equal(await page.locator('#assessment-content img').count(),0);await page.getByRole('button',{name:'Setujui grade',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  await asUser('tech');await card.locator('.ticket-assessment>summary').click();await card.getByRole('button',{name:'Atur kontribusi',exact:true}).click();
  assert.equal(await page.locator('#assessment-custom').isChecked(),false);assert.equal(await page.locator('#assessment-custom-reason').isVisible(),false);
  assert.deepEqual(await page.locator('[data-share]').evaluateAll(nodes=>nodes.map(n=>Number(n.value))),[50,50]);
  await page.locator('#assessment-custom').check();await page.locator('[data-share="tech"]').fill('75');await page.locator('[data-share="tech2"]').fill('50');await page.locator('#assessment-reason').fill('Diagnosis 75 persen dan pengujian 25 persen telah dibahas');await page.locator('#assessment-team-confirmed').check();
  await page.getByRole('button',{name:'Ajukan pembagian',exact:true}).click();assert.match(await page.locator('#assessment-error').innerText(),/total kontribusi 100%/);
  await page.locator('[data-share="tech2"]').fill('25');await page.getByRole('button',{name:'Ajukan pembagian',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  await asUser('admin');await card.locator('.ticket-assessment>summary').click();await card.getByRole('button',{name:'Tinjau pembagian',exact:true}).click();await page.getByRole('button',{name:'Sahkan pembagian',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  await db.exec("update tiket set status='Selesai',waktu_selesai=now(),deskripsi_pekerjaan_ba='Tindakan dan pengujian akhir',nama_customer='PIC Uji',tanda_tangan=repeat('x',100) where id_tiket='TKT-1'");
  await page.evaluate(()=>currentTicketFilter='riwayat');await asUser('manager');await card.locator('.ticket-assessment>summary').click();
  await card.getByRole('button',{name:'Sahkan hasil pencapaian',exact:true}).click();await page.locator('#assessment-form').getByRole('button',{name:'Sahkan hasil pencapaian',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  let a=(await db.query("select penilaian_teknisi from tiket where id_tiket='TKT-1'")).rows[0].penilaian_teknisi;
  assert.deepEqual(a.achievement.members.map(m=>a.achievement.points*m.share/100),[6,2]);
  await db.exec("update tiket set status_pembayaran='Lunas',tanggal_lunas=now() where id_tiket='TKT-1'");await asUser('admin');await card.locator('.ticket-assessment>summary').click();
  assert.match(await card.innerText(),/Pembagian dikunci saat bonus cair/);assert.equal(await card.getByRole('button',{name:'Atur kontribusi',exact:true}).count(),0);
  for(const label of ['Revisi Dokumen','Input / Edit Poin Pekerjaan','Edit Detail','Hapus','Copy Link Tracking Klien'])assert.equal(await card.getByRole('button',{name:label,exact:false}).count(),1,label);
  await card.locator('.ticket-service-details>summary').click();assert.match(await card.innerText(),/Tindakan dan pengujian akhir/);
  await card.screenshot({path:path.join(out,'ticket-assessment-desktop.png')});
  for(const width of [390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(width===390)await card.screenshot({path:path.join(out,'ticket-assessment-mobile.png')});}
  // A branch admin determines every grade directly; no pending/self-approval loop.
  await page.setViewportSize({width:1100,height:950});
  await page.evaluate(()=>currentTicketFilter='aktif');await asUser('admin');
  const directCard=page.locator('[data-ticket-id="TKT-2"]');await directCard.locator('.ticket-assessment>summary').click();
  await directCard.getByRole('button',{name:'Tetapkan grade',exact:true}).click();
  await page.locator('#assessment-grade').selectOption('S');await page.locator('#assessment-reason').fill('Proyek kompleks dengan diagnosis dan lingkup yang diperiksa admin');
  await page.locator('#assessment-form').getByRole('button',{name:'Tetapkan grade',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  a=(await db.query("select penilaian_teknisi from tiket where id_tiket='TKT-2'")).rows[0].penilaian_teknisi;
  assert.equal(a.grade.status,'approved');assert.equal(a.grade.points,16);assert.equal(a.grade.reviewedName,'Admin');
  await directCard.locator('.ticket-assessment>summary').click();assert.match(await directCard.innerText(),/Ditetapkan oleh: Admin/);
  assert.equal(await directCard.getByRole('button',{name:'Tinjau grade',exact:true}).count(),0);
  await directCard.screenshot({path:path.join(out,'admin-direct-grade.png')});
  // Emulate an admin proposal from the old UI, then review it with that same account.
  await db.exec("update tiket set penilaian_teknisi=jsonb_set(penilaian_teknisi,'{grade,status}','\"pending\"') where id_tiket='TKT-2'");
  await asUser('admin');await directCard.locator('.ticket-assessment>summary').click();
  assert.equal(await directCard.getByRole('button',{name:'Tetapkan grade',exact:true}).count(),1);
  await directCard.getByRole('button',{name:'Tinjau grade',exact:true}).click();await page.getByRole('button',{name:'Setujui grade',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  assert.equal((await db.query("select penilaian_teknisi->'grade'->>'status' value from tiket where id_tiket='TKT-2'")).rows[0].value,'approved');
  // Admin contribution is a direct decision, with no second approval step.
  await directCard.locator('.ticket-assessment>summary').click();await directCard.getByRole('button',{name:'Tetapkan kontribusi',exact:true}).click();
  await page.locator('#assessment-custom').check();await page.locator('[data-share="tech"]').fill('100');await page.locator('#assessment-reason').fill('Teknisi A mengerjakan seluruh diagnosis dan pengujian');await page.locator('#assessment-team-confirmed').check();
  await page.locator('#assessment-form').getByRole('button',{name:'Tetapkan kontribusi',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  a=(await db.query("select penilaian_teknisi from tiket where id_tiket='TKT-2'")).rows[0].penilaian_teknisi;assert.equal(a.allocation.status,'approved');assert.equal(a.allocation.approvedName,'Admin');
  // Untouched contribution gives equal shares for both results without confirmation.
  await db.exec("insert into tiket(id_tiket,teknisi,cabang,status,status_pembayaran,jenis_pekerjaan,bobot_poin,status_sla) values('TKT-AUTO','Teknisi A, Teknisi B','Kendari','On Progress','Belum Lunas','Integrasi dan pengujian',60,'TERPENUHI')");
  await asUser('admin');const autoCard=page.locator('[data-ticket-id="TKT-AUTO"]');await autoCard.locator('.ticket-assessment>summary').click();
  assert.match(await autoCard.innerText(),/Bagi rata otomatis/);assert.equal(await autoCard.getByRole('button',{name:'Konfirmasi bagi rata',exact:true}).count(),0);
  await autoCard.getByRole('button',{name:'Tetapkan grade',exact:true}).click();await page.locator('#assessment-grade').selectOption('A');await page.locator('#assessment-reason').fill('Paket integrasi dan pengujian diselesaikan bersama');await page.locator('#assessment-form').getByRole('button',{name:'Tetapkan grade',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  await db.exec("update tiket set status='Selesai',waktu_selesai=now(),deskripsi_pekerjaan_ba='Integrasi dan uji sistem',nama_customer='PIC Uji',tanda_tangan=repeat('x',100) where id_tiket='TKT-AUTO'");
  await page.evaluate(()=>currentTicketFilter='riwayat');await asUser('admin');await autoCard.locator('.ticket-assessment>summary').click();await autoCard.getByRole('button',{name:'Sahkan hasil pencapaian',exact:true}).click();await page.locator('#assessment-form').getByRole('button',{name:'Sahkan hasil pencapaian',exact:true}).click();await page.waitForFunction(()=>document.getElementById('ticket-assessment-modal').style.display==='none');
  a=(await db.query("select penilaian_teknisi from tiket where id_tiket='TKT-AUTO'")).rows[0].penilaian_teknisi;assert.deepEqual(a.achievement.members.map(m=>8*m.share/100),[4,4]);
  await db.exec("update tiket set status_pembayaran='Lunas',tanggal_lunas=now() where id_tiket='TKT-AUTO'");a=(await db.query("select penilaian_teknisi from tiket where id_tiket='TKT-AUTO'")).rows[0].penilaian_teknisi;assert.deepEqual(a.bonusSnapshot.members.map(m=>60*m.share/100),[30,30]);
  assert.deepEqual(errors,[]);assert.deepEqual(messages,[]);
  console.log(JSON.stringify({passed:true,flow:'actual UI → Edge authentication → PostgreSQL approval → achievement 6/2 → bonus allocation 45/15',adminDirectGrade:true,legacyAdminProposalRecovered:true,adminDirectContribution:true,automaticEqualAchievement:[4,4],automaticEqualBonus:[30,30],javascriptErrors:errors,realWhatsAppRequests:messages.length}));
 }finally{await browser?.close();await db.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

