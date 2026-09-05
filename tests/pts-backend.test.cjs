const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const source = ['Code.gs','Data.gs'].map(file=>fs.readFileSync(path.join(__dirname,'../server/pts',file),'utf8')).join('\n');
const secret = 'a'.repeat(64);
const databaseId = 'test_only_pts_spreadsheet_123456';
const actor = {id:'10101010-1010-4010-8010-101010101010',username:'Test User',fullname:'Test',role:'manager'};
const headers = ['ID','Title','Opex','Salary','Reserve','Profit','HppPct','MarketingCount','SalesRatio','TotalSales','SalesTarget','PerMarketingTarget','WalkinTarget','CreatedBy','CreatedAt','OpexPct','ProfitPct','FixedCostPct'];
class Sheet {
  constructor(name,rows=[]) {this.name=name;this.rows=rows;this.failWrites=false;this.failDeletes=false;}
  getLastRow(){return this.rows.length;}
  getLastColumn(){return Math.max(0,...this.rows.map(row=>row.length));}
  appendRow(row){if(this.failWrites)throw Error('simulated write failure');this.rows.push([...row]);}
  deleteRow(row){if(this.failDeletes)throw Error('simulated delete failure');this.rows.splice(row-1,1);}
  getDataRange(){return {getValues:()=>this.rows.map(row=>[...row])};}
  getRange(row,col,height=1,width=1){return {
    getValues:()=>Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>this.rows[row-1+r]?.[col-1+c]??'')),
    setValues:values=>{if(this.failWrites)throw Error('simulated write failure');values.forEach((cells,r)=>{this.rows[row-1+r]||=[];cells.forEach((value,c)=>{this.rows[row-1+r][col-1+c]=value;});});}
  };}
}
function fixture(){
  const tables = new Map();
  tables.set('Users',new Sheet('Users',[['do not change'],['existing local account']]));
  tables.set('TargetScenarios',new Sheet('TargetScenarios',[[...headers],['SCN-12345678','Legacy',1,2,3,4,50,1,50,100,50,50,50,'legacy-admin','2026-01-01',1,4,2]]));
  const ss = {getSheetByName:name=>tables.get(name),insertSheet:name=>{const sheet=new Sheet(name);tables.set(name,sheet);return sheet;}};
  const props = new Map([['PTS_BRIDGE_SECRET',secret],['PTS_SPREADSHEET_ID',databaseId]]);
  let opened=0;
  const signedBytes=buffer=>Array.from(buffer,b=>b>127?b-256:b);
  const c=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)||null,setProperty:(key,val)=>props.set(key,val)})},
    SpreadsheetApp:{openById:id=>{assert.equal(id,databaseId);opened++;return ss;},getActiveSpreadsheet:()=>{throw Error('forbidden active spreadsheet');},flush(){}},
    Session:{getScriptTimeZone:()=> 'Asia/Makassar'},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    Utilities:{Charset:{UTF_8:'UTF-8'},DigestAlgorithm:{SHA_256:'SHA-256'},getUuid:()=>crypto.randomUUID(),
      computeHmacSha256Signature:(text,key)=>signedBytes(crypto.createHmac('sha256',key).update(text).digest()),
      computeDigest:(_,text)=>signedBytes(crypto.createHash('sha256').update(text).digest()),formatDate:()=> '2026-09-05 12:00:00'},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType(){return text;}})}
  });
  vm.runInContext(source,c);
  function envelope(action,payload={},requestId=crypto.randomUUID(),custom={}){
    const body=JSON.stringify({audience:'pts-v1',action,actor,requestId,payload,...custom});
    const timestamp=Date.now(),nonce=crypto.randomUUID();
    return {timestamp,nonce,body,signature:crypto.createHmac('sha256',secret).update(`${timestamp}.${nonce}.${body}`).digest('hex')};
  }
  const post=env=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(env)}}));
  const call=(action,payload,id,custom)=>post(envelope(action,payload,id,custom));
  c.setupDatabase_(); // Fixture preparation only; no live services.
  return {c,tables,props,envelope,post,call,get opened(){return opened;}};
}
test('the only public Apps Script functions are HTTP entry points',()=>{
  const publicNames=[...source.matchAll(/^function\s+(\w+)\(/gm)].map(m=>m[1]).filter(n=>!n.endsWith('_'));
  assert.deepEqual(publicNames,['doGet','doPost']);
  assert.doesNotMatch(source,/function loginUser|saveSessionRecord|PasswordHash|Admin@|getActiveSpreadsheet\(/);
});
test('unsigned browser requests are rejected without touching the database',()=>{
  const f=fixture(),before=f.opened;
  assert.equal(f.post({action:'getScenarios',user:{role:'Admin'}}).success,false);
  assert.equal(f.opened,before);
});
test('signatures reject tampering, expiration, replay and non-management actors',()=>{
  const f=fixture();const e=f.envelope('session');
  assert.equal(f.post(e).success,true);assert.equal(f.post(e).success,false);
  const tampered=f.envelope('session');tampered.body+=' ';
  assert.equal(f.post(tampered).success,false);
  const expired=f.envelope('session');expired.timestamp-=300000;
  expired.signature=crypto.createHmac('sha256',secret).update(`${expired.timestamp}.${expired.nonce}.${expired.body}`).digest('hex');
  assert.equal(f.post(expired).success,false);
  assert.equal(f.call('session',{},undefined,{actor:{...actor,role:'teknisi'}}).success,false);
});
test('legacy scenarios remain readable and the Users sheet is never changed',()=>{
  const f=fixture();const users=JSON.stringify(f.tables.get('Users').rows);
  assert.equal(f.call('getScenarios').data[0].createdBy,'legacy-admin');
  assert.equal(f.call('saveScenario',{title:'New',salary:100}).success,true);
  assert.equal(JSON.stringify(f.tables.get('Users').rows),users);
  assert.equal(f.call('getScenarios').data.length,2);
});
test('database ID and header checks fail closed before operations',()=>{
  const f=fixture();f.props.delete('PTS_SPREADSHEET_ID');
  assert.equal(f.call('session').code,'CONFIGURATION');
  const g=fixture();g.tables.get('TargetScenarios').rows[0][0]='SLA Ticket';
  assert.equal(g.call('saveScenario',{title:'Must not save'}).code,'CONFIGURATION');
  assert.equal(g.tables.get('TargetScenarios').rows.length,2);
});
test('a repeated save request creates one scenario; changed payload conflicts',()=>{
  const f=fixture(),id=crypto.randomUUID(),payload={title:'Once',salesTargetAllocation:[{name:'Sales A',target:100}],salesRealizations:[{name:'Sales A',target:100,realisasi:150}],commissionSummary:{totalReal:150}};
  assert.equal(f.call('saveScenario',payload,id).success,true);
  assert.equal(f.call('saveScenario',payload,id).success,true);
  assert.equal(f.tables.get('TargetScenarios').rows.length,3);
  assert.equal(f.tables.get('TargetSalesAllocations').rows.length,2);
  assert.equal(f.call('saveScenario',{...payload,title:'Changed'},id).code,'CONFLICT');
});
test('a partial save stays hidden; retry repairs it without duplicates',()=>{
  const f=fixture(),id=crypto.randomUUID(),payload={title:'Retry me',salesTargetAllocation:[{name:'A',target:10}]};
  f.tables.get('TargetSalesAllocations').failWrites=true;
  assert.equal(f.call('saveScenario',payload,id).code,'RETRY');
  assert.equal(f.call('getScenarios').data.length,1);
  f.tables.get('TargetSalesAllocations').failWrites=false;
  assert.equal(f.call('saveScenario',payload,id).success,true);
  assert.equal(f.call('getScenarios').data.length,2);
  assert.equal(f.tables.get('TargetScenarios').rows.length,3);
});
test('delete retry finishes child cleanup and remains idempotent',()=>{
  const f=fixture();f.call('saveScenario',{title:'Delete me',salesTargetAllocation:[{name:'A',target:10}]});
  const id=f.tables.get('TargetScenarios').rows.at(-1)[0],rid=crypto.randomUUID();
  f.tables.get('TargetSalesAllocations').failDeletes=true;
  assert.equal(f.call('deleteScenario',{scenarioId:id},rid).code,'RETRY');
  f.tables.get('TargetSalesAllocations').failDeletes=false;
  assert.equal(f.call('deleteScenario',{scenarioId:id},rid).success,true);
  assert.equal(f.call('deleteScenario',{scenarioId:id},rid).success,true);
  assert.equal(f.tables.get('TargetScenarios').rows.length,2);
  assert.equal(f.tables.get('TargetSalesAllocations').rows.length,1);
});
test('text formulas are escaped and invalid numbers denied without changing valid negative reserves',()=>{
  const f=fixture();
  assert.equal(f.call('saveScenario',{title:'=1+1',reserve:-10,remainingSalesTarget:-10}).success,true);
  assert.equal(f.tables.get('TargetScenarios').rows.at(-1)[1],"'=1+1");
  assert.equal(f.tables.get('TargetScenarios').rows.at(-1)[4],-10);
  assert.equal(f.call('saveScenario',{title:'Actor text'},undefined,{actor:{...actor,username:'=1+1'}}).success,true);
  assert.equal(f.tables.get('TargetScenarios').rows.at(-1)[13],"'=1+1");
  assert.equal(f.call('saveScenario',{title:'No',hppPct:150}).code,'INVALID_PAYLOAD');
  assert.equal(f.call('saveScenario',{title:'No',salary:-1}).code,'INVALID_PAYLOAD');
});
