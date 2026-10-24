const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {salesAchievementFixture}=require('../maintenance/sales-achievement-test-fixture.cjs');
const {edgeHarness}=require('../maintenance/performance-edge-harness.cjs');
const {chromium}=require('C:/Users/Abu Abid/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),release=process.env.COMPOSITE_SOURCE_DIR||root;
const html=fs.readFileSync(path.join(release,'index.html'),'utf8');
const cardSource=html.match(/^([ \t]*)function buatHtmlKartuTeknisi_\([^]*?^\1\}/m)[0];
(async()=>{const f=await salesAchievementFixture();let browser;try{
 await f.clock('2026-12-08T08:00:00+08:00');await f.seed();await f.db.exec("update tiket set keterangan='Pending; persiapan alat kurang' where id_tiket='TKT-2026-11-1'");const h=await edgeHarness(f.db);
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[],out=path.join(root,'output/achievement-composite-20261024');fs.mkdirSync(out,{recursive:true});page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install({time:new Date('2026-12-08T08:00:00+08:00')});
 await page.addInitScript(()=>sessionStorage.setItem('sesiLoginSLA',JSON.stringify({user:{SessionToken:'a.b.c',SessionExpiresAt:Date.now()+3600000}})));
 const fixture=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="achievement-score.css"><style>body{font-family:Arial;background:#f3f6fb;padding:12px;margin:0}.card{padding:16px;border:1px solid #dce4f0;border-radius:12px;background:white}.charts-container,.chart-legend{display:none}*{box-sizing:border-box}</style><main id="cards"></main><script>
 var penggunaAktif={Username:'admin',Role:'admin',Hak_Akses_Cabang:'Kendari'},SUPABASE_URL='https://oozkqjgllubhjctnkxwl.supabase.co',SUPABASE_ANON_KEY='public';
 var pastikanTokenSupabaseAktif_=async()=>'a.b.c';
 function amanTeks_(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function buatHtmlDiagramPekerjaanTeknisi_(){return '<p>Solo dan tim mengikuti porsi grade yang disahkan.</p>';}
 ${cardSource}
 document.getElementById('cards').innerHTML=buatHtmlKartuTeknisi_({nama:'Teknisi A',poin_terkumpul:50.8,performa_periode:'2026-11',performa_cabang:'Kendari'});
 </script><script src="achievement-score.js"></script></html>`;
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.pathname==='/functions/v1/sla-performance-credit'){const response=await h.handler(new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postData()}));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
  if(url.pathname==='/qa-achievement')return route.fulfill({contentType:'text/html',body:fixture});
  const name=url.pathname.slice(1);if(url.hostname==='aplikasisla.vercel.app'&&['achievement-score.js','achievement-score.css','performa.html','performa.js','performa.css'].includes(name))return route.fulfill({path:path.join(release,name)});
  throw Error('Unexpected network: '+url);
 });
 await page.goto('https://aplikasisla.vercel.app/qa-achievement');await page.waitForFunction(()=>document.querySelector('.achievement-total'));
 assert.equal(await page.locator('.achievement-total').innerText(),'96,22 / 100');assert.match(await page.locator('.achievement-state').innerText(),/Sementara/);assert.match(await page.locator('.achievement-grade').innerText(),/24/);
 await page.locator('.achievement-details summary').click();assert.equal(await page.locator('.achievement-component').count(),6);assert.match(await page.locator('.achievement-component').first().innerText(),/50%/);assert.match(await page.locator('.achievement-bonus').innerText(),/50,8/);
 await page.screenshot({path:path.join(out,'dashboard-desktop.png'),fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await page.screenshot({path:path.join(out,'dashboard-mobile.png'),fullPage:true});
 await page.getByRole('link',{name:'Buka penilaian dan tinjauan mutu'}).click();await page.waitForFunction(()=>!document.getElementById('report').hidden);
 assert.equal(await page.locator('#period').inputValue(),'2026-11');assert.match(await page.locator('#target').innerText(),/24 poin sah/);assert.match(await page.locator('#metrics').innerText(),/Poin grade · 50%/);assert.match(await page.locator('#metrics').innerText(),/Stabilitas penugasan · 5%/);
 await page.locator('[data-case] select').selectOption('fault');await page.locator('[data-note]').fill('Persiapan alat terbukti tidak lengkap saat penugasan');await page.getByRole('button',{name:'Hitung pratinjau'}).click();await page.waitForFunction(()=>document.getElementById('score').textContent.startsWith('92,89'));
 await page.getByRole('button',{name:'Sahkan rekap bulanan'}).click();await page.waitForFunction(()=>document.getElementById('saved').textContent.includes('revisi 1'));assert.match(await page.locator('#credit').innerText(),/disahkan: 1/);
 await page.screenshot({path:path.join(out,'review-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto('https://aplikasisla.vercel.app/qa-achievement');await page.waitForFunction(()=>document.querySelector('.achievement-total')?.textContent.startsWith('92,89'));assert.match(await page.locator('.achievement-state').innerText(),/terpenuhi/);
 await page.evaluate(()=>{document.querySelector('[data-achievement-person]').dataset.achievementPerson='<img src=x onerror=alert(1)>';delete document.querySelector('[data-achievement-person]').dataset.achievementLoading;window.SLAAchievementScore.refresh();});await page.waitForFunction(()=>document.querySelector('.achievement-note')?.textContent.includes('hak akses'));assert.equal(await page.locator('.achievement-score img').count(),0);
 assert.deepEqual(errors,[]);assert.equal((await f.db.query('select count(*)::int n from sla_notif_kenaikan_gaji')).rows[0].n,0);assert.equal((await f.db.query("select gaji_pokok from users where username='tech'")).rows[0].gaji_pokok,'2000000');
 console.log('Dashboard → authenticated Edge → PostgreSQL → six weights → cause review → audited approval → matching dashboard passed at desktop, 390px and 320px.');
 }finally{await browser?.close();await f.db.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
