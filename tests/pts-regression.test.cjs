const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const baseline=require('./fixtures/pts-baseline.json');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
const portal=read('index.html'),pts=read('pts.html');
function extract(text,name,indent){
 const match=text.match(new RegExp(`^${' '.repeat(indent)}(?:async )?function ${name}\\([^]*?^${' '.repeat(indent)}\\}`,'m'));
 assert.ok(match,`Function ${name} exists`);return match[0];
}
test('SLA login, passkey, refresh, session contract, and module routing are unchanged',()=>{
 for(const [name,expected] of Object.entries(baseline.portalFunctions))assert.equal(hash(extract(portal,name,8)),expected,name);
});
test('attendance, payroll, service worker and manifest match the production baseline byte for byte',()=>{
 for(const [file,expected] of Object.entries(baseline.existingFiles))assert.equal(hash(fs.readFileSync(path.join(root,file))),expected,file);
});
test('PTS target, cumulative bonuses, commissions, and payload calculations are unchanged',()=>{
 for(const [name,expected] of Object.entries(baseline.ptsFunctions))assert.equal(hash(extract(pts,name,12)),expected,name);
});
test('all browser inline scripts parse and PTS has no alternate login or GAS browser calls',()=>{
 for(const [file,text] of [['index.html',portal],['pts.html',pts],['absen.html',read('absen.html')],['slipgaji.html',read('slipgaji.html')]]){
  for(const [i,m] of [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries())if(m[1].trim())new vm.Script(m[1],{filename:`${file}:${i}`});
 }
 assert.doesNotMatch(pts,/type="password"|loginUser|google\.script\.run|gas_session_token|localStorage\.clear/);
 assert.match(pts,/window\.location\.replace\('index.html'\)/);
 assert.match(portal,/roleAdalahManajemenUtama_\(\) \? 'block' : 'none'/);
});
test('cumulative bonus thresholds retain the original behavior',()=>{
 const fn=vm.runInNewContext(`(${extract(pts,'calculateTieredBonus',12).trim()})`);
 const rules=[{name:'L1',targetPct:100,type:'fixed',amount:10},{name:'L2',targetPct:120,type:'percentage',ratePct:10},{name:'L3',targetPct:150,type:'percentage',ratePct:20}];
 assert.equal(fn(99,100,rules).bonus,0);
 assert.equal(fn(100,100,rules).bonus,10);
 assert.equal(fn(120,100,rules).bonus,12);
 assert.equal(fn(150,100,rules).bonus,25);
 assert.equal(fn(0,0,rules).bonus,0);
});
test('target calculations preserve original default totals and allocations',()=>{
 const fields={inpRevenueTarget:'193.923.246',inpSalary:'40.553.315',inpHpp:'64,7',inpOpexPct:'10,3',inpProfitPct:'3,7',inpMarketing:'5',inpRatio:'70'};
 const elements=new Map();
 const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:fields[id]||'',classList:{toggle(){}}});return elements.get(id);}};
 const c=vm.createContext({document,parseRupiah:value=>Number(String(value).replace(/\D/g,'')),parseDecimalInput:value=>Number(value.replace(',','.')),
  formatPercentDisplay:value=>String(value),formatRupiah:String,formatCurrencyDisplay:String,currentCalculation:{},syncSalesTargetAllocationTable(){},updateCharts(){},syncCommissionTableWithPlanner(){}});
 vm.runInContext(extract(pts,'calculateTarget',12)+'\ncalculateTarget();',c);
 assert.equal(c.currentCalculation.totalSales,193923246);
 assert.ok(Math.abs(c.currentCalculation.salesTarget-193923246*.7)<1e-6);
 assert.ok(Math.abs(c.currentCalculation.perMarketingTarget-193923246*.7/5)<1e-6);
 assert.ok(Math.abs(c.currentCalculation.reserve-(193923246*(1-.647-.103-.037)-40553315))<1e-6);
});
test('public build contains only allowlisted assets and preserves legacy bytes',()=>{
 require('../scripts/build-public.cjs');
 function list(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?list(path.join(dir,entry.name)):path.relative(path.join(root,'public'),path.join(dir,entry.name)).replace(/\\/g,'/'));}
 const files=list(path.join(root,'public')).sort();
 assert.deepEqual(files,['absen.html','assets/pts-session.js','depan_001.png','index.html','manifest.json','pts.html','slipgaji.html','sw.js'].sort());
 for(const [file,expected] of Object.entries(baseline.existingFiles))assert.equal(hash(fs.readFileSync(path.join(root,'public',file))),expected,file);
 assert.ok(!files.some(f=>/server|lib|test|\.env|\.gs$/.test(f)));
});
