'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.PAYROLL_BANK_SOURCE_DIR||path.resolve(__dirname,'..');
const edge=fs.readFileSync(path.join(root,'supabase/functions/sla-payroll-attendance/index.ts'),'utf8');
const html=fs.readFileSync(process.env.PAYROLL_BANK_HTML||path.join(root,'slipgaji.html'),'utf8').replace(/\r\n/g,'\n');
const manager={role:'manager',authId:'00000000-0000-4000-8000-000000000001',branch:'Kendari',homeBranch:'Kendari',access:'Semua',salary:3000000};
const request={action:'simpanStatusTransferGaji',usernameTarget:'worker-kendari',periode:'2026-09',siklus:'2026-09-29',sudahTransfer:true,statusLama:false};
function edgeHarness() {
 const calls=[];
 const c=vm.createContext({Intl,console,Response,Request,crypto,AbortSignal,URLSearchParams,
  Deno:{env:{get:key=>({SUPABASE_URL:'https://transfer.test',SUPABASE_SERVICE_ROLE_KEY:'test-secret',SUPABASE_ANON_KEY:'test-public'})[key]},serve(){}},
  fetch:async(url,options)=>{calls.push({url,options});const p=JSON.parse(options.body);
   if(url.endsWith('/sla_status_transfer_gaji'))return Response.json({status:'sukses',periode:p.p_periode,siklus:'2026-09-29',data:[]});
   if(url.endsWith('/sla_simpan_transfer_gaji'))return Response.json({status:'sukses',periode:p.p_periode,siklus:p.p_siklus,data:{username:p.p_username,sudahTransfer:p.p_sudah_transfer}});
   throw Error('Unexpected request '+url);
  }});vm.runInContext(edge,c);return {c,calls};
}
test('Verified Admin Kendari, manager and director can mark/unmark both branches',async()=>{
 for(const actor of [{...manager,role:'admin'},manager,{...manager,role:'direktur',salary:0}]) {
  const {c,calls}=edgeHarness();
  for(const usernameTarget of ['worker-kendari','worker-raha'])for(const sudahTransfer of [true,false]) {
   const json=await c.dispatch({...request,usernameTarget,sudahTransfer,authId:'forged'},actor);
   assert.equal(json.data.sudahTransfer,sudahTransfer);assert.equal(JSON.parse(calls.at(-1).options.body).p_auth_id,actor.authId);
  }
  assert.equal((await c.dispatch({action:'getStatusTransferGaji',periode:'2026-09'},actor)).status,'sukses');
 }
});
test('Other roles and legacy admin Raha cannot read or mutate transfer status even with forged role',async()=>{
 for(const actor of [...['teknisi','sales','admin_raha','unknown'].map(role=>({...manager,role})),{...manager,role:'admin',homeBranch:'Raha'}]) {
  const {c,calls}=edgeHarness();await assert.rejects(c.dispatch({...request,user:{Role:'direktur'}},actor),/hanya dapat diubah/);
  await assert.rejects(c.dispatch({action:'getStatusTransferGaji',periode:'2026-09'},actor),/hanya untuk/);assert.equal(calls.length,0);
 }
});
test('API requires a real boolean, salary period, cycle and expected prior status',async()=>{
 for(const patch of [{sudahTransfer:'true'},{sudahTransfer:1},{statusLama:null},{statusLama:undefined},{periode:'2026-13'},{siklus:''},{siklus:'yesterday'},{usernameTarget:''}]) {
  const {c,calls}=edgeHarness();await assert.rejects(c.dispatch({...request,...patch},manager),/tidak valid/);assert.equal(calls.length,0);
 }
});
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.events={};this.style={};this.attrs={};this.checked=false;this.value='';this.classes=new Set();this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};}
 appendChild(e){this.children.push(e);return e;}
 replaceChildren(...children){this.children=children;}
 setAttribute(k,v){this.attrs[k]=v;}
 addEventListener(e,fn){this.events[e]=fn;}
 emit(e){return this.events[e]?.({target:this});}
}
const cutoff=Date.parse('2026-10-29T00:00:00+08:00');
const employee={Username:'worker-kendari','Nama Asli':'Synthetic Employee',Role:'teknisi'};
function uiHarness(options={}){
 let clock=options.now??cutoff-1000;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const period={value:'2026-09'},hint=new Element('span'),timers=new Map(),calls=[],toasts=[],records=options.records||new Map();let nextTimer=0;
 const cycle=()=>clock>=cutoff?'2026-10-29':'2026-09-29';
 const response=()=>({status:'sukses',periode:period.value,siklus:cycle(),resetPada:clock>=cutoff?'2026-11-29T00:00:00+08:00':'2026-10-29T00:00:00+08:00',waktuServer:new Date(clock).toISOString(),
  data:[...records.values()].filter(r=>r.cycle===cycle()&&r.period===period.value).map(r=>({username:r.username,sudahTransfer:r.paid}))});
 const c=vm.createContext({Date:Clock,console,apiUrl:'https://transfer.test',document:{createElement:t=>new Element(t),getElementById:id=>id==='pilih-bulan'?period:hint},
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  payloadSesiSlip:(action,extra={})=>({action,...extra}),showToast:(...args)=>toasts.push(args),
  fetchJsonDenganTimeout_:async(url,payload)=>{calls.push(payload);
   if(payload.action==='getStatusTransferGaji')return response();
   if(payload.siklus!==cycle())throw Error('Siklus transfer gaji sudah direset. Muat ulang status transfer.');
   const key=payload.siklus+'_'+payload.periode+'_'+payload.usernameTarget;
   if(!!records.get(key)?.paid!==payload.statusLama)throw Error('Status transfer sudah diubah pengguna lain.');
   records.set(key,{cycle:cycle(),period:payload.periode,username:payload.usernameTarget,paid:payload.sudahTransfer});
   return {status:'sukses',periode:payload.periode,siklus:cycle(),data:{username:payload.usernameTarget,sudahTransfer:payload.sudahTransfer}};
  }});
 vm.runInContext("let penggunaAktif={Role:'manager',Hak_Akses_Cabang:'Semua'};let statusTransferGaji_=Object.create(null),statusTransferSiap_=false,periodeTransferGaji_='',siklusTransferGaji_='',batasResetTransferGaji_=0,timerResetTransferGaji_=null,urutanStatusTransferGaji_=0;const kontrolTransferGaji_=new Map(),penyimpananTransferGaji_=new Set();",c);
 for(const name of ['normalisasiCabangSesi','penggunaBolehKelolaRekening_','perbaruiTandaTransferGaji_','jadwalkanResetTransferGaji_','muatStatusTransferGaji_','pulihkanStatusTransferGaji_','buatTandaTransferGaji_']) {
  const start=html.indexOf('function '+name+'('),end=html.indexOf('\n        }',start)+10;assert(start>=0,name);
  vm.runInContext((['muatStatusTransferGaji_','pulihkanStatusTransferGaji_'].includes(name)?'async ':'')+html.slice(start,end),c);
 }
 const row=new Element('tr'),cell=new Element('td');
 const render=()=>{c.buatTandaTransferGaji_(employee,row,cell);return cell.children[1].children[0];};
 return {c,period,hint,timers,calls,toasts,records,row,cell,render,advance:ms=>{clock+=ms;},response};
}
test('Marking salary highlights employee name and persists across page reload',async()=>{
 const h=uiHarness();await h.c.muatStatusTransferGaji_('2026-09');const checkbox=h.render();assert.equal(checkbox.checked,false);
 checkbox.checked=true;await checkbox.emit('change');assert.equal(checkbox.checked,true);assert.equal(h.cell.children[0].classes.has('payroll-name-paid'),true);
 const again=uiHarness({records:h.records});await again.c.muatStatusTransferGaji_('2026-09');assert.equal(again.render().checked,true);
 checkbox.checked=false;await checkbox.emit('change');assert.equal(checkbox.checked,false);assert.equal(h.row.classes.has('payroll-transfer-paid'),false);
});
test('Salary months are isolated and the old period cannot be written after filter change',async()=>{
 const h=uiHarness();await h.c.muatStatusTransferGaji_('2026-09');const checkbox=h.render();checkbox.checked=true;await checkbox.emit('change');
 h.period.value='2026-10';checkbox.checked=true;await checkbox.emit('change');assert.equal(h.calls.filter(p=>p.action==='simpanStatusTransferGaji').length,1);
 await h.c.muatStatusTransferGaji_('2026-10');assert.equal(checkbox.checked,false);
 h.period.value='2026-09';await h.c.muatStatusTransferGaji_('2026-09');assert.equal(checkbox.checked,true);
});
test('Open page resets at midnight WITA on 29 and an application opened afterwards starts unmarked',async()=>{
 const h=uiHarness();await h.c.muatStatusTransferGaji_('2026-09');const checkbox=h.render();checkbox.checked=true;await checkbox.emit('change');
 const timer=[...h.timers.values()].at(-1);assert.equal(timer.ms,1050);h.advance(1100);timer.fn();await new Promise(setImmediate);
 assert.equal(checkbox.checked,false);assert.equal(h.row.classes.has('payroll-transfer-paid'),false);
 assert.equal(h.records.size,1); // Historical marks remain saved, while the new cycle starts empty.
 const reopened=uiHarness({records:h.records,now:cutoff+5000});await reopened.c.muatStatusTransferGaji_('2026-09');assert.equal(reopened.render().checked,false);
});
test('Clicking a stale checkbox after reset reloads current cycle without writing old status',async()=>{
 const h=uiHarness();await h.c.muatStatusTransferGaji_('2026-09');const checkbox=h.render();h.advance(2000);checkbox.checked=true;await checkbox.emit('change');
 assert.equal(checkbox.checked,false);assert.equal(h.calls.filter(p=>p.action==='simpanStatusTransferGaji').length,0);
});
test('Failed save refreshes real stored state, and failed reads disable transfer controls',async()=>{
 const h=uiHarness();await h.c.muatStatusTransferGaji_('2026-09');const checkbox=h.render();
 const read=h.c.fetchJsonDenganTimeout_;h.c.fetchJsonDenganTimeout_=async(url,payload)=>payload.action==='simpanStatusTransferGaji'?Promise.reject(Error('Network error')):read(url,payload);
 checkbox.checked=true;await checkbox.emit('change');assert.equal(checkbox.checked,false);assert.equal(checkbox.disabled,false);
 h.c.fetchJsonDenganTimeout_=async()=>{throw Error('Database unavailable');};await h.c.pulihkanStatusTransferGaji_();assert.equal(checkbox.disabled,true);assert.equal(h.cell.children[1].children[1].textContent,'Status belum termuat');
});
test('Concurrent change reloads latest status and duplicate clicks cannot submit twice',async()=>{
 const h=uiHarness();await h.c.muatStatusTransferGaji_('2026-09');const checkbox=h.render();
 h.records.set('2026-09-29_2026-09_worker-kendari',{cycle:'2026-09-29',period:'2026-09',username:employee.Username,paid:true});
 checkbox.checked=true;await checkbox.emit('change');assert.equal(checkbox.checked,true);
 let release;h.c.fetchJsonDenganTimeout_=async()=>new Promise(resolve=>{release=resolve;});checkbox.checked=false;const pending=checkbox.emit('change');assert.equal(checkbox.disabled,true);
 await checkbox.emit('change');release({status:'sukses',periode:'2026-09',siklus:'2026-09-29',data:{username:employee.Username,sudahTransfer:false}});await pending;assert.equal(checkbox.checked,false);assert.equal(checkbox.disabled,false);
});
