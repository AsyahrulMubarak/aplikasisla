begin;

create or replace function public.sla_pengelola_klaim_sales(
  p_role text, p_akses text, p_cabang_asal text, p_cabang_tiket text
) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_cabang_tiket in ('Kendari', 'Raha') and (
    public.sla_admin_kendari(p_role, p_akses)
    or (lower(btrim(coalesce(p_role, ''))) in ('manager', 'direktur')
      and lower(btrim(coalesce(nullif(btrim(p_akses), ''), nullif(btrim(p_cabang_asal), ''), 'Kendari')))
        in ('semua', lower(p_cabang_tiket)))
  ), false);
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
  if p_cabang not in ('Kendari', 'Raha') or p_cabang is null then raise exception 'Cabang tidak valid.'; end if;
  if not public.sla_pengelola_klaim_sales(u.role, u.hak_akses_cabang, u.cabang, p_cabang) then
    raise exception 'Keputusan klaim tidak sesuai role atau hak akses cabang.';
  end if;
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

revoke all on function public.sla_pengelola_klaim_sales(text,text,text,text) from public,anon,authenticated;
revoke all on function public.sla_respon_klaim_sales(text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.sla_pengelola_klaim_sales(text,text,text,text) to service_role;
grant execute on function public.sla_respon_klaim_sales(text,text,text,text,text) to service_role;
comment on function public.sla_pengelola_klaim_sales(text,text,text,text) is 'Admin Kendari retains existing cross-branch claim access; Manager and Director require the ticket branch in their stored access.';

commit;
