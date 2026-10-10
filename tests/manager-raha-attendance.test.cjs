const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const edge=fs.readFileSync(__dirname+'/../supabase/functions/sla-payroll-attendance/index.ts','utf8');
function harness(){
 const calls=[],FixedDate=class extends Date{constructor(...a){super(...(a.length?a:['2026-10-10T08:00:00+08:00']));}};
 const c=vm.createContext({console,Date:FixedDate,Intl,Response,Request,AbortSignal,crypto,URLSearchParams,
 Deno:{env:{get:n=>({SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'server'})[n]},serve(){}},
 fetch:async(url,o={})=>{calls.push({url,...o});if(url.includes('/absensi?')||url.includes('/pengajuan_cuti?'))return Response.json([]);if(url.includes('/rpc/sla_insert_absensi_batch'))return Response.json(1);throw Error('Unexpected '+url);}});
 vm.runInContext(edge,c);return {c,calls};
}
test('Manager can check in at either office using trusted policy while keeping the recorded branch and hours',async()=>{
 for(const point of [{latitude:-4.8268920873652625,longitude:122.72467110301972},{latitude:-3.9641006831731826,longitude:122.54316001476751}]){
  const {c,calls}=harness(),u={name:'Manager',role:'manager',branch:'Kendari',salary:2000000};
  assert.equal(c.policy(u).kantorDiizinkan.length,2);assert.equal(c.policy(u).selesaiMenit,1020);
  await c.recordAttendance({tipeAbsen:'Masuk',...point},u);
  const payload=JSON.parse(calls.find(x=>x.url.includes('sla_insert_absensi_batch')).body);
  assert.equal(payload.p_rows[0].jarak_meter,0);assert.equal(payload.p_rows[0].cabang,'Kendari');assert.equal(payload.p_rows[0].status_disiplin,'Tepat Waktu');
 }
});
test('another branch office is not accepted for other roles and locations beyond both radii still require proof',async()=>{
 const {c}=harness(),gps={tipeAbsen:'Masuk',latitude:-4.8268920873652625,longitude:122.72467110301972};
 for(const role of ['teknisi','sales','admin'])await assert.rejects(c.recordAttendance({...gps,role:'manager'},{name:'Employee',role,branch:'Kendari',salary:1500000}),/luar radius/);
 await assert.rejects(c.recordAttendance({...gps,latitude:-4.9},{name:'Manager',role:'manager',branch:'Kendari',salary:2000000}),/luar radius/);
});
test('browser GPS uses the closest allowed office and falls back to the existing single-office response',()=>{
 const html=fs.readFileSync(__dirname+'/../absen.html','utf8'),f=name=>html.match(new RegExp('^([ \\t]*)function '+name+'\\([^]*?^\\1\\}','m'))[0];
 const gps={className:'',innerHTML:''};const c=vm.createContext({Math,Number,Array,userLat:null,userLon:null,jarakSekarang:0,lokasiDitemukan:false,RADIUS_MAKSIMAL:100,
 document:{getElementById:()=>gps},navigator:{geolocation:{getCurrentPosition:success=>success({coords:{latitude:-4.8268920873652625,longitude:122.72467110301972}})}},cekKondisiAbsen(){},cekKondisiKeterangan(){}});
 for(const name of ['hitungJarak','dapatkanLokasi'])vm.runInContext(f(name),c);
 c.kebijakanAbsensiAktif={kantor:{lat:-3.9641006831731826,lon:122.54316001476751},kantorDiizinkan:[{cabang:'Kendari',lat:-3.9641006831731826,lon:122.54316001476751},{cabang:'Raha',lat:-4.8268920873652625,lon:122.72467110301972}]};
 c.dapatkanLokasi();assert.equal(c.jarakSekarang,0);assert.match(gps.innerHTML,/Kantor Raha/);assert.match(gps.innerHTML,/Aman/);
 delete c.kebijakanAbsensiAktif.kantorDiizinkan;c.dapatkanLokasi();assert.equal(gps.className,'gps-box warning');
});
