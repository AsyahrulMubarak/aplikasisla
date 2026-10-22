const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
test('old gateway delegates to the same Supabase implementation without any legacy upstream',()=>{
 const entry=fs.readFileSync(__dirname+'/../supabase/functions/sla-legacy-gateway/index.ts','utf8');
 assert.match(entry,/import '..\/sla-operations\/index.ts'/);assert.doesNotMatch(entry,/script\.google|sla_konfigurasi_gateway_lama|forwardLegacy/);
});
test('frontend dispatches operations to Supabase with a verified session and branch',async()=>{
 const html=fs.readFileSync(__dirname+'/../index.html','utf8'),fn=html.match(/^([ \t]*)async function kirimKeBackend_\([^]*?^\1\}/m)[0],calls=[];
 const c=vm.createContext({crypto:webcrypto,AbortController,setTimeout,clearTimeout,SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'public-test',API_URL_CABANG:{Kendari:'Kendari',Raha:'Raha'},cabangAktif:'Kendari',penggunaAktif:{Username:'fixture',SessionToken:'expired'},pastikanTokenSupabaseAktif_:async()=>'refreshed-token',kirimProfilSupabase_:async()=>({route:'profile'}),kirimKlaimSalesSupabase_:async()=>({route:'claims'}),fetch:async(url,init)=>{calls.push({url,...init});return Response.json({status:'sukses'});}});
 vm.runInContext(fn,c);
 for(const b of ['Kendari','Raha'])for(const action of ['relayWA','syncCRM','broadcastCRM','laporBug'])await c.kirimKeBackend_(b,action);
 assert.equal(calls.length,8);for(const call of calls){assert.equal(call.url,'https://db.test/functions/v1/sla-operations');assert.equal(call.headers.Authorization,'Bearer refreshed-token');const data=JSON.parse(call.body);assert.ok(['Kendari','Raha'].includes(data.cabang));assert.ok(data.requestId);assert.equal('apiKey' in data,false);}
 assert.equal((await c.kirimKeBackend_('Kendari','validateSession')).route,'profile');assert.equal((await c.kirimKeBackend_('Raha','ajukanBanding')).route,'claims');
 c.penggunaAktif=null;await assert.rejects(c.kirimKeBackend_('Kendari','relayWA'),/Sesi tidak tersedia/);
 assert.doesNotMatch(html,/script\.google|sla-legacy-gateway/);
});
