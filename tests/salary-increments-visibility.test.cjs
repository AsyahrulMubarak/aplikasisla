const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync(__dirname+'/../slipgaji.html','utf8');
function extract(name){const m=html.match(new RegExp('^([ \\t]*)(?:async )?function '+name+'\\([^]*?^\\1\\}','m'));assert.ok(m,name);return m[0];}
function harness(){
 const element=()=>({hidden:true,style:{},replaceChildren(){},appendChild(){}}),fields=new Map();
 const c=vm.createContext({cabangAktif:'Kendari',formatRp:n=>'Rp '+n,document:{
  getElementById:id=>{if(!fields.has(id))fields.set(id,element());return fields.get(id);},createElement:element}});
 vm.runInContext(['normalisasiCabangSesi','renderProgramGaji_'].map(extract).join('\n'),c);
 return {c,panel:()=>fields.get('salary-progress'),fields};
}
const program={gajiSekarang:2000000,bulanTerkumpul:0,evaluasi:[],riwayat:[]};
test('Programme stays hidden for Raha with cached programme data and when changing employees',()=>{
 const {c,panel}=harness();
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':program});assert.equal(panel().hidden,false);
 for(const profile of [{Hak_Akses_Cabang:'Raha'},{Hak_Akses_Cabang:' raha '},{Hak_Akses_Cabang:'Semua',Cabang:'Raha'},{hak_akses_cabang:'Raha',cabang:'Kendari'}]){
  c.renderProgramGaji_({...profile,'Program Gaji':program});assert.equal(panel().hidden,true);
 }
 c.cabangAktif='Raha';c.renderProgramGaji_({'Program Gaji':program});assert.equal(panel().hidden,true);
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':program});assert.equal(panel().hidden,false);
});
test('Server ineligibility and absent programme hide the panel; Kendari retains progress',()=>{
 const {c,panel,fields}=harness();
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':{...program,bulanTerkumpul:3,berlakuOtomatis:true}});
 assert.equal(panel().hidden,false);assert.equal(fields.get('salary-progress-count').textContent,'3 / 6 bulan');
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':{...program,berlakuOtomatis:false}});assert.equal(panel().hidden,true);
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':null});assert.equal(panel().hidden,true);
});

test('Current zero salary hides cached programme progress and historical positive salary',()=>{
 const {c,panel}=harness();
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Gaji Pokok Saat Ini':1500000,'Program Gaji':program});assert.equal(panel().hidden,false);
 for(const profile of [{'Gaji Pokok Saat Ini':0,'Gaji Pokok':1500000},{gaji_pokok:0},{'Program Gaji':{...program,gajiSekarang:0}}]){
  c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':program,...profile});assert.equal(panel().hidden,true);
 }
 c.renderProgramGaji_({Hak_Akses_Cabang:'Kendari','Program Gaji':{...program,gajiSekarang:3000000,selesai:true}});assert.equal(panel().hidden,false);
});
