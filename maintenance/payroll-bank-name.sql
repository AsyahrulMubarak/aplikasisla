-- Add bank names without modifying existing account numbers or transfer marks.
alter table public.sla_rekening_pegawai add column nama_bank text not null default ''
  check (length(nama_bank) <= 100 and nama_bank !~ '[[:cntrl:]]');

create function public.sla_simpan_rekening_bank_pegawai(
  p_auth_id uuid, p_username text, p_nomor_rekening text, p_nomor_lama text,
  p_nama_bank text, p_nama_bank_lama text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_role text;
  v_home text;
  v_old public.sla_rekening_pegawai%rowtype;
begin
  select lower(trim(u.role)), coalesce(
    case when lower(trim(u.hak_akses_cabang)) in ('kendari','raha') then lower(trim(u.hak_akses_cabang)) end,
    case when lower(trim(u.cabang)) in ('kendari','raha') then lower(trim(u.cabang)) end, 'kendari')
    into v_role, v_home from public.users u where u.auth_id = p_auth_id;
  if v_role is null or v_role not in ('admin', 'manager', 'direktur') or (v_role = 'admin' and v_home = 'raha') then
    raise exception 'Rekening dan nama bank hanya dapat diubah Admin Kendari, Manager, atau Direktur.';
  end if;
  if p_nomor_rekening is null or p_nomor_lama is null or
     (p_nomor_rekening <> '' and p_nomor_rekening !~ '^[0-9]{1,34}$') then
    raise exception 'Nomor rekening harus berisi angka, maksimal 34 digit.';
  end if;
  if p_nama_bank is null or p_nama_bank_lama is null or length(p_nama_bank) > 100 or length(p_nama_bank_lama) > 100 or
     p_nama_bank <> trim(p_nama_bank) or (p_nama_bank || p_nama_bank_lama) ~ '[[:cntrl:]]' then
    raise exception 'Nama bank harus berupa teks, maksimal 100 karakter.';
  end if;
  if not exists (select 1 from public.users where username = p_username) then
    raise exception 'Profil pegawai tidak ditemukan. Muat ulang rekap gaji.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sla_rekening:' || p_username, 0));
  select * into v_old from public.sla_rekening_pegawai where username = p_username;
  if coalesce(v_old.nomor_rekening, '') <> p_nomor_lama or coalesce(v_old.nama_bank, '') <> p_nama_bank_lama then
    raise exception 'Rekening atau nama bank sudah diubah pengguna lain. Klik Proses Data untuk memuat data terbaru sebelum menyimpan.';
  end if;
  insert into public.sla_rekening_pegawai(username, nomor_rekening, nama_bank, diperbarui_pada, diperbarui_oleh)
    values (p_username, p_nomor_rekening, p_nama_bank, pg_catalog.now(), p_auth_id)
    on conflict (username) do update set nomor_rekening = excluded.nomor_rekening, nama_bank = excluded.nama_bank,
      diperbarui_pada = excluded.diperbarui_pada, diperbarui_oleh = excluded.diperbarui_oleh;
  return pg_catalog.jsonb_build_object('status', 'sukses', 'data',
    pg_catalog.jsonb_build_object('username', p_username, 'nomorRekening', p_nomor_rekening, 'namaBank', p_nama_bank));
end;
$$;
revoke all on function public.sla_simpan_rekening_bank_pegawai(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.sla_simpan_rekening_bank_pegawai(uuid, text, text, text, text, text) to service_role;
