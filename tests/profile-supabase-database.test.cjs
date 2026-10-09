const assert=require('node:assert/strict'), fs=require('node:fs');
const {test}=require('node:test');
const {PGlite}=require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const sql=fs.readFileSync(__dirname+'/../maintenance/profile-supabase.sql','utf8');
test('Reset audit is private, cooldown is durable, notification leases and branch completion are enforced',async()=>{
  const db=new PGlite();try{
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;"+
      "create table users(username text primary key,username_login text unique,nama_asli text,role text,hak_akses_cabang text,cabang text,no_wa text,auth_id uuid);"+
      "insert into users values('admin','admin','Admin','admin','Semua',null,'081200000000','11111111-1111-4111-8111-111111111111'),"+
      "('admin raha','adminraha','Admin Raha','admin_raha','Raha',null,'081211111111','22222222-2222-4222-8222-222222222222'),"+
      "('worker','worker','Worker','teknisi','Kendari',null,'','33333333-3333-4333-8333-333333333333'),"+
      "('raha','raha','Worker Raha','teknisi','Raha',null,'','44444444-4444-4444-8444-444444444444');");
    await db.exec(sql);
    for(const role of ['anon','authenticated']){
      await db.exec('set role '+role);
      await assert.rejects(db.query('select * from sla_password_reset_requests'),/permission denied/);
      await assert.rejects(db.query('select sla_request_password_reset($1,$2)',['worker','a'.repeat(64)]),/permission denied/);
      await db.exec('reset role');
    }
    const request=async(user,key='a')=>(await db.query('select sla_request_password_reset($1,$2) as id',[user,key.repeat(64)])).rows[0].id;
    assert.equal(await request('unknown'),null);
    const id=await request('worker');assert.ok(id);assert.equal(await request('worker'),null);
    assert.equal((await db.query('select count(*) from sla_password_reset_requests')).rows[0].count,1);
    assert.deepEqual((await db.query('select recipient_username from sla_password_reset_notifications')).rows.map(r=>r.recipient_username),['admin']);
    const lease=(await db.query('select * from sla_lease_password_reset_notifications($1)',[id])).rows[0];
    assert.ok(lease.lease);assert.equal((await db.query('select * from sla_lease_password_reset_notifications($1)',[id])).rows.length,0);
    assert.equal((await db.query('select sla_ack_password_reset_notification($1,$2,true) as ok',[lease.id,'55555555-5555-4555-8555-555555555555'])).rows[0].ok,false);
    assert.equal((await db.query('select sla_ack_password_reset_notification($1,$2,true) as ok',[lease.id,lease.lease])).rows[0].ok,true);
    await assert.rejects(db.query('select sla_complete_password_reset($1,$2)',['worker','22222222-2222-4222-8222-222222222222']),/Cabang/);
    assert.equal((await db.query('select sla_complete_password_reset($1,$2) as n',['worker','11111111-1111-4111-8111-111111111111'])).rows[0].n,1);
    for(let i=0;i<6;i++)await request('missing'+i,'b');
    assert.equal(await request('raha','b'),null,'Six unknown probes consume the IP quota');
    const raha=await request('raha','c');assert.ok(raha);
    assert.deepEqual((await db.query('select recipient_username from sla_password_reset_notifications where request_id=$1 order by recipient_username',[raha])).rows.map(r=>r.recipient_username),['admin','admin raha']);
    assert.equal((await db.query('select sla_complete_password_reset($1,$2) as n',['raha','22222222-2222-4222-8222-222222222222'])).rows[0].n,1);
  }finally{await db.close();}
});
