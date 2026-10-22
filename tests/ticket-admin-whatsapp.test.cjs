const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('manual client WhatsApp button is admin-only, branch scoped, validates phone and never sends automatically',()=>{
 const c=vm.createContext({penggunaAktif:{Role:'admin',Hak_Akses_Cabang:'Kendari'},cabangAktif:'Kendari',rolePengguna:()=>c.penggunaAktif.Role,dataSesuaiCabangAktif_:t=>t.Cabang===c.cabangAktif});vm.runInContext(fs.readFileSync(__dirname+'/../ticket-admin-whatsapp.js','utf8'),c);
 const t={Cabang:'Kendari','No WA Klien':'0822 9204-0122'};
 assert.match(c.htmlTombolChatKlienAdmin_(t),/href="https:\/\/wa.me\/6282292040122"/);assert.match(c.htmlTombolChatKlienAdmin_(t),/noopener noreferrer/);assert.doesNotMatch(c.htmlTombolChatKlienAdmin_(t),/\?text=|onclick|relay|fetch/);
 for(const phone of ['+62 822 9204 0122','6282292040122','82292040122'])assert.match(c.htmlTombolChatKlienAdmin_({...t,'No WA Klien':phone}),/6282292040122/);
 for(const phone of ['',"javascript:alert(1)",'0812345 / 0812346','62822920401223333333333'])assert.match(c.htmlTombolChatKlienAdmin_({...t,'No WA Klien':phone}),/disabled/);
 for(const role of ['teknisi','sales','logistik','manager','direktur']){c.penggunaAktif.Role=role;assert.equal(c.htmlTombolChatKlienAdmin_(t),'')}
 c.penggunaAktif.Role='admin_raha';assert.equal(c.htmlTombolChatKlienAdmin_(t),'');c.penggunaAktif.Hak_Akses_Cabang='Raha';c.cabangAktif='Raha';assert.match(c.htmlTombolChatKlienAdmin_({...t,Cabang:'Raha'}),/Chat WA Klien/);
});
test('assigned sales get separate safe chat links; missing/ambiguous profiles and non-admins cannot open the shortcut',()=>{
 const esc=v=>String(v).replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;');
 const c=vm.createContext({penggunaAktif:{Role:'admin',Hak_Akses_Cabang:'Kendari'},cabangAktif:'Kendari',amanTeks_:esc,globalUsers:[{Username:'juna',Role:'sales','Nama Asli':'Juna','No WA':'081234567890'},{Username:'sales2',Role:'sales','Nama Asli':'Sales Kedua','No WA':'6282345678901'}],rolePengguna:()=>c.penggunaAktif.Role,dataSesuaiCabangAktif_:()=>true});vm.runInContext(fs.readFileSync(__dirname+'/../ticket-admin-whatsapp.js','utf8'),c);
 const t={Cabang:'Kendari',Sales:'Juna, Sales Kedua, Juna'},html=c.htmlTombolChatSalesAdmin_(t);assert.equal((html.match(/href=/g)||[]).length,2);assert.match(html,/6281234567890/);assert.match(html,/6282345678901/);
 c.globalUsers.push({Username:'juna2',Role:'sales','Nama Asli':'Juna','No WA':'628999999999'});assert.match(c.htmlTombolChatSalesAdmin_({...t,Sales:'Juna'}),/disabled/);
 assert.match(c.htmlTombolChatSalesAdmin_({...t,Sales:'<img onerror=alert(1)>'}),/&lt;img/);assert.match(c.htmlTombolChatSalesAdmin_({...t,Sales:'-'}),/belum ditentukan/);
 c.penggunaAktif.Role='teknisi';assert.equal(c.htmlTombolChatSalesAdmin_(t),'');
});

