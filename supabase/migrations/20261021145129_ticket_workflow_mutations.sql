create or replace function public.sla_tiket_workflow(p_auth_id uuid,p_id_tiket text,p_action text,p_revision integer,p_request_id uuid,p_patch jsonb,p_context jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.users%rowtype;t public.tiket%rowtype;n public.tiket%rowtype;a public.sla_konteks_pekerjaan_audit%rowtype;
 access text; managing boolean; own_ticket boolean; allowed text[]; key text; category text; evidence text; reason text; handover text;
 followup timestamptz; event jsonb; context jsonb; fingerprint text; prev_marker text; cnt integer; canonical text; member text; normalized text[]; names text[]:='{}';
begin
 if coalesce(auth.role(),'')<>'service_role' or p_auth_id is null then raise exception 'Sesi server diperlukan.'; end if;
 if p_action not in ('pending','replacement') or p_request_id is null or p_revision is null or p_revision<0 or p_id_tiket !~ '^TKT-[A-Za-z0-9-]+$' then raise exception 'Permintaan tiket tidak valid.'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_context) is distinct from 'object' then raise exception 'Data formulir tidak valid.'; end if;
 select * into strict u from public.users where auth_id=p_auth_id;
 select * into strict t from public.tiket where id_tiket=p_id_tiket for update;
 access:=lower(coalesce(nullif(btrim(u.hak_akses_cabang),''),u.cabang,''));
 managing:=lower(u.role) in ('admin','admin_raha','manager','direktur');
 own_ticket:=lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))=any(public.sla_penilaian_nama(t.teknisi));
 if access not in ('kendari','raha','semua') or (access<>'semua' and access<>lower(coalesce(t.cabang,'Kendari'))) then raise exception 'Cabang tiket di luar hak akses.'; end if;
 if not managing and not (lower(u.role) in ('teknisi','freelance') and own_ticket and p_action='pending') then raise exception 'Anda tidak berhak mengubah alur tiket ini.'; end if;
 fingerprint:=md5(jsonb_build_object('patch',p_patch,'context',p_context)::text);
 select * into a from public.sla_konteks_pekerjaan_audit where request_id=p_request_id;
 if found then
  if a.id_tiket<>p_id_tiket or a.actor_auth_id<>p_auth_id or a.event->>'fingerprint'<>fingerprint then raise exception 'ID permintaan sudah dipakai untuk data berbeda.'; end if;
  return jsonb_build_object('status','sukses','replayed',true,'data',jsonb_build_array(to_jsonb(t)));
 end if;
 if t.versi_workflow<>p_revision then raise exception 'Tiket sudah berubah. Muat ulang sebelum menyimpan agar riwayat tidak tertimpa.'; end if;
 if t.status in ('Cancel','Batal','Selesai','Closed') then raise exception 'Tiket tertutup memerlukan koreksi tercatat, bukan pending atau pergantian baru.'; end if;
 if p_action='pending' then
  allowed:=array['status','keterangan','deskripsi_pekerjaan_ba','nama_customer','kritik_saran','tanda_tangan','cabang','admin_sla','waktu_respon','status_sla_respon','waktu_selesai','status_sla'];
 else
  allowed:=array['no_transaksi','target_sla_jam','klien_lokasi','jenis_pekerjaan','teknisi','sales','target_sla_respon_jam','nilai_penjualan','no_wa_klien','cabang','admin_sla','tanda_tangan','nama_customer','teknisi_sebelumnya','penalti_teknisi_lama','tenggat_pengganti','waktu_respon','tenggat_respon','keterangan'];
 end if;
 for key in select jsonb_object_keys(p_patch) loop if not key=any(allowed) then raise exception 'Kolom tidak diizinkan: %',key; end if; end loop;
 n:=jsonb_populate_record(t,p_patch);
 if coalesce(n.cabang,'Kendari') is distinct from coalesce(t.cabang,'Kendari') then raise exception 'Cabang tiket tidak dapat dipindahkan melalui form ini.'; end if;
 if length(coalesce(t.tanda_tangan,''))>50 and (n.tanda_tangan is distinct from t.tanda_tangan or nullif(t.nama_customer,'') is not null and n.nama_customer is distinct from t.nama_customer) then raise exception 'Nama PIC dan tanda tangan tersimpan tetap dikunci.'; end if;
 category:=p_context->>'category'; evidence:=btrim(coalesce(p_context->>'evidence',''));reason:=btrim(coalesce(p_context->>'reason',''));handover:=btrim(coalesce(p_context->>'handover',''));
 if category is null or length(evidence)<5 or length(evidence)>2000 then raise exception 'Pilih kategori dan isi rujukan bukti minimal 5 karakter.'; end if;
 if length(reason)>2000 or length(handover)>4000 then raise exception 'Catatan terlalu panjang.'; end if;
 event:=jsonb_build_object('id',p_request_id,'kind',p_action,'at',statement_timestamp(),'category',category,'evidence',evidence,'reason',reason,'actor',u.username,'actorName',u.nama_asli,'technicians',t.teknisi,'fingerprint',fingerprint,'reviewStatus','unreviewed');
 if p_action='pending' then
  if n.status is distinct from 'Pending' or category not in ('client_approval','site_unavailable','parts_vendor','technical_internal','other') or length(reason)<5 then raise exception 'Lengkapi status Pending, kategori kendala, dan log penjelasan minimal 5 karakter.'; end if;
  followup:=(p_context->>'followUpAt')::timestamptz;
  if followup is null or followup<=statement_timestamp() or followup>statement_timestamp()+interval '1 year' then raise exception 'Jadwal tindak lanjut WITA harus setelah waktu sekarang dan maksimal satu tahun.'; end if;
  n.waktu_selesai:=null;n.status_sla:='DIPENDING';
  if t.waktu_respon is null and t.status in ('Menunggu','Claim Garansi') then n.waktu_respon:=statement_timestamp();n.status_sla_respon:=case when t.tenggat_respon is not null and statement_timestamp()>t.tenggat_respon then 'GAGAL' else 'TERPENUHI' end;
  else n.waktu_respon:=t.waktu_respon;n.status_sla_respon:=t.status_sla_respon;end if;
  event:=event||jsonb_build_object('followUpAt',followup);
  n.keterangan:=concat_ws(E'\n\n',nullif(t.keterangan,''),'['||to_char(statement_timestamp() at time zone 'Asia/Makassar','DD/MM/YYYY, HH24.MI')||'] ➔ Pending'||E'\n '||reason);
 else
  if not managing or category not in ('rotation_schedule','specialist_support','client_request','execution_issue','other') or length(reason)<5 or length(handover)<10 then raise exception 'Pergantian memerlukan admin, alasan, serta hasil dan sisa pekerjaan minimal 10 karakter.'; end if;
  if t.penilaian_teknisi->'achievement' is not null or t.penilaian_teknisi->'bonusSnapshot' is not null then raise exception 'Pembagian pencapaian/bonus sudah dikunci; pergantian memerlukan koreksi Manajemen.'; end if;
  normalized:=public.sla_penilaian_nama(n.teknisi);
  if cardinality(public.sla_penilaian_nama(t.teknisi))=0 or normalized=public.sla_penilaian_nama(t.teknisi) then raise exception 'Pilih perubahan teknisi pada tiket yang sudah ditugaskan.'; end if;
  if cardinality(normalized)>32 then raise exception 'Maksimal 32 teknisi.'; end if;
  foreach member in array normalized loop
   select count(*),max(x.nama_asli) into cnt,canonical from public.users x where lower(regexp_replace(btrim(x.nama_asli),'\s+',' ','g'))=member and lower(x.role) in ('teknisi','freelance') and public.sla_gaji_cabang(x)=coalesce(t.cabang,'Kendari');
   if cnt<>1 then raise exception 'Teknisi penerima harus memiliki profil unik di cabang tiket.'; end if;
   names:=array_append(names,canonical);
  end loop;
  n.teknisi:=coalesce(nullif(array_to_string(names,', '),''),'Belum Ditugaskan');
  if n.target_sla_jam is null or n.target_sla_jam !~ '^\d+(\.\d+)?$' or n.target_sla_jam::numeric<=0 or n.target_sla_jam::numeric>1000 or coalesce(n.target_sla_respon_jam,0)<=0 or n.target_sla_respon_jam>1000 then raise exception 'Target SLA harus lebih dari 0 dan maksimal 1000 jam.'; end if;
  n.teknisi_sebelumnya:=t.teknisi;
  n.penalti_teknisi_lama:=t.teknisi||' | Respon: '||coalesce(t.status_sla_respon,'AMAN')||' | Kerja: '||coalesce(t.status_sla,'AMAN');
  if coalesce((p_context->>'resetSla')::boolean,false) then
   n.tenggat_pengganti:=case when cardinality(names)>0 then public.sla_tenggat_pengerjaan(statement_timestamp(),n.target_sla_jam::numeric,coalesce(t.cabang,'Kendari')) else null end;
   n.tenggat_respon:=case when cardinality(names)>0 then public.sla_tenggat_pengerjaan(statement_timestamp(),n.target_sla_respon_jam,coalesce(t.cabang,'Kendari')) else null end;
   n.waktu_respon:=null;
  else n.tenggat_pengganti:=t.tenggat_pengganti;n.tenggat_respon:=t.tenggat_respon;n.waktu_respon:=t.waktu_respon;end if;
  event:=event||jsonb_build_object('from',t.teknisi,'to',n.teknisi,'handover',handover,'resetSla',coalesce((p_context->>'resetSla')::boolean,false),'previousWorkDeadline',t.tenggat_waktu,'previousResponseDeadline',t.tenggat_respon);
  n.keterangan:=concat_ws(E'\n\n',nullif(t.keterangan,''),'['||to_char(statement_timestamp() at time zone 'Asia/Makassar','DD/MM/YYYY, HH24.MI')||'] 🔄 PERGANTIAN TEKNISI'||E'\nDari: '||t.teknisi||E'\nKe: '||n.teknisi);
 end if;
 context:=coalesce(t.konteks_pekerjaan,jsonb_build_object('version',1,'events','[]'::jsonb));
 if jsonb_array_length(context->'events')>=1000 then raise exception 'Riwayat alasan perlu diarsipkan oleh Manajemen.'; end if;
 context:=jsonb_set(context,'{events}',coalesce(context->'events','[]')||jsonb_build_array(event));
 prev_marker:=current_setting('sla.workflow_write',true);perform set_config('sla.workflow_write','on',true);
 update public.tiket set status=n.status,keterangan=n.keterangan,deskripsi_pekerjaan_ba=n.deskripsi_pekerjaan_ba,nama_customer=n.nama_customer,kritik_saran=n.kritik_saran,tanda_tangan=n.tanda_tangan,
  admin_sla=n.admin_sla,waktu_respon=n.waktu_respon,status_sla_respon=n.status_sla_respon,waktu_selesai=n.waktu_selesai,status_sla=n.status_sla,
  no_transaksi=n.no_transaksi,target_sla_jam=n.target_sla_jam,klien_lokasi=n.klien_lokasi,jenis_pekerjaan=n.jenis_pekerjaan,teknisi=n.teknisi,sales=n.sales,target_sla_respon_jam=n.target_sla_respon_jam,nilai_penjualan=n.nilai_penjualan,no_wa_klien=n.no_wa_klien,
  teknisi_sebelumnya=n.teknisi_sebelumnya,penalti_teknisi_lama=n.penalti_teknisi_lama,tenggat_pengganti=n.tenggat_pengganti,tenggat_respon=n.tenggat_respon,konteks_pekerjaan=context
 where id_tiket=p_id_tiket returning * into t;
 perform set_config('sla.workflow_write',coalesce(prev_marker,''),true);
 insert into public.sla_konteks_pekerjaan_audit(id_tiket,cabang,request_id,actor_username,actor_auth_id,action,event) values(t.id_tiket,coalesce(t.cabang,'Kendari'),p_request_id,u.username,p_auth_id,p_action,event);
 return jsonb_build_object('status','sukses','replayed',false,'data',jsonb_build_array(to_jsonb(t)));
end $$;
revoke all on function public.sla_tiket_workflow(uuid,text,text,integer,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sla_tiket_workflow(uuid,text,text,integer,uuid,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
