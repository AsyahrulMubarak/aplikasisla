const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../lobby-credit.js','utf8');
class Node{constructor(tag='div'){this.tag=tag;this.children=[];this.style={};this.attrs={};this.hidden=false;this.textContent='';this.isConnected=true;}append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}addEventListener(){}}
function harness(fetcher=async()=>Response.json({status:'sukses',period:'2026-11',rows:[]})){
 const fields=new Map(),get=id=>{if(!fields.has(id))fields.set(id,new Node());return fields.get(id);};get('main-lobby-wrapper').attrs['aria-hidden']='true';
 const c=vm.createContext({console,Intl,Date,Number,String,Math,Error,JSON,AbortController,setTimeout,clearTimeout,setInterval(){},requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){}},
  penggunaAktif:{Username:'juna',Role:'sales',Hak_Akses_Cabang:'Kendari'},SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'public',pastikanTokenSupabaseAktif_:async()=>'test.jwt.token',fetch:fetcher,
  window:{addEventListener(){},open(){}},document:{hidden:false,getElementById:get,createElement:tag=>new Node(tag),addEventListener(){}}});
 vm.runInContext(source,c);return {c,get,api:c.window.SLACreditLobby};
}
const row={username:'juna',name:'Juna <script>',role:'sales',branch:'Kendari',programStart:'2026-11',programFinished:false,attendance:{late:1,absent:0,lateLimit:3,absentLimit:2,eligible:true,potentialCredit:1},achievement:{achieved:125,target:500,percent:25,unit:'rupiah',official:true,potentialCredit:0,complete:true,sales:{conversion:40,conversionTarget:60,countedFollowups:16,requiredFollowups:208}}};
const walk=n=>[n,...n.children.filter(c=>c instanceof Node).flatMap(walk)];
test('attendance uses criterion cards, achievement starts at zero and displays actual earned progress safely',()=>{
 const h=harness();h.api.render({period:'2026-11',rows:[row]});const nodes=walk(h.get('lobby-credit-list'));
 assert.equal(nodes.filter(n=>n.attrs.role==='progressbar').length,1,'no attendance bar');
 assert.equal(nodes.find(n=>n.className==='credit-fill').style.width,'25%');
 assert.ok(nodes.some(n=>n.textContent==='1 / 3'));assert.ok(nodes.some(n=>n.textContent==='0 / 2'));assert.ok(nodes.some(n=>n.textContent==='Juna <script>'));
 h.api.render({period:'2026-11',rows:[{...row,achievement:{...row.achievement,achieved:0,percent:0}}]});assert.equal(walk(h.get('lobby-credit-list')).find(n=>n.className==='credit-fill').style.width,'0%');
});
test('logout and account changes clear private cards and discard a late prior response',async()=>{
 let resolve,started;const ready=new Promise(r=>started=r);const h=harness(()=>{started();return new Promise(r=>resolve=r);});h.get('main-lobby-wrapper').attrs['aria-hidden']='false';h.get('main-lobby-wrapper').style.display='flex';
 const pending=h.api.refresh();await ready;
 h.c.penggunaAktif={Username:'ardan',Role:'sales',Hak_Akses_Cabang:'Raha'};h.api.clear();
 resolve(Response.json({status:'sukses',period:'2026-11',rows:[row]}));await pending;
 assert.equal(h.get('lobby-credit-list').children.length,0);assert.equal(h.get('lobby-credit-panel').hidden,true);
});
