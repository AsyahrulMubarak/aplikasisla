const {test}=require('node:test'),assert=require('node:assert/strict'),{accountFixture}=require('../maintenance/account-access-test-fixture.cjs');
test('disable/reactivate preserves identity and all financial/ticket history; old and refreshed sessions stay denied',async()=>{
 const f=await accountFixture();try{
  const before=await f.history();assert.equal((await f.as('worker','select sla_assert_account_session() ok')).rows[0].ok,true);
  await f.begin();assert.equal((await f.user()).account_active,false);assert.equal((await f.user()).account_sync_pending,true);
  await assert.rejects(f.as('worker','select sla_assert_account_session()'),/Akun nonaktif/);
  await assert.rejects(f.as('worker','select sla_account_pre_request()'),/Akun nonaktif/);
  for(const table of ['users','tiket','payroll_bulanan','sla_gaji_kredit','storage.objects'])assert.equal((await f.as('worker','select * from '+table)).rows.length,0);
  assert.equal((await f.as('worker',"update tiket set status='Cancel' where id_tiket='TKT-OLD' returning *")).rows.length,0);
  await f.finish();assert.equal((await f.user()).account_active,false);
  await f.begin('admin','worker',true,1,'Bekerja kembali');await f.finish('worker',2);
  await assert.rejects(f.as('worker','select sla_assert_account_session()'),/Akun nonaktif/,'old session stays denied even after JWT refresh');
  const fresh='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await f.db.query('insert into auth.sessions values($1,$2,clock_timestamp()+interval \'1 second\',null)',[fresh,f.ids.worker]);
  assert.equal((await f.as('worker','select sla_assert_account_session() ok',[],fresh)).rows[0].ok,true);
  assert.deepEqual(await f.history(),before);
  assert.equal((await f.db.query('select count(*) n from sla_account_access_audit')).rows[0].n,4);
 }finally{await f.db.close()}
});
test('role, scope, self-deactivation, stale versions, last central admin and pending operations are protected',async()=>{
 const f=await accountFixture();try{
  for(const args of [['worker','admin'],['raha','worker'],['admin','central'],['admin','admin']])await assert.rejects(f.begin(...args));
  await assert.rejects(f.begin('central','central'),/sendiri/);
  await assert.rejects(f.begin('admin','worker',false,9),/berubah/);
  await assert.rejects(f.begin('admin','worker',false,0,''),/alasan/);
  // A second central admin is required to disable a central admin.
  await f.db.exec("update users set hak_akses_cabang='Semua' where username='admin'");
  await f.begin('central','admin');await f.finish('admin',1,'central');
  await f.db.exec("update users set hak_akses_cabang='Semua' where username='raha';update users set role='admin' where username='raha'");
  await f.begin('raha','central');await f.finish('central',1,'raha');
  await assert.rejects(f.begin('raha','raha'),/sendiri/);
  await f.db.exec("update users set role='admin_raha',hak_akses_cabang='Raha' where username='raha';update users set account_active=true where username='admin'");
  await assert.rejects(f.begin('raha','raha'),/sendiri/);
  await f.begin('raha','workerRaha');const retry=await f.begin('raha','workerRaha',false,1,'Coba ulang');assert.equal(retry.version,1);
  await assert.rejects(f.begin('raha','workerRaha',true,1,'Aktifkan ulang'),/sinkronisasi/);
  await assert.rejects(f.finish('workerRaha',0,'raha'),/berubah/);
  await f.finish('workerRaha',1,'raha');assert.equal((await f.user('workerRaha')).account_active,false);
  await assert.rejects(f.as('worker','select sla_begin_account_access($1,$2,false,0,$3)',[f.ids.worker,'admin','forged']),/permission denied/);
  await assert.rejects(f.as('worker','select * from sla_account_access_audit'),/permission denied/);
 }finally{await f.db.close()}
});

