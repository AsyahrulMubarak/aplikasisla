# Pencapaian dan kredit gaji teknisi

Perluasan 22 Oktober 2026: program pegawai Raha bergaji dimulai November; penilaian sales memakai tiga target wajib pada panel aplikasi. Lihat [Kredit November dan ringkasan lobby](november-credit-rollout-2026-10-22.md). Rumus teknisi dan pengaman sumber di bawah tetap berlaku; keterangan lama yang mengecualikan Raha/sales merupakan riwayat sebelum perluasan ini.

Mulai resmi November 2026 sesuai keputusan pengguna. Oktober tetap memakai satu kredit kehadiran dan dapat dibuka sebagai pratinjau pencapaian, tanpa kredit performa retroaktif. Program otomatis tetap mengikuti kepesertaan gaji Kendari yang sudah berjalan (termasuk profil Semua yang dipetakan ke Kendari), gaji positif di bawah Rp3.000.000, dan bulan mulai masing-masing pegawai. Raha dan pekerja tanpa gaji pokok tidak diperluas ke program ini. Sales dan peran lain tetap memakai kredit kehadiran; rancangan performa sales belum diaktifkan.

## Alur pemakaian

1. Admin menetapkan grade D=1, C=2, B=4, A=8, S=16. Teknisi tetap mengajukan untuk disetujui admin.
2. Kontribusi opsional: tanpa pengisian dibagi rata; persentase khusus yang ditetapkan/disetujui admin berlaku untuk pencapaian dan bonus. Aturan pencairan bonus lama tetap berlaku.
3. Setelah pekerjaan Selesai, BA, PIC, dan tanda tangan lengkap, admin mengesahkan hasil pencapaian pada tiket. Hasil dan kontribusi terkunci. Bulan poin mengikuti waktu selesai yang disimpan pada pengesahan, bukan bulan pelunasan atau persetujuan belakangan.
4. Buka **Rekap pencapaian & kredit** dari tiket atau bagian Kenaikan Gaji Otomatis di Slip Gaji. Admin dapat melihat teknisi dalam hak cabangnya; teknisi hanya melihat rekap sendiri. Target, poin, sumber SLA, dan kasus mutu ditampilkan. Pratinjau tidak menyimpan keputusan.
5. Admin meninjau pending/garansi/pergantian: pilih bukan kesalahan atau kesalahan terbukti, sertakan bukti/alasan. ID akar masalah yang sama tidak boleh mendapat dua penalti utama. Data ambigu, episode lama tanpa tenggat, pencapaian belum disahkan, atau aspek tanpa sampel menahan pengesahan; tidak dianggap nilai 100 maupun kesalahan pegawai.
6. Sejak tanggal 8 bulan berikutnya admin dapat mengesahkan rekap lengkap, termasuk rekap lengkap yang tidak lolos. Keputusan dihitung server dan disimpan bersama sumber, versi, pelaku, serta audit sebelum/sesudah. Admin tidak dapat mengesahkan rekap sendiri. Untuk November, pengesahan paling awal **8 Desember 2026 WITA**.
7. Satu kredit performa yang lolos dicatat, kemudian evaluasi gaji harian yang sudah ada menggabungkannya dengan kredit kehadiran. Pengesahan rekap tidak memanggil evaluasi gaji atau mengirim WA.

## Rumus dan batas

Target = 27 × hari penugasan efektif / 26. Bawaan hari kerja kalender mengecualikan Ahad. Admin menyesuaikan hari efektif untuk libur tambahan, izin/sakit penuh yang disetujui, awal kerja, atau penugasan nonteknis dengan bukti dalam catatan target. Telat/alpa tidak mengurangi target. Target tidak boleh negatif atau melebihi hari kerja bulan itu.

Skor = 30% P + 25% K + 15% R + 10% T + 10% G + 10% U. Masing-masing komponen dibatasi 0–100; tanpa denominator hasil belum lengkap, tidak dibobot ulang.

