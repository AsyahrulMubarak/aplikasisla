const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
function extract(name){const m=html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];}
function harness(branch='Kendari',role='admin'){
 const elements={},calls=[],toasts=[];
 const node=id=>elements[id]||(elements[id]={value:'',checked:false,style:{},disabled:false});
 const ticket={'ID Tiket':'TKT-POINTS',Status:'Selesai',Cabang:branch,'Bobot Poin':0,'Veto Admin':'Tidak','Status Pembayaran':'Poin Beku'};
 const c=vm.createContext({globalTickets:[ticket],globalGaransi:[],cabangAktif:branch,
  document:{getElementById:node},normalisasiCabang:v=>v||'',roleAdalahAdminOperasional_:()=>['admin','admin_raha'].includes(role),rolePengguna:()=>role,
  dataSesuaiCabangAktif_:r=>r.Cabang===branch,showToast:(m,t)=>toasts.push({m,t}),
  callSupabase:async(...args)=>{calls.push(args);return [{}];},endpointFilterSupabase_:(t,k,v)=>t+'?'+k+'=eq.'+v,
  pastikanHasilMutasiSupabase_:()=>{},ambilSemuaData:async()=>{}
 });
 for(const name of ['bolehEditPoinTiket_','bukaModalPoin','simpanPoinSelesai','payloadPoinTiketDibekukan_','statusPoinSudahCair_'])vm.runInContext(extract(name),c);
 return {c,ticket,node,calls,toasts,addWarranty:()=>c.globalGaransi.push({'ID Garansi':'G-1','Referensi (Tiket/Nota)':'TKT-POINTS',Cabang:branch,Status:'Masa Tunggu'})};
}
test('opening or submitting ticket points without warranty cannot write points',async()=>{
 for(const branch of ['Kendari','Raha']){
  const h=harness(branch);h.c.bukaModalPoin('TKT-POINTS');assert.notEqual(h.node('modal-poin').style.display,'flex');
  h.node('poin-id-tiket').value='TKT-POINTS';h.node('poin-nilai-input').value='100';h.node('poin-veto-input').checked=true;
  await h.c.simpanPoinSelesai({preventDefault(){}});assert.equal(h.calls.length,0);assert.match(h.toasts.at(-1).m,/menu Garansi/);
 }
});
test('warranty enables point corrections and veto, including zero, without refreezing paid tickets',async()=>{
 for(const branch of ['Kendari','Raha'])for(const paid of [false,true]){
  const h=harness(branch);h.addWarranty();if(paid)h.ticket['Status Pembayaran']='Lunas';
  h.c.bukaModalPoin('TKT-POINTS');assert.equal(h.node('modal-poin').style.display,'flex');assert.equal(h.node('poin-nilai-input').value,0);
  h.node('poin-nilai-input').value='0';h.node('poin-veto-input').checked=true;await h.c.simpanPoinSelesai({preventDefault(){}});
  assert.equal(h.calls.length,1);const payload=h.calls[0][2];assert.equal(payload.bobot_poin,0);assert.equal(payload.veto_admin,'Ya');
  assert.equal(payload.status_pembayaran,paid?undefined:'Poin Beku');
 }
});
test('cross-branch warranties, reopened tickets and technician sessions cannot enable editing',()=>{
 const h=harness();h.c.globalGaransi=[{'Referensi (Tiket/Nota)':'TKT-POINTS',Cabang:'Raha'}];assert.equal(h.c.bolehEditPoinTiket_(h.ticket),false);
 h.addWarranty();h.ticket.Status='On Progress';assert.equal(h.c.bolehEditPoinTiket_(h.ticket),false);
 const tech=harness('Raha','teknisi');tech.addWarranty();assert.equal(tech.c.bolehEditPoinTiket_(tech.ticket),false);
});
