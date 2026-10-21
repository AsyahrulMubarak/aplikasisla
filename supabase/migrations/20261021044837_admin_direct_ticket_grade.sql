-- Admins determine all grades directly; technicians/freelance still propose.
-- Existing pending rows are not auto-approved. Allocation, WA and salary rules stay unchanged.
set local lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.sla_penilaian_tiket(p_auth_id uuid, p_id_tiket text, p_action text, p_revision integer DEFAULT 0, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
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
    values(p_id_tiket,coalesce(t.cabang,'Kendari'),p_auth_id,u.username,case when p_action='proposeGrade' and managing then 'setGrade' else p_action end,prev,a);
  return jsonb_build_object('status','sukses','assessment',a,'candidates',candidates);
end;
$function$;
revoke all on function public.sla_penilaian_tiket(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.sla_penilaian_tiket(uuid,text,text,integer,jsonb) to service_role;