| Aspek | Dasar |
|---|---|
| P | Poin pencapaian sah / target ×100; maksimal100. Bonus, bobot rupiah, pelunasan, dan veto bonus tidak menambah P. |
| K | Pekerjaan tepat / pekerjaan dengan tenggat tersimpan pada bulan itu. Cancel dan pekerjaan yang sedang Pending/Outsource dikecualikan. Pekerjaan aktif lewat tenggat dihitung terlambat. |
| R | Respons tepat / penugasan dengan tenggat respons pada bulan itu. |
| T | 1 − tiket selesai dengan pending terbukti menjadi tanggung jawab teknisi / tiket selesai terkait. |
| G | 1 − tiket asal dengan klaim bulan itu terbukti akibat pekerjaan teknisi / tiket bergaransi dengan periode risiko beririsan bulan itu. Hitungan per tiket asal, bukan jumlah item/klaim. |
| U | 1 − tiket yang mengeluarkan teknisi karena kegagalan terbukti / tiket penugasan terkait bulan itu. Rotasi dan bantuan spesialis tidak otomatis dihukum. |

Lolos performa: skor≥80, P≥80, K≥70%, R≥80%, seluruh kasus/sumber lengkap. Kehadiran terpisah: telat pagi≤3 dan alpa≤2. Maksimal dua kredit per bulan, satu untuk setiap komponen. Bulan buruk tidak mereset kredit sebelumnya. Enam kredit dari minimal tiga bulan berbeda dipakai sekali untuk kenaikan Rp250.000, dibatasi Rp3.000.000. Kenaikan berlaku pada bulan evaluasi; slip tertutup tidak ditulis ulang.

## Pengaman dan kompatibilitas

- Tabel kredit mempunyai kunci unik pegawai–bulan–komponen dan referensi riwayat kenaikan. Kredit kehadiran lama, termasuk yang telah dipakai, dipertahankan. Evaluasi mengunjungi ulang bulan yang sudah dinilai kehadirannya agar persetujuan performa belakangan tetap terbaca.
- Sumber rekap ditandai hash. Perubahan sebelum pemakaian menahan/membatalkan reservasi kredit sampai rekap disahkan ulang. Keputusan yang sudah dipakai dikunci sebagai hasil historis dan memerlukan koreksi Manajemen tersendiri, bukan penggantian diam-diam.
- Pergantian teknisi setelah pemasangan dicatat otomatis dalam audit tambahan: penugasan lama/baru, waktu server, tenggat lama, waktu respons, penyelesaian, dan sisa jeda. Tidak mengubah handler status, riwayat lama, tenggat baru, bonus, BA, tracking, atau antrean WA. Anggota yang tetap berada di tim tidak dihitung keluar. Handover sebelum tenggat tanpa hasil akhir tidak otomatis menjadi kegagalan SLA kerja; episode yang melewati tenggat tetap tercatat.
- Episode sebelum audit ini dipasang tidak direkonstruksi secara spekulatif. Kekurangan bukti ditampilkan untuk verifikasi; jangan memasukkan data dummy agar lolos.
- Tabel baru memakai RLS dan izin server saja. Endpoint memverifikasi Supabase Auth, identitas profil unik, cabang, peran, versi, dan sumber; nilai/role/hash klien tidak menjadi dasar penilaian. Fungsi audit penugasan berada di schema private dengan search_path tetap dan pemeriksaan identitas untuk update pengguna.
- Pemasangan tidak menjalankan evaluator, mengubah nominal gaji, memundurkan periode mulai, atau mengirim pesan WhatsApp. Mekanisme antrean kenaikan gaji lama dipertahankan; hanya kalimat penjelasan enam kredit diperbarui.

## Verifikasi

Gunakan `node --test --test-concurrency=1 tests/performance-engine.test.mjs tests/performance-database.test.cjs tests/performance-edge.test.cjs` serta `node tests/performance-browser.cjs`. PGlite dipakai terpisah dari produksi. Browser menguji UI → autentikasi Edge tiruan → PostgreSQL lokal → rekap/kredit, dengan seluruh jaringan di-mock. `--test-concurrency=1` mencegah banyak instance WASM menghabiskan memori. Simulasi evaluator hanya di database lokal; tidak memanggil evaluator produksi.
