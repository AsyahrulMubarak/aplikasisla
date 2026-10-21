-- Optional contribution: branch admins decide directly; technicians still propose.
-- No backfill of existing ticket assessments, payroll amounts or paid bonus snapshots.
set local lock_timeout='5s';
-- Equal shares follow current ticket assignees, matching the legacy bonus rule.
-- This helper only parses the ticket supplied by its caller; it reads no privileged table.
create or replace function public.sla_penilaian_bagi_rata(p_ticket public.tiket,p_lock boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $equal$
  with names as (
    select lower(regexp_replace(btrim(v),'\s+',' ','g')) as normalized_name,min(btrim(v)) as name
    from regexp_split_to_table(coalesce(p_ticket.teknisi,''),'[,;\n\r]') v
    where lower(btrim(v)) not in ('','-','belum ditugaskan')
    group by lower(regexp_replace(btrim(v),'\s+',' ','g'))
  ), numbered as (
    select *,row_number() over(order by normalized_name) as rn,count(*) over() as member_count from names
  )
  select jsonb_strip_nulls(jsonb_build_object('mode','equal','status',case when p_lock then 'approved' else 'default' end,
    'automatic',true,'assignment',array_to_string(public.sla_penilaian_nama(p_ticket.teknisi),','),
    'approvedName',case when p_lock then 'Bagi rata otomatis' end,
    'approvedAt',case when p_lock then statement_timestamp() end,
    'members',coalesce(jsonb_agg(jsonb_build_object('name',name,
      'share',(1000000/member_count + case when rn<=1000000%member_count then 1 else 0 end)/10000.0) order by normalized_name),'[]'::jsonb)))
  from numbered;
$equal$;
revoke all on function public.sla_penilaian_bagi_rata(public.tiket,boolean) from public,anon;
grant execute on function public.sla_penilaian_bagi_rata(public.tiket,boolean) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sla_penilaian_tiket(p_auth_id uuid, p_id_tiket text, p_action text, p_revision integer DEFAULT 0, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    if a is not null and a->'achievement' is null and a->'bonusSnapshot' is null and coalesce(a->'allocation'->>'status','default')='default' then
      a:=jsonb_set(a,'{allocation}',public.sla_penilaian_bagi_rata(t));
    end if;
    return jsonb_build_object('status','sukses','assessment',a,'candidates',candidates,'ticketStatus',t.status,'paid',t.status_pembayaran='Lunas');
  end if;
  if t.status in ('Cancel','Batal') then raise exception 'Tiket batal tidak dapat dinilai.'; end if;
  if coalesce((a->>'revision')::integer,0)<>p_revision then raise exception 'Penilaian sudah berubah. Muat ulang sebelum menyimpan.'; end if;
  if a is null then
    if p_action not in ('proposeGrade','proposeAllocation') then raise exception 'Ajukan grade atau pembagian terlebih dahulu.'; end if;
    if t.status_pembayaran='Lunas' then raise exception 'Tiket yang sudah cair tetap memakai pembagian historis.'; end if;
    if t.status='Selesai' and (t.waktu_selesai at time zone 'Asia/Makassar')::date < (date_trunc('month',now() at time zone 'Asia/Makassar'))::date then raise exception 'Riwayat bulan lalu tidak diubah melalui penilaian baru.'; end if;
    a:=jsonb_build_object('version',1,'revision',0,'startedAt',now(),'allocation',public.sla_penilaian_bagi_rata(t));
  end if;
  if a->'achievement' is not null then raise exception 'Pencapaian telah disahkan. Perubahan memerlukan koreksi tercatat.'; end if;
  reason:=btrim(coalesce(p_data->>'reason',''));
  if length(reason)>2000 then raise exception 'Alasan maksimal 2000 karakter.'; end if;
  if a->'bonusSnapshot' is null and coalesce(a->'allocation'->>'status','default')='default' then
    a:=jsonb_set(a,'{allocation}',public.sla_penilaian_bagi_rata(t));
  end if;
  if p_action='proposeGrade' then
    g:=p_data->>'grade'; pts:=case g when 'S' then 16 when 'A' then 8 when 'B' then 4 when 'C' then 2 when 'D' then 1 else null end;
    if pts is null or length(reason)<5 then raise exception 'Pilih grade dan jelaskan diagnosis/lingkup pekerjaan.'; end if;
    if managing and own_ticket then raise exception 'Admin yang juga pelaksana tiket memerlukan penetapan grade oleh admin lain.'; end if;
    -- The server decides from the saved role: staff propose; managers set directly.
    a:=jsonb_set(a,'{grade}',jsonb_build_object('value',g,'points',pts,'reason',reason,
      'status',case when managing then 'approved' else 'pending' end,
      'decisionMode',case when managing then 'direct' else 'proposal' end,
      'proposedBy',p_auth_id,'proposedName',u.nama_asli,'proposedAt',now(),'scope',t.jenis_pekerjaan));
    if managing then
      a:=jsonb_set(a,'{grade}',(a->'grade')||jsonb_build_object('reviewedBy',p_auth_id,'reviewedName',u.nama_asli,'reviewedAt',now(),'reviewNote','Ditetapkan langsung oleh pengelola cabang.'));
    end if;
  elsif p_action in ('approveGrade','rejectGrade') then
    g:=a->'grade'->>'value';
    if a->'grade'->>'status'<>'pending' or g is null then raise exception 'Tidak ada grade yang menunggu persetujuan.'; end if;
    if not managing then raise exception 'Persetujuan grade memerlukan admin cabang, Manager, atau Direktur.'; end if;
    -- An old admin proposal can be decided by that admin; recipients still need another reviewer.
    if own_ticket then raise exception 'Pelaksana atau penerima poin memerlukan penetapan grade oleh admin lain.'; end if;
    if p_action='rejectGrade' and length(reason)<5 then raise exception 'Isi alasan penolakan.'; end if;
    a:=jsonb_set(a,'{grade}',(a->'grade')||jsonb_build_object('status',case when p_action='approveGrade' then 'approved' else 'rejected' end,'reviewedBy',p_auth_id,'reviewedName',u.nama_asli,'reviewedAt',now(),'reviewNote',reason,'decisionMode','review'));
  elsif p_action in ('proposeAllocation','approveAllocation','rejectAllocation') then
    if a->'bonusSnapshot' is not null then raise exception 'Pembagian bonus telah dikunci saat pencairan.'; end if;
    if p_action='rejectAllocation' then
      if not managing or own_ticket then raise exception 'Penetapan kontribusi memerlukan admin cabang yang bukan pelaksana/penerima.'; end if;
      if a->'allocation'->>'status'<>'pending' or length(reason)<5 then raise exception 'Isi alasan penolakan usulan yang menunggu.'; end if;
      a:=jsonb_set(a,'{allocation}',(a->'allocation')||jsonb_build_object('status','rejected','reviewNote',reason,'reviewedBy',p_auth_id,'reviewedName',u.nama_asli,'reviewedAt',now()));
    else
      mode:=case when p_action='approveAllocation' then a->'allocation'->>'mode' else p_data->>'mode' end;
      if mode not in ('equal','custom') or mode is null then raise exception 'Mode pembagian tidak valid.'; end if;
      members:=case when p_action='approveAllocation' and mode='custom' then a->'allocation'->'members' else coalesce(p_data->'members',a->'allocation'->'members') end;
      if jsonb_typeof(members) is distinct from 'array' or jsonb_array_length(members) not between 1 and 32 then raise exception 'Konfirmasi 1 sampai 32 pelaksana.'; end if;
      cnt:=jsonb_array_length(members); i:=0; total:=0; duplicate_names:='{}'; members:=coalesce(members,'[]');
      for m in select e from jsonb_array_elements(members) e loop
        select e into c from jsonb_array_elements(candidates) e where e->>'username'=m->>'username' or
          (m->>'username' is null and lower(btrim(e->>'name'))=lower(btrim(m->>'name')));
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
        if managing and (recipient or own_ticket) then raise exception 'Admin yang juga penerima poin memerlukan penetapan kontribusi oleh admin lain.'; end if;
        a:=jsonb_set(a,'{allocation}',jsonb_build_object('mode',mode,'status',case when managing then 'approved' else 'pending' end,'members',members,'reason',reason,'proposedBy',p_auth_id,'proposedName',u.nama_asli,'proposedAt',now(),'teamConfirmed',mode='equal' or (p_data->>'teamConfirmed')::boolean));
        if managing then
          a:=jsonb_set(a,'{allocation}',(a->'allocation')||jsonb_build_object('approvedBy',p_auth_id,'approvedName',u.nama_asli,'approvedAt',now(),'assignment',array_to_string(public.sla_penilaian_nama(t.teknisi),','),'decisionMode','direct'));
        end if;
      else
        if not managing or recipient or own_ticket then raise exception 'Penetapan kontribusi memerlukan admin cabang yang bukan pelaksana/penerima.'; end if;
        if a->'allocation'->>'status' not in ('default','pending') then raise exception 'Ajukan ulang pembagian sebelum disahkan.'; end if;
        a:=jsonb_set(a,'{allocation}',(a->'allocation')||jsonb_build_object('members',members,'status','approved','automatic',false,'approvedBy',p_auth_id,'approvedName',u.nama_asli,'approvedAt',now(),'assignment',array_to_string(public.sla_penilaian_nama(t.teknisi),',')));
      end if;
    end if;
  elsif p_action='postAchievement' then
    if a->'bonusSnapshot' is null and coalesce(a->'allocation'->>'status','default')='default' then
      a:=jsonb_set(a,'{allocation}',public.sla_penilaian_bagi_rata(t,true));
    end if;
    if jsonb_array_length(coalesce(a->'allocation'->'members','[]')) not between 1 and 32 then raise exception 'Tentukan 1 sampai 32 teknisi pelaksana pada tiket terlebih dahulu.'; end if;
    g:=a->'grade'->>'value';
    if not managing or own_ticket then raise exception 'Pengesahan hasil memerlukan pengelola cabang yang bukan pelaksana.'; end if;
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
    values(p_id_tiket,coalesce(t.cabang,'Kendari'),p_auth_id,u.username,case when p_action='proposeGrade' and managing then 'setGrade' when p_action='proposeAllocation' and managing then 'setAllocation' else p_action end,prev,a);
  return jsonb_build_object('status','sukses','assessment',a,'candidates',candidates);
end;
$function$;
CREATE OR REPLACE FUNCTION public.sla_jaga_penilaian_tiket()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    if a->'achievement' is null and coalesce(a->'allocation'->>'status','default')='default' then
      a:=jsonb_set(a,'{allocation}',public.sla_penilaian_bagi_rata(new,true));
    end if;
    if jsonb_array_length(coalesce(a->'allocation'->'members','[]')) not between 1 and 32 then
      raise exception 'Tentukan 1 sampai 32 teknisi pelaksana sebelum mencairkan bonus.';
    end if;
    if a->'allocation'->>'status' is distinct from 'approved' or
       (a->'achievement' is null and a->'allocation'->>'assignment'<>array_to_string(public.sla_penilaian_nama(new.teknisi),',')) then
      raise exception 'Sahkan pembagian poin dan konfirmasi pelaksana sebelum mencairkan bonus.';
    end if;
    new.penilaian_teknisi:=jsonb_set(a,'{bonusSnapshot}',jsonb_build_object('members',a->'allocation'->'members','frozenAt',statement_timestamp()));
  end if;
  return new;
end;
$function$;
revoke all on function public.sla_penilaian_tiket(uuid,text,text,integer,jsonb),public.sla_jaga_penilaian_tiket() from public,anon,authenticated;
grant execute on function public.sla_penilaian_tiket(uuid,text,text,integer,jsonb),public.sla_jaga_penilaian_tiket() to service_role;
