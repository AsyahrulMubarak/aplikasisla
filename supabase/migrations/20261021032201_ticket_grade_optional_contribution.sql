-- Opt-in ticket assessment. No historic backfill and no salary-program changes.
alter table public.tiket add column if not exists penilaian_teknisi jsonb;
create table if not exists public.sla_penilaian_tiket_audit (
  id bigint generated always as identity primary key,
  id_tiket text not null,
  cabang text not null,
  actor_auth_id uuid not null,
  actor_username text not null,
  tindakan text not null,
  sebelum jsonb,
  sesudah jsonb not null,
  dibuat_pada timestamptz not null default now()
);
create index if not exists sla_penilaian_tiket_audit_ticket on public.sla_penilaian_tiket_audit(id_tiket,id);
alter table public.sla_penilaian_tiket_audit enable row level security;
revoke all on public.sla_penilaian_tiket_audit from public,anon,authenticated;
grant select,insert on public.sla_penilaian_tiket_audit to service_role;
grant usage,select on sequence public.sla_penilaian_tiket_audit_id_seq to service_role;
drop policy if exists sla_penilaian_audit_server on public.sla_penilaian_tiket_audit;
create policy sla_penilaian_audit_server on public.sla_penilaian_tiket_audit for all to service_role using(true) with check(true);

create or replace function public.sla_penilaian_nama(p_value text)
returns text[] language sql immutable set search_path='' as $$
  select coalesce(array_agg(n order by n),'{}'::text[]) from (
    select distinct lower(regexp_replace(btrim(v),'\s+',' ','g')) n
    from regexp_split_to_table(coalesce(p_value,''),'[,;\n\r]') v
    where lower(btrim(v)) not in ('','-','belum ditugaskan')
  ) s;
$$;

create or replace function public.sla_penilaian_kandidat(p_ticket public.tiket)
returns jsonb language sql stable set search_path='' as $$
  with names as (
    select unnest(public.sla_penilaian_nama(p_ticket.teknisi)) n
    union select unnest(public.sla_penilaian_nama(p_ticket.teknisi_sebelumnya))
    union select unnest(public.sla_penilaian_nama(e->>'dari'))
      from jsonb_array_elements(coalesce(p_ticket.riwayat_penggantian_teknisi,'[]')) e
    union select lower(btrim(e->>'name')) from jsonb_array_elements(coalesce(p_ticket.penilaian_teknisi->'allocation'->'members','[]')) e
  ), profiles as (
    select distinct on (lower(btrim(u.nama_asli))) u.username,u.nama_asli,
      lower(btrim(u.nama_asli)) = any(public.sla_penilaian_nama(p_ticket.teknisi)) as current_assignee
    from public.users u join names n on n.n=lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))
    where lower(btrim(u.role)) in ('teknisi','freelance')
      and lower(coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,''))=lower(coalesce(p_ticket.cabang,'Kendari'))
    order by lower(btrim(u.nama_asli)),case when lower(u.role)='teknisi' then 0 else 1 end,u.username
  ) select coalesce(jsonb_agg(jsonb_build_object('username',username,'name',nama_asli,'current',current_assignee) order by nama_asli),'[]') from profiles;
$$;

create or replace function public.sla_jaga_penilaian_tiket()
returns trigger language plpgsql set search_path='' as $$
declare a jsonb;
begin
  if tg_op='DELETE' then
    if old.penilaian_teknisi->'achievement' is not null or old.penilaian_teknisi->'bonusSnapshot' is not null then
      raise exception 'Tiket dengan pencapaian disahkan atau bonus cair memerlukan koreksi tercatat, bukan hapus.';
    end if;
    return old;
  end if;
  if (tg_op='INSERT' and new.penilaian_teknisi is not null) or
     (tg_op='UPDATE' and new.penilaian_teknisi is distinct from old.penilaian_teknisi) then
    if coalesce(auth.role(),'')<>'service_role' then
      raise exception 'Penilaian hanya dapat diubah melalui layanan pengajuan dan persetujuan.';
    end if;
  end if;
  if tg_op='UPDATE' and new.status_pembayaran='Lunas' and old.status_pembayaran is distinct from 'Lunas'
    and new.penilaian_teknisi is not null and new.penilaian_teknisi->'bonusSnapshot' is null then
    a:=new.penilaian_teknisi;
    if a->'allocation'->>'status'<>'approved' or
       (a->'achievement' is null and a->'allocation'->>'assignment'<>array_to_string(public.sla_penilaian_nama(new.teknisi),',')) then
      raise exception 'Sahkan pembagian poin dan konfirmasi pelaksana sebelum mencairkan bonus.';
    end if;
    new.penilaian_teknisi:=jsonb_set(a,'{bonusSnapshot}',jsonb_build_object('members',a->'allocation'->'members','frozenAt',statement_timestamp()));
  end if;
  return new;
