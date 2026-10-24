const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../tmp/sales-claims-qa/node_modules/@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261024010738_direct_sale_buyer_whatsapp.sql'), 'utf8');

test('nomor WA penjualan disimpan dan divalidasi tanpa menghapus data lama', async () => {
  const db = new PGlite();
  try {
    await db.exec("create table penjualan(id_penjualan text primary key,nama_pembeli text);insert into penjualan values('OLD','Pembeli Lama');");
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query("select no_wa_pembeli from penjualan where id_penjualan='OLD'")).rows[0].no_wa_pembeli, null);
    await db.query('insert into penjualan values($1,$2,$3)', ['NEW', 'Pembeli Baru', '6281234567890']);
    assert.equal((await db.query("select no_wa_pembeli from penjualan where id_penjualan='NEW'")).rows[0].no_wa_pembeli, '6281234567890');
    for (const phone of ['', '081234567890', '62812', '<script>']) {
      await assert.rejects(db.query('insert into penjualan values($1,$2,$3)', ['INVALID', 'Pembeli', phone]), /penjualan_no_wa_pembeli_valid/);
    }
    assert.equal((await db.query('select count(*)::int total from penjualan')).rows[0].total, 2);
  } finally { await db.close(); }
});
