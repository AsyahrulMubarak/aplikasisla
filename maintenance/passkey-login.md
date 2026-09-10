# Login password dan Passkey

Passkey memakai Supabase Auth secara langsung. Google Apps Script tidak lagi menerbitkan sesi untuk tombol sidik jari. Password tetap memakai endpoint Supabase Auth yang sama dengan sebelumnya.

Konfigurasi project `oozkqjgllubhjctnkxwl`, Authentication → Passkeys:

- Enable Passkey authentication: aktif
- Relying Party Display Name: `Alfacom SLA`
- Relying Party ID: `aplikasisla.vercel.app`
- Relying Party Origins: `https://aplikasisla.vercel.app`

Library browser dipatok ke `@supabase/supabase-js@2.105.0`. Passkey masih eksperimental menurut dokumentasi Supabase; uji alur autentikasi sebelum mengganti versi library.

Pengguna masuk dengan password, membuka pengaturan akun, lalu memilih **Daftarkan Sidik Jari (WebAuthn)**. Pendaftaran lama melalui Apps Script perlu dilakukan kembali pada alur baru. Saat login berikutnya pengguna dapat memilih tombol sidik jari tanpa mengisi username/password. Identitas profil berasal dari akun Supabase yang dibuktikan oleh Passkey, bukan username yang sedang diketik.

Profil dipetakan menggunakan email sistem `username@alfacom.local`. Username lama yang mengandung spasi didukung melalui kolom `public.users.username_login`. Hak akses cabang dan nilai gaji profil tetap dipakai oleh alur aplikasi sebelumnya.

Sesi menggunakan access token dan refresh token Supabase. Client Passkey tidak menyimpan token di localStorage dan tidak menjalankan auto-refresh terpisah. Pembaruan token yang terjadi selama pendaftaran disalin ke sesi aplikasi. Login password dan Passkey tidak bisa berjalan bersamaan. Membatalkan sensor mengaktifkan kembali tombol login.

Validasi lokal: `node --test tests/*.test.cjs`. Pengujian sensor fisik tetap perlu dilakukan pada perangkat pengguna di alamat produksi. Jangan memakai domain preview Vercel untuk pendaftaran karena Passkey terikat pada RP ID.

Referensi: https://supabase.com/docs/guides/auth/passkeys