end;
$$;
drop trigger if exists sla_zz_jaga_penilaian_tiket on public.tiket;
create trigger sla_zz_jaga_penilaian_tiket before insert or update or delete on public.tiket for each row execute function public.sla_jaga_penilaian_tiket();

create or replace function public.sla_penilaian_tiket(p_auth_id uuid,p_id_tiket text,p_action text,p_revision integer default 0,p_data jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.users%rowtype; t public.tiket%rowtype; a jsonb; prev jsonb; candidates jsonb; members jsonb;
  g text; pts integer; mode text; reason text; access text; managing boolean; own_ticket boolean; recipient boolean;
  m jsonb; c jsonb; share numeric; total numeric:=0; cnt integer; i integer:=0; units integer; duplicate_names text[]:='{}';
begin
  if p_auth_id is null then raise exception 'Sesi tidak valid.'; end if;
  select * into u from public.users where auth_id=p_auth_id;
  if not found or (select count(*) from public.users where auth_id=p_auth_id)<>1 then raise exception 'Profil pengguna tidak unik.'; end if;
  select * into t from public.tiket where id_tiket=p_id_tiket for update;
  if not found or p_id_tiket not like 'TKT-%' then raise exception 'Tiket tidak ditemukan.'; end if;
  access:=lower(coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,''));
  if access not in ('kendari','raha','semua') or (access<>'semua' and access<>lower(coalesce(t.cabang,'Kendari'))) then raise exception 'Cabang tiket di luar hak akses.'; end if;
  managing:=lower(u.role) in ('admin','admin_raha','manager','direktur');
  candidates:=public.sla_penilaian_kandidat(t);
  own_ticket:=exists(select 1 from jsonb_array_elements(candidates) e where lower(btrim(e->>'name'))=lower(btrim(u.nama_asli)));
  if not managing and not (lower(u.role) in ('teknisi','freelance') and own_ticket) then raise exception 'Akses penilaian tiket ditolak.'; end if;
  a:=t.penilaian_teknisi; prev:=a;
  if p_action='read' then
    return jsonb_build_object('status','sukses','assessment',a,'candidates',candidates,'ticketStatus',t.status,'paid',t.status_pembayaran='Lunas');
  end if;
  if t.status in ('Cancel','Batal') then raise exception 'Tiket batal tidak dapat dinilai.'; end if;
  if coalesce((a->>'revision')::integer,0)<>p_revision then raise exception 'Penilaian sudah berubah. Muat ulang sebelum menyimpan.'; end if;
  if a is null then
    if p_action not in ('proposeGrade','proposeAllocation') then raise exception 'Ajukan grade atau pembagian terlebih dahulu.'; end if;
    if t.status_pembayaran='Lunas' then raise exception 'Tiket yang sudah cair tetap memakai pembagian historis.'; end if;
    if t.status='Selesai' and (t.waktu_selesai at time zone 'Asia/Makassar')::date < (date_trunc('month',now() at time zone 'Asia/Makassar'))::date then raise exception 'Riwayat bulan lalu tidak diubah melalui penilaian baru.'; end if;
    select count(*) into cnt from jsonb_array_elements(candidates) e where (e->>'current')::boolean;
    members:='[]';
    for c in select e from jsonb_array_elements(candidates) e where (e->>'current')::boolean order by e->>'username' loop
      units:=1000000/cnt + case when i < 1000000%cnt then 1 else 0 end; i:=i+1;
      members:=members||jsonb_build_array(jsonb_build_object('username',c->>'username','name',c->>'name','share',units/10000.0));
    end loop;
    a:=jsonb_build_object('version',1,'revision',0,'startedAt',now(),'allocation',jsonb_build_object('mode','equal','status','default','members',members));
  end if;
  if a->'achievement' is not null then raise exception 'Pencapaian telah disahkan. Perubahan memerlukan koreksi tercatat.'; end if;
  reason:=btrim(coalesce(p_data->>'reason',''));
  if length(reason)>2000 then raise exception 'Alasan maksimal 2000 karakter.'; end if;
  if p_action='proposeGrade' then
    g:=p_data->>'grade'; pts:=case g when 'S' then 16 when 'A' then 8 when 'B' then 4 when 'C' then 2 when 'D' then 1 else null end;
    if pts is null or length(reason)<5 then raise exception 'Pilih grade dan jelaskan diagnosis/lingkup pekerjaan.'; end if;
    a:=jsonb_set(a,'{grade}',jsonb_build_object('value',g,'points',pts,'reason',reason,'status','pending','proposedBy',p_auth_id,'proposedName',u.nama_asli,'proposedAt',now(),'scope',t.jenis_pekerjaan));
  elsif p_action in ('approveGrade','rejectGrade') then
    g:=a->'grade'->>'value';
    if a->'grade'->>'status'<>'pending' or g is null then raise exception 'Tidak ada grade yang menunggu persetujuan.'; end if;
    if not managing or (g in ('S','A','B') and lower(u.role) not in ('manager','direktur')) then raise exception 'Grade B/A/S memerlukan Manager atau Direktur; C/D memerlukan admin cabang.'; end if;
    if a->'grade'->>'proposedBy'=p_auth_id::text or own_ticket then raise exception 'Pengaju atau penerima poin tidak boleh menyetujui penilaiannya sendiri.'; end if;
    if p_action='rejectGrade' and length(reason)<5 then raise exception 'Isi alasan penolakan.'; end if;
    a:=jsonb_set(a,'{grade}',(a->'grade')||jsonb_build_object('status',case when p_action='approveGrade' then 'approved' else 'rejected' end,'reviewedBy',p_auth_id,'reviewedName',u.nama_asli,'reviewedAt',now(),'reviewNote',reason));
  elsif p_action in ('proposeAllocation','approveAllocation','rejectAllocation') then
    if a->'bonusSnapshot' is not null then raise exception 'Pembagian bonus telah dikunci saat pencairan.'; end if;
    if p_action='rejectAllocation' then
      if not managing or own_ticket or a->'allocation'->>'proposedBy'=p_auth_id::text then raise exception 'Peninjau pembagian harus berwenang dan bukan pengaju/penerima.'; end if;
      if a->'allocation'->>'status'<>'pending' or length(reason)<5 then raise exception 'Isi alasan penolakan usulan yang menunggu.'; end if;
      a:=jsonb_set(a,'{allocation}',(a->'allocation')||jsonb_build_object('status','rejected','reviewNote',reason,'reviewedBy',p_auth_id,'reviewedName',u.nama_asli,'reviewedAt',now()));
    else
      mode:=case when p_action='approveAllocation' then a->'allocation'->>'mode' else p_data->>'mode' end;
      if mode not in ('equal','custom') or mode is null then raise exception 'Mode pembagian tidak valid.'; end if;
      members:=case when p_action='approveAllocation' and mode='custom' then a->'allocation'->'members' else coalesce(p_data->'members',a->'allocation'->'members') end;
      if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members) not between 1 and 32 then raise exception 'Konfirmasi 1 sampai 32 pelaksana.'; end if;
      cnt:=jsonb_array_length(members); i:=0; total:=0; duplicate_names:='{}'; members:=coalesce(members,'[]');
      for m in select e from jsonb_array_elements(members) e loop
        select e into c from jsonb_array_elements(candidates) e where e->>'username'=m->>'username';
        if c is null or lower(btrim(c->>'name'))=any(duplicate_names) then raise exception 'Pelaksana harus berasal dari penugasan/riwayat tiket dan tidak boleh ganda.'; end if;
        duplicate_names:=array_append(duplicate_names,lower(btrim(c->>'name')));
        share:=case when mode='equal' then (1000000/cnt + case when i<1000000%cnt then 1 else 0 end)/10000.0 else (m->>'share')::numeric end;
        if share is null or share<0 or share>100 or share<>round(share,4) then raise exception 'Persentase 0–100, maksimal 4 angka desimal.'; end if;
        total:=total+share;
        members:=jsonb_set(members,array[i::text],jsonb_build_object('username',c->>'username','name',c->>'name','share',share)); i:=i+1;
      end loop;
      if total<>100 then raise exception 'Total persentase kontribusi harus tepat 100%%.'; end if;
      recipient:=exists(select 1 from jsonb_array_elements(members) e where lower(btrim(e->>'name'))=lower(btrim(u.nama_asli)) and (e->>'share')::numeric>0);
      if p_action='proposeAllocation' then
        if mode='custom' and (length(reason)<5 or coalesce((p_data->>'teamConfirmed')::boolean,false) is not true) then raise exception 'Isi alasan dan konfirmasi pembahasan tim untuk persentase khusus.'; end if;
        a:=jsonb_set(a,'{allocation}',jsonb_build_object('mode',mode,'status','pending','members',members,'reason',reason,'proposedBy',p_auth_id,'proposedName',u.nama_asli,'proposedAt',now(),'teamConfirmed',mode='equal' or (p_data->>'teamConfirmed')::boolean));
      else
        if not managing or recipient or own_ticket or a->'allocation'->>'proposedBy'=p_auth_id::text then raise exception 'Peninjau pembagian harus berwenang dan bukan pengaju/penerima.'; end if;
        if a->'allocation'->>'status' not in ('default','pending') then raise exception 'Ajukan ulang pembagian sebelum disahkan.'; end if;
        a:=jsonb_set(a,'{allocation}',(a->'allocation')||jsonb_build_object('members',members,'status','approved','approvedBy',p_auth_id,'approvedName',u.nama_asli,'approvedAt',now(),'assignment',array_to_string(public.sla_penilaian_nama(t.teknisi),',')));
      end if;
    end if;
  elsif p_action='postAchievement' then
    g:=a->'grade'->>'value';
    if not managing or own_ticket or (g in ('S','A','B') and lower(u.role) not in ('manager','direktur')) then raise exception 'Pengesahan hasil memerlukan peninjau grade yang bukan pelaksana.'; end if;
    if t.status<>'Selesai' or nullif(btrim(t.deskripsi_pekerjaan_ba),'') is null or nullif(btrim(t.nama_customer),'') is null or length(coalesce(t.tanda_tangan,''))<50 then raise exception 'Selesaikan pekerjaan dan lengkapi BA/PIC/tanda tangan klien terlebih dahulu.'; end if;
    if a->'grade'->>'status' is distinct from 'approved' or a->'allocation'->>'status' is distinct from 'approved' then raise exception 'Grade dan pembagian harus disahkan terlebih dahulu.'; end if;
    if a->'grade'->>'scope' is distinct from t.jenis_pekerjaan then raise exception 'Lingkup berubah. Ajukan dan tinjau ulang grade.'; end if;
    if a->'allocation'->>'assignment' is distinct from array_to_string(public.sla_penilaian_nama(t.teknisi),',') then raise exception 'Penugasan berubah. Tinjau ulang daftar pelaksana.'; end if;
    a:=jsonb_set(a,'{achievement}',jsonb_build_object('grade',g,'points',(a->'grade'->>'points')::integer,'members',a->'allocation'->'members','approvedBy',p_auth_id,'approvedName',u.nama_asli,'postedAt',now(),'completedAt',t.waktu_selesai));
  else raise exception 'Tindakan penilaian tidak dikenal.';
  end if;
  a:=jsonb_set(a,'{revision}',to_jsonb(p_revision+1));
  update public.tiket set penilaian_teknisi=a where id_tiket=p_id_tiket;
  insert into public.sla_penilaian_tiket_audit(id_tiket,cabang,actor_auth_id,actor_username,tindakan,sebelum,sesudah)
    values(p_id_tiket,coalesce(t.cabang,'Kendari'),p_auth_id,u.username,p_action,prev,a);
  return jsonb_build_object('status','sukses','assessment',a,'candidates',candidates);
end;
$$;
revoke all on function public.sla_penilaian_nama(text),public.sla_penilaian_kandidat(public.tiket),public.sla_jaga_penilaian_tiket(),public.sla_penilaian_tiket(uuid,text,text,integer,jsonb) from public,anon,authenticated;
-- Trigger helpers are invokers and can only read names/profiles already visible to the caller.
grant execute on function public.sla_penilaian_nama(text) to authenticated,service_role;
grant execute on function public.sla_penilaian_kandidat(public.tiket),public.sla_penilaian_tiket(uuid,text,text,integer,jsonb),public.sla_jaga_penilaian_tiket() to service_role;
comment on column public.tiket.penilaian_teknisi is 'Grade dan kontribusi opsional; bonus memakai snapshot saat cair. Tidak tersambung kredit/kenaikan gaji.';
