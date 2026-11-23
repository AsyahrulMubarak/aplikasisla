const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs');
const {edgeHarness}=require('../maintenance/performance-edge-harness.cjs');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=process.env.COMPOSITE_SOURCE_DIR||root;
const html=fs.readFileSync(path.join(release,'index.html'),'utf8');
const cardSource=html.match(/^([ \t]*)function buatHtmlKartuTeknisi_\([^]*?^\1\}/m)[0];
(async()=>{const f=await salesAchievementFixture();let browser,failSave=false;try{
 await f.clock('2026-12-08T08:00:00+08:00');await f.seed();await f.db.exec("update tiket set keterangan='Pending; persiapan alat kurang' where id_tiket='TKT-2026-11-1'");const h=await edgeHarness(f.db);
 browser=await chromium.launch({channel:'chrome',headless:true});const browserContext=await browser.newContext({viewport:{width:1100,height:1000}}),page=await browserContext.newPage(),errors=[],out=process.env.COMPOSITE_OUTPUT_DIR||path.join(root,'output/achievement-composite-20261024');fs.mkdirSync(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-12-08T08:00:00+08:00')});
 await page.addInitScript(()=>sessionStorage.setItem('sesiLoginSLA',JSON.stringify({user:{SessionToken:'a.b.c',SessionExpiresAt:Date.now()+3600000}})));
 const fixture=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="achievement-score.css"><style>body{font-family:Arial;background:#f3f6fb;padding:12px;margin:0}.card{padding:16px;border:1px solid #dce4f0;border-radius:12px;background:white}.charts-container{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.chart-box{background:#f8fafc;border:1px solid #dbe5f2;border-radius:8px;padding:12px}.donut{width:90px;height:90px;border-radius:50%;padding:11px;margin:12px auto}.donut-inner{border-radius:50%;height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;background:white}.donut-label{font-size:9px}.legend-item{display:flex;justify-content:space-between;font-size:12px;margin:8px 0}*{box-sizing:border-box}</style><main id="cards"></main><script>
 var penggunaAktif={Username:'admin',Role:'admin',Hak_Akses_Cabang:'Kendari'},SUPABASE_URL='https://oozkqjgllubhjctnkxwl.supabase.co',SUPABASE_ANON_KEY='public';
 var pastikanTokenSupabaseAktif_=async()=>'a.b.c';
 function amanTeks_(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function buatHtmlDiagramPekerjaanTeknisi_(){return '<p>Solo dan tim mengikuti porsi grade yang disahkan.</p>';}
 ${cardSource}
 document.getElementById('cards').innerHTML=buatHtmlKartuTeknisi_({nama:'Teknisi A',poin_terkumpul:50.8,performa_periode:'2026-11',performa_cabang:'Kendari'});
 </script><script src="achievement-score.js"></script><div id="main-lobby-wrapper" aria-hidden="true"><section id="lobby-credit-panel" hidden><span id="lobby-credit-period"></span><button id="lobby-credit-refresh">Muat ulang</button><div id="lobby-credit-list"></div><p id="lobby-credit-status"></p></section></div><script src="lobby-credit.js"></script></html>`;
 await page.context().route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/functions/v1/sla-performance-credit'){if(failSave&&req.postDataJSON().action==='save')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({status:'gagal',pesan:'Gangguan jaringan pengujian'})});const response=await h.handler(new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postData()}));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
  if(url.pathname==='/qa-achievement')return route.fulfill({contentType:'text/html',body:fixture});
  const name=url.pathname.slice(1);if(url.hostname==='aplikasisla.vercel.app'&&['achievement-score.js','achievement-score.css','performa.html','performa.js','performa.css','theme.js','theme.css','lobby-credit.js'].includes(name))return route.fulfill({path:path.join(release,name)});
  throw Error('Unexpected network: '+url);
 });
 await page.goto('https://aplikasisla.vercel.app/qa-achievement');await page.waitForFunction(()=>document.querySelector('.achievement-total'));
 assert.equal(await page.locator('.achievement-total').innerText(),'95,84 / 100');assert.match(await page.locator('.achievement-state').innerText(),/Sementara/);assert.equal(await page.locator('.achievement-grade-total').innerText(),'24');
 assert.equal(await page.locator('[data-achievement-sla]').isVisible(),true);assert.equal(await page.locator('[data-achievement-sla] .donut-val').count(),2);assert.deepEqual(await page.locator('[data-achievement-sla] .donut-val').allTextContents(),['100%','100%']);assert.match(await page.locator('[data-achievement-quality]').innerText(),/100% sementara/);assert.match(await page.locator('[data-achievement-quality]').innerText(),/1 menunggu tinjauan/);
 await page.locator('.achievement-details > summary').click();assert.equal(await page.locator('.achievement-component').count(),6);assert.match(await page.locator('.achievement-component').first().innerText(),/55%/);assert.match(await page.locator('.achievement-bonus').innerText(),/50,8/);assert.equal(await page.locator('.achievement-grade-row').count(),3);
 await page.screenshot({path:path.join(out,'dashboard-desktop.png'),fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.screenshot({path:path.join(out,'dashboard-mobile.png'),fullPage:true});
 await page.getByRole('link',{name:'Buka penilaian dan tinjauan mutu'}).click();await page.locator('#report').waitFor({state:'visible'});
 const watcher=await page.context().newPage();watcher.on('pageerror',e=>errors.push(e.message));await watcher.goto('https://aplikasisla.vercel.app/qa-achievement');await watcher.waitForFunction(()=>document.querySelector('.achievement-total')?.textContent.startsWith('95,84'));
 assert.equal(await page.locator('#period').inputValue(),'2026-11');assert.match(await page.locator('#target').innerText(),/24 poin sah/);assert.match(await page.locator('#metrics').innerText(),/Poin grade · 55%/);assert.match(await page.locator('#metrics').innerText(),/Stabilitas penugasan · 5%/);
 await page.locator('[data-case] select').selectOption('fault');await page.locator('[data-note]').fill('Persiapan alat terbukti tidak lengkap saat penugasan');
 await page.waitForFunction(()=>document.getElementById('draft-status').textContent.includes('tersimpan otomatis'));
 assert.equal(await page.locator('#score').innerText(),'94,18 / 100');assert.match(await page.locator('#metrics').innerText(),/66,67%/);assert.equal(await page.locator('[data-note]').inputValue(),'Persiapan alat terbukti tidak lengkap saat penugasan');
 await watcher.waitForFunction(()=>document.querySelector('.achievement-total')?.textContent.startsWith('94,18'));assert.equal(await watcher.locator('.achievement-grade-total').innerText(),'24');await watcher.close();
 await page.reload();await page.locator('#report').waitFor({state:'visible'});assert.equal(await page.locator('[data-case] select').inputValue(),'fault');assert.equal(await page.locator('[data-note]').inputValue(),'Persiapan alat terbukti tidak lengkap saat penugasan');
 failSave=true;await page.locator('[data-note]').fill('Persiapan alat terbukti tidak lengkap; bukti pemeriksaan terbaru');await page.waitForFunction(()=>document.getElementById('draft-status').textContent.includes('Belum tersimpan di server'));
 failSave=false;await page.reload();await page.waitForFunction(()=>document.querySelector('[data-note]')?.value.includes('bukti pemeriksaan terbaru'));await page.waitForFunction(()=>document.getElementById('draft-status').textContent.includes('tersimpan otomatis'));assert.equal(await page.locator('[data-case] select').inputValue(),'fault');
 assert.equal((await f.db.query('select count(*)::int n from sla_performa_bulan')).rows[0].n,0);
 await page.getByRole('button',{name:'Hitung pratinjau'}).click();await page.waitForFunction(()=>document.getElementById('score').textContent.startsWith('94,18'));
 await page.getByRole('button',{name:'Sahkan rekap bulanan'}).click();await page.waitForFunction(()=>document.getElementById('saved').textContent.includes('revisi 1'));assert.match(await page.locator('#credit').innerText(),/disahkan: 1/);
 const approvedScore=await page.locator('#score').innerText();
 await page.screenshot({path:path.join(out,'review-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto('https://aplikasisla.vercel.app/qa-achievement');await page.waitForFunction(()=>document.querySelector('.achievement-total')?.textContent.startsWith('94,18'));assert.match(await page.locator('.achievement-state').innerText(),/terpenuhi/);assert.match(await page.locator('[data-achievement-quality]').innerText(),/66,67%/);
 await page.evaluate(()=>document.getElementById('cards').insertAdjacentHTML('beforeend',buatHtmlKartuTeknisi_({nama:'Teknisi B',performa_periode:'2026-11',performa_cabang:'Kendari'})));await page.waitForFunction(()=>document.querySelectorAll('.achievement-grade-total').length===2);assert.deepEqual(await page.locator('.achievement-grade-total').allTextContents(),['24','24']);
 await f.db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261022074045_lobby_monthly_credit_progress.sql'),'utf8'));await f.clock('2026-11-30T22:00:00+08:00');h.setAuth({id:f.ids.manager,email:'manager@alfacom.local'});
 await page.evaluate(async()=>{document.getElementById('main-lobby-wrapper').setAttribute('aria-hidden','false');await window.SLACreditLobby.refresh(true);});
 const lobbyTech=page.locator('.credit-person').filter({has:page.getByRole('heading',{name:'Teknisi A',exact:true})});assert.equal(await lobbyTech.locator('.credit-percent').innerText(),approvedScore);assert.equal(await page.locator('.achievement-total').first().innerText(),approvedScore);assert.equal(await lobbyTech.locator('.credit-grade-total').innerText(),'24');
 assert.match(await lobbyTech.innerText(),/Grade 55% · Respons 10% · Pengerjaan 20% · Ketuntasan 5% · Garansi 5% · Stabilitas 5%/);
 await page.evaluate(()=>{document.querySelector('[data-achievement-person]').dataset.achievementPerson='<img src=x onerror=alert(1)>';delete document.querySelector('[data-achievement-person]').dataset.achievementLoading;window.SLAAchievementScore.refresh();});await page.waitForFunction(()=>document.querySelector('.achievement-note')?.textContent.includes('hak akses'));assert.equal(await page.locator('.achievement-score img').count(),0);
 assert.deepEqual(errors,[]);assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');
 console.log('Dashboard → authenticated Edge → PostgreSQL → six weights → cause review → audited approval → matching dashboard passed at desktop, 390px and 320px.');
 }finally{await browser?.close();await f.db.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
