-- Existing attendance/payroll tables and records are preserved.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('sla-attendance-private','sla-attendance-private',false,5242880,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
-- No browser Storage policy: verified Edge endpoints issue short-lived signed URLs.
alter table public.pengajuan_cuti add column if not exists pengaju_auth_id uuid;
-- Client reads/realtime stay intact; writes must pass verified server validation.
revoke insert,update,delete on public.absensi,public.pengajuan_cuti,
  public.payroll_bulanan,public.sla_koreksi_luar_kota from public,anon,authenticated;

create table if not exists public.sla_notif_absensi (
  id uuid primary key default gen_random_uuid(),
  id_pengajuan text not null,
  penerima_username text not null,
  dibuat_pada timestamptz not null default now(),
  terkirim_pada timestamptz,
  percobaan integer not null default 0,
  coba_pada timestamptz not null default now(),
  lease_id uuid,
  lease_sampai timestamptz,
  galat text,
  unique(id_pengajuan,penerima_username)
);
alter table public.sla_notif_absensi enable row level security;
revoke all on public.sla_notif_absensi from public,anon,authenticated;
grant select,insert,update on public.sla_notif_absensi to service_role;
create index if not exists sla_notif_absensi_pending on public.sla_notif_absensi(coba_pada)
  where terkirim_pada is null;

-- Retain original links for review/recovery. Migration never deletes Drive files.
create table if not exists public.sla_migrasi_foto_absensi (
  table_name text not null check(table_name in ('absensi','pengajuan_cuti')),
  record_id text not null,
  original text not null,
  storage text,
  status text not null default 'pending',
  percobaan integer not null default 0,
  galat text,
  diperbarui_pada timestamptz not null default now(),
  primary key(table_name,record_id)
);
alter table public.sla_migrasi_foto_absensi enable row level security;
revoke all on public.sla_migrasi_foto_absensi from public,anon,authenticated;
grant select,insert,update on public.sla_migrasi_foto_absensi to service_role;

-- Same approval routing as canApprove() in sla-payroll-attendance.
create or replace function public.sla_antre_notif_absensi()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from 'Menunggu' then return new; end if;
  insert into public.sla_notif_absensi(id_pengajuan,penerima_username)
  select new.id_pengajuan,u.username from public.users u
  where nullif(btrim(u.username),'') is not null
    and (
      coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,'')='Semua'
      or coalesce(
        case when u.hak_akses_cabang in ('Kendari','Raha') then u.hak_akses_cabang end,
        case when u.cabang in ('Kendari','Raha') then u.cabang end,
        case when lower(btrim(u.role)) in ('admin','manager','direktur') then 'Kendari' end
      )=coalesce(new.cabang,'Kendari')
    ) and (
      lower(btrim(u.role))='direktur'
      or case
        when lower(btrim(new.role))='manager' then
          lower(btrim(u.role))='admin' and coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,'Kendari') in ('Kendari','Semua')
        when lower(btrim(new.role))='admin' then lower(btrim(u.role))='manager'
        else lower(btrim(u.role))='manager' or
          (lower(btrim(u.role))='admin' and coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,'Kendari') in ('Kendari','Semua'))
      end
    ) on conflict(id_pengajuan,penerima_username) do nothing;
  return new;
end $$;
drop trigger if exists sla_antre_notif_absensi on public.pengajuan_cuti;
create trigger sla_antre_notif_absensi after insert on public.pengajuan_cuti
for each row execute function public.sla_antre_notif_absensi();

create or replace function public.sla_ambil_notif_absensi(p_pengajuan text default null)
returns setof public.sla_notif_absensi language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  return query
  with candidate as (
    select id from public.sla_notif_absensi
    where terkirim_pada is null and coba_pada<=now()
      and (lease_sampai is null or lease_sampai<now())
      and (p_pengajuan is null or id_pengajuan=p_pengajuan)
    order by coba_pada,dibuat_pada,id for update skip locked limit 1
  ) update public.sla_notif_absensi n set lease_id=gen_random_uuid(),
    lease_sampai=now()+interval '90 seconds',percobaan=percobaan+1
    from candidate c where n.id=c.id returning n.*;
end $$;

create or replace function public.sla_selesai_notif_absensi(p_id uuid,p_lease_id uuid,p_terkirim boolean,p_error text default '')
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  update public.sla_notif_absensi set
    terkirim_pada=case when p_terkirim then now() else null end,
    galat=case when p_terkirim then null else left(p_error,500) end,
    coba_pada=now()+least(60,greatest(1,percobaan*5))*interval '1 minute',
    lease_id=null,lease_sampai=null
  where id=p_id and lease_id=p_lease_id and terkirim_pada is null;
  get diagnostics affected=row_count;
  return affected=1;
end $$;

create or replace function public.sla_attendance_supabase_active()
returns boolean language sql stable security definer set search_path='' as $$ select true $$;
revoke all on function public.sla_antre_notif_absensi(),
  public.sla_ambil_notif_absensi(text),public.sla_selesai_notif_absensi(uuid,uuid,boolean,text),
  public.sla_attendance_supabase_active() from public,anon,authenticated;
grant execute on function public.sla_ambil_notif_absensi(text),
  public.sla_selesai_notif_absensi(uuid,uuid,boolean,text),public.sla_attendance_supabase_active() to service_role;

-- Reuse the encrypted scheduler credential already used by salary and claims jobs.
create or replace function public.sla_installer_notif_absensi()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job_id bigint;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
  if not exists(select 1 from vault.secrets where name='sla_payroll_server_key') then
    raise exception 'Kredensial scheduler sla_payroll_server_key belum tersedia di Vault.';
  end if;
  for job_id in select jobid from cron.job where jobname='sla-notif-absensi' loop
    perform cron.unschedule(job_id);
  end loop;
  perform cron.schedule('sla-notif-absensi','*/5 * * * *',$job$
    select net.http_post(
      url:='https://oozkqjgllubhjctnkxwl.supabase.co/functions/v1/sla-payroll-attendance',
      headers:=jsonb_build_object('Content-Type','application/json','apikey',
        (select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key'),
        'x-sla-job-key',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key')),
      body:='{"action":"prosesNotifAbsensi"}'::jsonb,timeout_milliseconds:=100000);
  $job$);
  return jsonb_build_object('status','sukses','intervalMenit',5);
end $$;
revoke all on function public.sla_installer_notif_absensi() from public,anon,authenticated;
grant execute on function public.sla_installer_notif_absensi() to service_role;
notify pgrst,'reload schema';
commit;
