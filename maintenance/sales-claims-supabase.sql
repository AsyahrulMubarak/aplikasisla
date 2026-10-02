-- Move all claim orchestration and retries to Supabase. Preserve tickets and claims.
-- Apply after sales-claims.sql. Existing Apps Script senders become idle.
begin;
create or replace function public.sla_ajukan_klaim_sales(
  p_actor text, p_id_tiket text, p_cabang text, p_keterangan text, p_bukti text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.users%rowtype; t public.tiket%rowtype;
begin
  if coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sla-claims-runtime' is distinct from 'supabase-edge' then
    raise exception 'Klaim Sales sekarang wajib melalui Supabase Edge Function.';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Akses backend diperlukan.'; end if;
  select * into strict u from public.users where username_login = p_actor;
  if lower(btrim(u.role)) <> 'sales' then raise exception 'Hanya Sales dapat mengajukan klaim.'; end if;
  if p_cabang not in ('Kendari', 'Raha') or p_cabang is null then raise exception 'Cabang tidak valid.'; end if;
  if nullif(btrim(u.nama_asli), '') is null then raise exception 'Nama Sales belum terdaftar.'; end if;
  if coalesce(p_bukti, '') = '' or length(p_bukti) > 3500000
    or cardinality(string_to_array(p_bukti, '|#|')) not between 1 and 3
    or exists (select 1 from unnest(string_to_array(p_bukti, '|#|')) b
      where b !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$') then
    raise exception 'Unggah 1 sampai 3 foto bukti yang valid.';
  end if;
  if length(coalesce(p_keterangan, '')) > 3000 then raise exception 'Keterangan maksimal 3000 karakter.'; end if;
  if not exists (select 1 from public.users a where public.sla_admin_kendari(a.role, a.hak_akses_cabang)) then
    raise exception 'Akun Admin Kendari belum terdaftar.';
  end if;
  select * into strict t from public.tiket where id_tiket = p_id_tiket
    and coalesce(cabang, 'Kendari') = p_cabang for update;
  if coalesce(btrim(t.sales), '') not in ('', '-') then raise exception 'Tiket sudah memiliki Sales.'; end if;
  if coalesce(btrim(t.status_banding), '') not in ('', 'Ditolak') then raise exception 'Tiket sudah memiliki pengajuan klaim.'; end if;
  if t.status_banding = 'Ditolak' then
    if t.klaim_sales_username = u.username_login
      or (t.klaim_sales_username is null and lower(btrim(t.sales_pengaju)) = lower(btrim(u.nama_asli))) then
      raise exception 'Klaim Anda telah ditolak. Tiket ini dapat diklaim oleh Sales lain.';
    end if;
    insert into public.sla_riwayat_klaim_sales(klaim_id, id_tiket, cabang, snapshot)
      values (t.klaim_sales_id, t.id_tiket, coalesce(t.cabang, 'Kendari'),
        jsonb_build_object('status_banding', t.status_banding, 'sales_pengaju', t.sales_pengaju,
          'bukti_banding', t.bukti_banding, 'keterangan_sales', t.keterangan_sales,
          'alasan_admin', t.alasan_admin, 'klaim_sales_username', t.klaim_sales_username,
          'klaim_sales_diajukan_pada', t.klaim_sales_diajukan_pada,
          'klaim_sales_diputuskan_pada', t.klaim_sales_diputuskan_pada, 'klaim_sales_admin', t.klaim_sales_admin))
      on conflict (klaim_id) do nothing;
  end if;
  update public.tiket set status_banding = 'Diajukan', sales_pengaju = btrim(u.nama_asli),
    bukti_banding = p_bukti, keterangan_sales = btrim(coalesce(p_keterangan, '')), alasan_admin = null,
    klaim_sales_id = gen_random_uuid(), klaim_sales_username = u.username_login,
    klaim_sales_diajukan_pada = now(), klaim_sales_diputuskan_pada = null, klaim_sales_admin = null
    where id_tiket = p_id_tiket and coalesce(cabang, 'Kendari') = p_cabang returning * into strict t;
  return jsonb_build_object('klaim_id', t.klaim_sales_id, 'status', t.status_banding);
end;
$$;
create or replace function public.sla_respon_klaim_sales(
  p_actor text, p_id_tiket text, p_cabang text, p_keputusan text, p_alasan text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.users%rowtype; t public.tiket%rowtype;
begin
  if coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sla-claims-runtime' is distinct from 'supabase-edge' then
    raise exception 'Klaim Sales sekarang wajib melalui Supabase Edge Function.';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Akses backend diperlukan.'; end if;
  select * into strict u from public.users where username_login = p_actor;
  if not public.sla_admin_kendari(u.role, u.hak_akses_cabang) then
    raise exception 'Hanya Admin Kendari dapat memutuskan klaim.';
  end if;
  if p_cabang not in ('Kendari', 'Raha') or p_cabang is null then raise exception 'Cabang tidak valid.'; end if;
  if p_keputusan not in ('Diterima', 'Ditolak') or p_keputusan is null then raise exception 'Keputusan tidak valid.'; end if;
  if p_keputusan = 'Ditolak' and nullif(btrim(p_alasan), '') is null then raise exception 'Alasan penolakan wajib diisi.'; end if;
  if length(coalesce(p_alasan, '')) > 3000 then raise exception 'Alasan maksimal 3000 karakter.'; end if;
  select * into strict t from public.tiket where id_tiket = p_id_tiket
    and coalesce(cabang, 'Kendari') = p_cabang for update;
  if t.status_banding is distinct from 'Diajukan' then raise exception 'Klaim sudah diproses atau belum diajukan.'; end if;
  if coalesce(btrim(t.sales), '') not in ('', '-') then raise exception 'Tiket sudah memiliki Sales. Periksa pengajuan.'; end if;
  if nullif(btrim(t.sales_pengaju), '') is null or t.klaim_sales_username is null
    or not exists (select 1 from public.users s where s.username_login = t.klaim_sales_username
      and lower(btrim(s.role)) = 'sales') then
    raise exception 'Akun Sales pengaju belum teridentifikasi. Periksa profil pengajuan lama.';
  end if;
  update public.tiket set status_banding = p_keputusan,
    sales = case when p_keputusan = 'Diterima' then t.sales_pengaju else t.sales end,
    alasan_admin = case when p_keputusan = 'Ditolak' then btrim(p_alasan) else null end,
    klaim_sales_diputuskan_pada = now(), klaim_sales_admin = u.username_login
    where id_tiket = p_id_tiket and coalesce(cabang, 'Kendari') = p_cabang returning * into strict t;
  return jsonb_build_object('klaim_id', t.klaim_sales_id, 'status', t.status_banding);
end;
$$;
create or replace function public.sla_mulai_pengiriman_klaim_sales()
returns uuid language sql security definer set search_path = '' as $$
  update public.sla_pengirim_klaim_sales set lease_id = gen_random_uuid(),
    terkunci_sampai = now() + interval '7 minutes'
  where coalesce(auth.role(),'')='service_role'
    and coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb->>'x-sla-claims-runtime'='supabase-edge'
    and id = true and (terkunci_sampai is null or terkunci_sampai < now())
  returning lease_id;
$$;
create or replace function public.sla_claims_edge_active() returns boolean
 language sql stable security definer set search_path='' as $$ select true $$;
revoke all on function public.sla_claims_edge_active() from public,anon,authenticated;
grant execute on function public.sla_claims_edge_active() to service_role;

-- Reuse the existing encrypted server key; no new credentials or browser secrets.
create or replace function public.sla_installer_notif_klaim_sales() returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job bigint;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if not exists(select 1 from vault.secrets where name='sla_payroll_server_key') then
   raise exception 'Kredensial scheduler Supabase belum tersedia.';
 end if;
 for v_job in select jobid from cron.job where jobname='sla-notif-klaim-sales' loop perform cron.unschedule(v_job); end loop;
 perform cron.schedule('sla-notif-klaim-sales','*/5 * * * *',$job$
 select net.http_post(
  url:='https://oozkqjgllubhjctnkxwl.supabase.co/functions/v1/sla-payroll-attendance',
  headers:=jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key'),
   'x-sla-job-key',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key')),
  body:='{"action":"prosesNotifKlaimSales"}'::jsonb,timeout_milliseconds:=100000);
 $job$);
 return jsonb_build_object('status','sukses','intervalMenit',5);
end $$;
revoke all on function public.sla_installer_notif_klaim_sales() from public,anon,authenticated;
grant execute on function public.sla_installer_notif_klaim_sales() to service_role;
commit;
