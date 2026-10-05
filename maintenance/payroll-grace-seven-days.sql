-- Extend payroll edits through day 7, 23:59 WITA. Existing-install migration.
-- Preserve document permissions and salary history; evaluate only closed payroll months.
begin;

CREATE OR REPLACE FUNCTION public.sla_simpan_bukti_payroll(p_auth_id uuid, p_username text, p_periode text, p_jenis text, p_id uuid, p_id_lama text, p_object_path text, p_nama_file text, p_ukuran_byte integer, p_hapus boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor public.users%rowtype;
  v_target public.users%rowtype;
  v_old public.sla_bukti_payroll%rowtype;
  v_saved public.sla_bukti_payroll%rowtype;
  v_home text;
  v_month date;
begin
  select * into strict v_actor from public.users where auth_id = p_auth_id;
  v_home := coalesce(
    case when lower(trim(v_actor.hak_akses_cabang)) in ('kendari', 'raha') then lower(trim(v_actor.hak_akses_cabang)) end,
    case when lower(trim(v_actor.cabang)) in ('kendari', 'raha') then lower(trim(v_actor.cabang)) end, 'kendari');
  if coalesce(lower(trim(v_actor.role)), '') not in ('admin', 'manager', 'direktur') or
     (lower(trim(v_actor.role)) = 'admin' and v_home = 'raha') or
     (lower(trim(v_actor.role)) <> 'direktur' and coalesce(v_actor.gaji_pokok, 0) <= 0) then
    raise exception 'Bukti payroll hanya dapat diubah Admin Kendari, Manager, atau Direktur.';
  end if;
  if p_periode is null or p_periode !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or
     p_jenis is null or p_jenis not in ('fee_marketing', 'kasbon') or p_id_lama is null or p_hapus is null then
    raise exception 'Periode, jenis, atau versi bukti payroll tidak valid.';
  end if;
  v_month := (p_periode || '-01')::date;
  if (pg_catalog.now() at time zone 'Asia/Makassar')::date >= (v_month + interval '1 month 7 days')::date then
    raise exception 'Periode payroll telah dikunci setelah masa tenggang 7 hari.';
  end if;
  select * into strict v_target from public.users where username = p_username;
  if lower(trim(coalesce(nullif(trim(v_target.hak_akses_cabang), ''), v_target.cabang, ''))) not in ('kendari', 'raha', 'semua') then
    raise exception 'Cabang bukti payroll tidak valid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sla_bukti:' || p_username || ':' || p_periode || ':' || p_jenis, 0));
  select * into v_old from public.sla_bukti_payroll where username = p_username and periode = p_periode and jenis = p_jenis;
  if coalesce(v_old.id::text, '') <> p_id_lama then
    raise exception 'Bukti sudah diubah pengguna lain. Muat ulang bukti sebelum mengubahnya.';
  end if;
  if p_hapus then
    if v_old.id is null then raise exception 'Bukti yang akan dihapus tidak ditemukan.'; end if;
    delete from public.sla_bukti_payroll where id = v_old.id;
    return pg_catalog.jsonb_build_object('status', 'sukses', 'idTerhapus', v_old.id, 'objectPathLama', v_old.object_path);
  end if;
  if p_id is null or p_object_path is null or
     p_object_path <> p_username || '/' || p_periode || '/' || p_jenis || '/' || p_id::text || '.pdf' or
     p_nama_file is null or length(p_nama_file) not between 5 and 180 or p_nama_file !~* '\.pdf$' or
     p_ukuran_byte is null or p_ukuran_byte not between 1 and 5242880 then
    raise exception 'Metadata PDF tidak valid.';
  end if;
  insert into public.sla_bukti_payroll (id, username, periode, jenis, object_path, nama_file, ukuran_byte, diperbarui_oleh)
    values (p_id, p_username, p_periode, p_jenis, p_object_path, p_nama_file, p_ukuran_byte, p_auth_id)
    on conflict (username, periode, jenis) do update set id = excluded.id, object_path = excluded.object_path,
      nama_file = excluded.nama_file, ukuran_byte = excluded.ukuran_byte,
      diperbarui_pada = pg_catalog.now(), diperbarui_oleh = excluded.diperbarui_oleh
    returning * into v_saved;
  return pg_catalog.jsonb_build_object('status', 'sukses', 'data', pg_catalog.to_jsonb(v_saved), 'objectPathLama', v_old.object_path);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sla_evaluasi_kenaikan_gaji()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_local timestamp:=v_now at time zone 'Asia/Makassar';
 v_last date; v_period text; v_start date; v_user public.users%rowtype; v_program record; v_stats record;
 v_months text[]; v_id uuid; v_salary numeric; v_count integer; v_evaluated integer:=0; v_raised integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if not pg_try_advisory_xact_lock(734252611) then return jsonb_build_object('status','sibuk'); end if;
 v_last:=(date_trunc('month',v_local)-case when extract(day from v_local)>=8 then interval '1 month' else interval '2 months' end)::date;
 for v_program in select * from public.sla_gaji_program where not otomatis_selesai order by username loop
   select * into v_user from public.users where username=v_program.username for update;
   if not found or coalesce(v_user.gaji_pokok,0)<=0 or v_user.gaji_pokok>=3000000 then continue; end if;
   if public.sla_gaji_cabang(v_user)<>'Kendari' then continue; end if;
   v_start:=greatest('2026-10-01'::date,(v_program.mulai_periode||'-01')::date);
   for v_period in select to_char(d,'YYYY-MM') from generate_series(v_start::timestamp,v_last::timestamp,interval '1 month') d loop
     if exists(select 1 from public.sla_gaji_disiplin_bulan where username=v_user.username and periode=v_period) then continue; end if;
     select count(*) into v_count from public.users u where lower(trim(u.nama_asli))=lower(trim(v_user.nama_asli)) and public.sla_gaji_cabang(u)=public.sla_gaji_cabang(v_user);
     v_salary:=public.sla_gaji_nominal_periode(v_user.username,v_period);
     if v_count<>1 or v_salary<=0 or v_salary>=3000000 then
       insert into public.sla_gaji_disiplin_bulan values(v_user.username,v_period,0,0,false,case when v_count<>1 then 'Profil bernama sama dalam cabang; perlu ditinjau Manajemen.' else 'Gaji pokok di luar program otomatis.' end,v_salary,null,v_now);
     else
       select * into v_stats from public.sla_disiplin_kenaikan_gaji(v_user.username,v_period);
       insert into public.sla_gaji_disiplin_bulan values(v_user.username,v_period,v_stats.telat_pagi,v_stats.alpa,v_stats.telat_pagi<=3 and v_stats.alpa<=2,
        case when v_stats.telat_pagi>3 or v_stats.alpa>2 then 'Telat pagi >3 kali atau alpa >2 hari.' else 'Memenuhi batas disiplin.' end,v_salary,null,v_now);
     end if;
     v_evaluated:=v_evaluated+1;
     select array_agg(periode order by periode) into v_months from (select periode from public.sla_gaji_disiplin_bulan where username=v_user.username and memenuhi_syarat and kenaikan_id is null order by periode limit 6) q;
     if cardinality(v_months)=6 then
       perform set_config('sla.salary_kind','Otomatis',true); perform set_config('sla.salary_actor','Sistem',true);
       perform set_config('sla.salary_reason','Enam bulan memenuhi batas disiplin.',true); perform set_config('sla.salary_months',v_months::text,true);
       update public.users set gaji_pokok=least(3000000,gaji_pokok+250000) where username=v_user.username returning * into v_user;
       select id into v_id from public.sla_gaji_riwayat where username=v_user.username and jenis='Otomatis' and bulan_dipakai=v_months order by dibuat_pada desc limit 1;
       update public.sla_gaji_disiplin_bulan set kenaikan_id=v_id where username=v_user.username and periode=any(v_months);
       v_raised:=v_raised+1;
       if v_user.gaji_pokok>=3000000 then exit; end if;
     end if;
   end loop;
 end loop;
 perform set_config('sla.salary_kind','',true); perform set_config('sla.salary_months','',true);
 perform set_config('sla.salary_actor','',true); perform set_config('sla.salary_reason','',true);
 return jsonb_build_object('status','sukses','bulanDievaluasi',v_evaluated,'kenaikan',v_raised);
end $function$;

commit;
