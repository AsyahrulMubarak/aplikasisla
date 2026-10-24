import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,POLICY} from '../supabase/functions/sla-performance-credit/engine.mjs';
const at='2026-11-01T00:00:00+08:00';
function fixture(){
 const tickets=[],warranties=[],episodes=[],decisions={};
 for(let n=1;n<=40;n++){
  const id='TKT-'+n,finished='2026-10-05T10:00:00+08:00',deadline=n<=32?'2026-10-06T17:00:00+08:00':'2026-10-04T17:00:00+08:00';
  tickets.push({id_tiket:id,teknisi:'Teknisi A, Teknisi B',status:'Selesai',waktu_lapor:'2026-10-02T08:00:00+08:00',waktu_penugasan:'2026-10-02T08:00:00+08:00',waktu_selesai:finished,tenggat_waktu:deadline,tenggat_respon:'2026-10-02T12:00:00+08:00',waktu_respon:n<=36?'2026-10-02T09:00:00+08:00':'2026-10-02T13:00:00+08:00',penilaian_teknisi:{achievement:{grade:'D',points:1,completedAt:finished,members:[{username:'tech',name:'Teknisi A',share:54},{username:'tech2',name:'Teknisi B',share:46}]}}});
  warranties.push({id_garansi:'G-'+n,referensi_tiket_nota:id,tanggal_mulai:finished,tanggal_habis:'2026-11-05T10:00:00+08:00'});
  if(n<=4){tickets.at(-1).keterangan='Pending';decisions['T:'+id]={outcome:'fault',note:'Persiapan alat tidak lengkap',root:'pending-'+n};}
  if(n>=5&&n<=6){tickets.push({id_tiket:'CLAIM-'+n,garansi_asal:'G-'+n,teknisi:'Teknisi Lain',status:'Selesai',waktu_lapor:'2026-10-15T08:00:00+08:00'});decisions['G:'+id]={outcome:'fault',note:'Pemasangan terbukti bermasalah',root:'warranty-'+n};}
  if(n>=7&&n<=14){const waktu='2026-10-03T08:00:00+08:00';tickets.find(t=>t.id_tiket===id).riwayat_penggantian_teknisi=[{dari:'Teknisi A',ke:'Teknisi B',waktu}];episodes.push({id:n,id_tiket:id,teknisi:'Teknisi A',pengganti:'Teknisi B',waktu_pergantian:waktu});decisions['U:'+id]={outcome:'fault',note:'Tidak menyelesaikan tanggung jawab',root:'replacement-'+n};}
 }
 return {source:{period:'2026-10',profile:{username:'tech',name:'Teknisi A',role:'teknisi'},tickets,warranties,episodes},input:{effectiveDays:26,targetReason:'Satu hari tugas nonteknis disetujui manajemen',decisions}};
}
test('agreed example: grade 21.6/27, response 90, work 80, first time 90, warranty 95, stable 80 = 83.5',()=>{
 const f=fixture(),r=calculate(f.source,f.input,at);
 assert.equal(POLICY.version,3);assert.equal(Object.values(POLICY.weights).reduce((a,b)=>a+b,0),1);
 assert.equal(r.achieved,21.6);assert.equal(r.target,27);
 assert.deepEqual(r.values,{P:80,K:80,R:90,T:90,G:95,U:80});
 assert.deepEqual(r.contributions,{P:40,K:12,R:9,T:9,G:9.5,U:4});assert.equal(r.score,83.5);assert.equal(r.pass,true);
});
test('raw grade survives late SLA and unpaid jobs; extra branch work and money cannot change achievement',()=>{
 const f=fixture(),before=calculate(f.source,f.input,at);
 for(const t of f.source.tickets){t.bobot_poin=999;t.poin_performa=999;t.status_pembayaran='Belum Lunas';t.veto_admin='Tidak';}
 f.source.tickets.push({id_tiket:'OTHER',teknisi:'Teknisi Lain',status:'Selesai',waktu_selesai:'2026-10-10T10:00:00+08:00'});
 assert.deepEqual(calculate(f.source,f.input,at),before);
 f.source.tickets.filter(t=>t.teknisi==='Teknisi A, Teknisi B').forEach(t=>t.tenggat_waktu='2026-10-04T08:00:00+08:00');
 const late=calculate(f.source,f.input,at);assert.equal(late.achieved,21.6);assert.equal(late.contributions.P,40);assert.equal(late.values.K,0);assert.equal(late.pass,false);
});
test('future deadlines are in progress, answered or completed jobs count immediately, expired active jobs fail',()=>{
 const f=fixture();f.source.tickets=[{id_tiket:'ACTIVE',teknisi:'Teknisi A',status:'On Progress',waktu_penugasan:'2026-10-20T08:00:00+08:00',tenggat_waktu:'2026-10-25T12:00:00+08:00',tenggat_respon:'2026-10-24T12:00:00+08:00'}];f.source.episodes=[];f.source.warranties=[];
 let r=calculate(f.source,{},'2026-10-24T10:00:00+08:00');assert.equal(r.values.K,null);assert.equal(r.values.R,null);assert.equal(r.score,null);
 r=calculate(f.source,{},'2026-10-24T13:00:00+08:00');assert.equal(r.values.R,0);assert.equal(r.values.K,null);
 f.source.tickets[0].waktu_respon='2026-10-24T11:00:00+08:00';r=calculate(f.source,{},'2026-10-24T11:30:00+08:00');assert.equal(r.values.R,100);
 r=calculate(f.source,{},'2026-10-26T10:00:00+08:00');assert.equal(r.values.K,0);
 f.source.tickets[0].status='Pending';f.source.tickets[0].sla_jeda_sisa_detik=100;r=calculate(f.source,{},at);assert.equal(r.values.K,null);
 f.source.tickets[0].sla_jeda_sisa_detik=-1;r=calculate(f.source,{},at);assert.equal(r.values.K,0);
});
test('quality review and sample coverage are mandatory; externally caused cases do not deduct',()=>{
 const f=fixture();let r=calculate(f.source,{},at);assert.equal(r.complete,false);assert.equal(r.pass,false);assert.match(r.reasons.join(' '),/belum ditinjau/);
 for(const decision of Object.values(f.input.decisions))decision.outcome='exempt';r=calculate(f.source,f.input,at);assert.deepEqual([r.values.T,r.values.G,r.values.U],[100,100,100]);
 f.source.warranties=[];for(const key of Object.keys(f.input.decisions))if(key.startsWith('G:'))delete f.input.decisions[key];r=calculate(f.source,f.input,at);assert.equal(r.values.G,null);assert.equal(r.score,null);assert.equal(r.pass,false);
});
