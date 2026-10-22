-- Official sales assessment starts November 2026 and uses saved monthly targets.
CREATE OR REPLACE FUNCTION public.sla_performa_sumber_teknisi(p_username text, p_periode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare u public.users%rowtype; result jsonb; branch text; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if p_periode !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_periode<'2026-10' or p_periode>to_char(public.sla_gaji_sekarang() at time zone 'Asia/Makassar','YYYY-MM') then raise exception 'Periode belum tersedia.'; end if;
 select * into strict u from public.users where username=p_username;
 branch:=public.sla_gaji_cabang(u);
 with related as (
  select t.* from public.tiket t where coalesce(t.cabang,'Kendari')=branch and (
   lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))=any(public.sla_penilaian_nama(coalesce(t.teknisi,'')||','||coalesce(t.teknisi_sebelumnya,'')))
   or exists(select 1 from jsonb_array_elements(coalesce(t.riwayat_penggantian_teknisi,'[]')) h where lower(btrim(u.nama_asli))=any(public.sla_penilaian_nama(coalesce(h->>'dari','')||','||coalesce(h->>'ke',''))))
   or exists(select 1 from jsonb_array_elements(coalesce(t.penilaian_teknisi->'achievement'->'members','[]')) m where m->>'username'=u.username or lower(btrim(m->>'name'))=lower(btrim(u.nama_asli)))
  )
 ), selected as (
  select * from related r where
   p_periode=any(array[to_char(r.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.waktu_penugasan at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.waktu_selesai at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.tenggat_waktu at time zone 'Asia/Makassar','YYYY-MM'),to_char(r.tenggat_respon at time zone 'Asia/Makassar','YYYY-MM')])
   or exists(select 1 from jsonb_array_elements(coalesce(r.riwayat_penggantian_teknisi,'[]')) h where to_char(nullif(h->>'waktu','')::timestamptz at time zone 'Asia/Makassar','YYYY-MM')=p_periode)
   or exists(select 1 from public.garansi g where g.referensi_tiket_nota=r.id_tiket and g.cabang=branch and g.tanggal_mulai<((p_periode||'-01')::date+interval '1 month') at time zone 'Asia/Makassar' and g.tanggal_habis>=((p_periode||'-01')::date) at time zone 'Asia/Makassar')
   or exists(select 1 from public.tiket c where c.referensi_tiket_asal=r.id_tiket and c.cabang=branch and to_char(c.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode)
  union select t.* from public.tiket t where t.cabang=branch and to_char(t.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode and exists(select 1 from related r where t.referensi_tiket_asal=r.id_tiket or t.garansi_asal in(select g.id_garansi from public.garansi g where g.referensi_tiket_nota=r.id_tiket and g.cabang=branch))
 ) select jsonb_build_object('period',p_periode,'profile',jsonb_build_object('username',u.username,'name',u.nama_asli,'branch',branch),
  'duplicateName',(select count(*)<>1 from public.users x where lower(btrim(x.nama_asli))=lower(btrim(u.nama_asli)) and public.sla_gaji_cabang(x)=branch),
  'tickets',coalesce((select jsonb_agg(jsonb_build_object(
   'id_tiket',t.id_tiket,'teknisi',t.teknisi,'teknisi_sebelumnya',t.teknisi_sebelumnya,'status',t.status,
   'waktu_selesai',t.waktu_selesai,'waktu_lapor',t.waktu_lapor,'waktu_penugasan',t.waktu_penugasan,
   'tenggat_waktu',t.tenggat_waktu,'tenggat_respon',t.tenggat_respon,'waktu_respon',t.waktu_respon,
   'penilaian_teknisi',t.penilaian_teknisi-'bonusSnapshot','konteks_pekerjaan',t.konteks_pekerjaan,'riwayat_penggantian_teknisi',t.riwayat_penggantian_teknisi,
   'penalti_teknisi_lama',t.penalti_teknisi_lama,'keterangan',t.keterangan,
   'garansi_asal',t.garansi_asal,'referensi_tiket_asal',t.referensi_tiket_asal) order by t.id_tiket) from selected t),'[]'),
  'warranties',coalesce((select jsonb_agg(jsonb_build_object('id_garansi',g.id_garansi,'referensi_tiket_nota',g.referensi_tiket_nota,
    'tanggal_mulai',g.tanggal_mulai,'tanggal_habis',g.tanggal_habis,'item_garansi',g.item_garansi,'riwayat_klaim_item',g.riwayat_klaim_item) order by g.id_garansi)
    from public.garansi g where g.cabang=branch and g.referensi_tiket_nota in(select id_tiket from selected) and
    (g.tanggal_mulai<((p_periode||'-01')::date+interval '1 month') at time zone 'Asia/Makassar' and g.tanggal_habis>=((p_periode||'-01')::date) at time zone 'Asia/Makassar'
     or exists(select 1 from public.tiket c where c.cabang=branch and (c.garansi_asal=g.id_garansi or c.referensi_tiket_asal=g.referensi_tiket_nota) and to_char(c.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode))),'[]'),
  'unknownWarrantyClaims',(select count(*) from public.tiket t where t.cabang=branch and nullif(t.garansi_asal,'') is not null and nullif(t.referensi_tiket_asal,'') is null and to_char(t.waktu_lapor at time zone 'Asia/Makassar','YYYY-MM')=p_periode)
  ,'episodes',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.sla_performa_episode e where e.cabang=branch and lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))=any(public.sla_penilaian_nama(e.teknisi)) and p_periode=any(array[to_char(e.waktu_pergantian at time zone 'Asia/Makassar','YYYY-MM'),to_char(e.tenggat_waktu at time zone 'Asia/Makassar','YYYY-MM'),to_char(e.tenggat_respon at time zone 'Asia/Makassar','YYYY-MM')])),'[]')
 ) into result;
 return jsonb_build_object('data',result,'hash',md5(result::text));
end $function$;
create or replace function public.sla_performa_sumber(p_username text,p_periode text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare u public.users%rowtype; result jsonb; v_branch text; v_start timestamptz; v_end timestamptz;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 select * into strict u from public.users where username=p_username;
 if lower(u.role)<>'sales' then return public.sla_performa_sumber_teknisi(p_username,p_periode); end if;
 if p_periode !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_periode<'2026-10' or p_periode>to_char(public.sla_gaji_sekarang() at time zone 'Asia/Makassar','YYYY-MM') then raise exception 'Periode belum tersedia.'; end if;
 v_branch:=public.sla_gaji_cabang(u);
 v_start:=((p_periode||'-01')::date)::timestamp at time zone 'Asia/Makassar';
 v_end:=((p_periode||'-01')::date+interval '1 month') at time zone 'Asia/Makassar';
 with warranty_rows as (
  select g.id_garansi,g.referensi_tiket_nota,g.no_transaksi,g.tanggal_mulai,g.sales,g.omzet from public.garansi g left join public.tiket t on t.id_tiket=g.referensi_tiket_nota and coalesce(t.cabang,'Kendari')=v_branch
  where coalesce(g.cabang,'Kendari')=v_branch and coalesce(g.tanggal_mulai,t.tanggal_lunas,t.waktu_selesai,t.waktu_lapor)>=v_start
   and coalesce(g.tanggal_mulai,t.tanggal_lunas,t.waktu_selesai,t.waktu_lapor)<v_end
 ), sale_rows as (
  select s.* from public.penjualan s where coalesce(s.cabang,'Kendari')=v_branch and (
   s.waktu_lapor>=v_start and s.waktu_lapor<v_end
   or exists(select 1 from warranty_rows g where upper(btrim(g.referensi_tiket_nota)) in (upper(btrim(s.id_penjualan)),upper(btrim(s.no_transaksi)))))
 ), followups as (
  select f.* from public.sla_sales_followups f where f.cabang=v_branch and f.username=u.username and f.waktu_kontak>=v_start and f.waktu_kontak<v_end
 ), prospects as (
  select p.id_prospek,p.tanggal_input,p.status_prospek,p.sales_penanggung_jawab,p.no_wa from public.prospek p where coalesce(p.cabang,'Kendari')=v_branch
   and lower(regexp_replace(btrim(u.nama_asli),'\s+',' ','g'))=any(public.sla_penilaian_nama(p.sales_penanggung_jawab))
   and (p.tanggal_input>=v_start and p.tanggal_input<v_end or p.id_prospek in(select f.id_prospek from followups f))
 )
 select jsonb_build_object('period',p_periode,'profile',jsonb_build_object('username',u.username,'name',u.nama_asli,'branch',v_branch,'role','sales'),
  'duplicateName',(select count(*)<>1 from public.users x where lower(btrim(x.nama_asli))=lower(btrim(u.nama_asli)) and public.sla_gaji_cabang(x)=v_branch),
  'salesTarget',(select jsonb_build_object('omzet',t.omzet,'konversi',t.konversi,'followup_harian',t.followup_harian,'bukti_wajib',t.bukti_wajib)
   from public.sla_sales_targets t where t.username=u.username and t.cabang=v_branch and t.periode=p_periode),
  'sales',coalesce((select jsonb_agg(jsonb_build_object('id_penjualan',s.id_penjualan,'no_transaksi',s.no_transaksi,
   'waktu_lapor',case when s.waktu_lapor>=v_start and s.waktu_lapor<v_end then s.waktu_lapor end,
   'nominal_rp',case when s.waktu_lapor>=v_start and s.waktu_lapor<v_end then s.nominal_rp end,
   'sales',case when s.waktu_lapor>=v_start and s.waktu_lapor<v_end then s.sales end) order by s.id_penjualan) from sale_rows s),'[]'),
  'salesWarranties',coalesce((select jsonb_agg(jsonb_build_object('id_garansi',g.id_garansi,'referensi_tiket_nota',g.referensi_tiket_nota,
   'no_transaksi',g.no_transaksi,'tanggal_mulai',g.tanggal_mulai,'sales',g.sales,'omzet',g.omzet) order by g.id_garansi) from warranty_rows g),'[]'),
  'salesTickets',coalesce((select jsonb_agg(jsonb_build_object('id_tiket',t.id_tiket,'no_transaksi',t.no_transaksi,'sales',t.sales,
   'tanggal_lunas',t.tanggal_lunas,'waktu_selesai',t.waktu_selesai,'waktu_lapor',t.waktu_lapor) order by t.id_tiket) from public.tiket t
   where coalesce(t.cabang,'Kendari')=v_branch and t.id_tiket in(select g.referensi_tiket_nota from warranty_rows g)),'[]'),
  'salesProspects',coalesce((select jsonb_agg(jsonb_build_object('id_prospek',p.id_prospek,'tanggal_input',p.tanggal_input,
   'status_prospek',case when p.tanggal_input>=v_start and p.tanggal_input<v_end then p.status_prospek end,
   'sales_penanggung_jawab',p.sales_penanggung_jawab,'no_wa',p.no_wa) order by p.id_prospek) from prospects p),'[]'),
  'salesFollowups',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'id_prospek',f.id_prospek,'username',f.username,'waktu_kontak',f.waktu_kontak,
   'bukti_jenis',f.bukti_jenis,'bukti_path',f.bukti_path) order by f.id) from followups f),'[]'),
  'salesHolidays',coalesce((select jsonb_agg(jsonb_build_object('tanggal_libur_tambahan',p.tanggal_libur_tambahan)) from public.payroll_bulanan p
   where p.periode=p_periode and coalesce(p.cabang,'Kendari')=v_branch and lower(btrim(p.nama_pegawai))=lower(btrim(u.nama_asli))),'[]'),
  'salesLeaves',coalesce((select jsonb_agg(jsonb_build_object('status',p.status,'tanggal_mulai',p.tanggal_mulai,'tanggal_selesai',p.tanggal_selesai,
   'kembali_bekerja_pada',least(p.kembali_bekerja_pada,(select min(a.waktu_absen) from public.absensi a
    where lower(btrim(a.nama_pegawai))=lower(btrim(u.nama_asli)) and coalesce(a.cabang,'Kendari')=v_branch
    and a.waktu_absen>=p.tanggal_mulai::timestamp at time zone 'Asia/Makassar' and a.tipe_absen in ('Masuk','Masuk Setelah Istirahat')
    and coalesce(a.status_disiplin,'') !~* 'Lupa Absen Masuk|Koreksi|Auto'))) order by p.id_pengajuan) from public.pengajuan_cuti p
   where p.status='Disetujui' and p.jenis in ('Sakit','Izin') and coalesce(p.cabang,'Kendari')=v_branch
   and lower(btrim(p.nama_pegawai))=lower(btrim(u.nama_asli)) and p.tanggal_mulai<((p_periode||'-01')::date+interval '1 month')
   and (p.tanggal_selesai is null or p.tanggal_selesai>=(p_periode||'-01')::date)),'[]')
 ) into result;
 return jsonb_build_object('data',result,'hash',md5(result::text));
end $$;
revoke all on function public.sla_performa_sumber_teknisi(text,text),public.sla_performa_sumber(text,text) from public,anon,authenticated;
grant execute on function public.sla_performa_sumber_teknisi(text,text),public.sla_performa_sumber(text,text) to service_role;

CREATE OR REPLACE FUNCTION public.sla_performa_akses(p_auth_id uuid, p_username text DEFAULT NULL::text, p_periode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor public.users%rowtype; target public.users%rowtype; access text; managing boolean; source jsonb; saved jsonb; program public.sla_gaji_program%rowtype; attendance jsonb; begin
 if coalesce(auth.role(),'')<>'service_role' or p_auth_id is null then raise exception 'Akses server diperlukan.'; end if;
 select * into strict actor from public.users where auth_id=p_auth_id;
 access:=lower(coalesce(nullif(btrim(actor.hak_akses_cabang),''),actor.cabang,''));
 managing:=lower(actor.role) in ('admin','admin_raha','manager','direktur');
 if access not in ('kendari','raha','semua') then raise exception 'Hak cabang tidak valid.'; end if;
 if p_username is null then return jsonb_build_object('status','sukses','managing',managing,'users',coalesce((select jsonb_agg(jsonb_build_object('username',u.username,'name',u.nama_asli,'branch',public.sla_gaji_cabang(u),'role',lower(u.role)) order by u.nama_asli) from public.users u where lower(u.role) in ('teknisi','freelance','sales') and (u.username=actor.username or managing and (access='semua' or public.sla_gaji_cabang(u)=initcap(access)))),'[]')); end if;
 select * into strict target from public.users where username=p_username;
 if lower(target.role) not in ('teknisi','freelance','sales') or not (target.username=actor.username or managing and (access='semua' or public.sla_gaji_cabang(target)=initcap(access))) then raise exception 'Akses rekap ditolak.'; end if;
 source:=public.sla_performa_sumber(p_username,p_periode);
 select to_jsonb(r) into saved from public.sla_performa_bulan r where username=p_username and periode=p_periode;
 select * into program from public.sla_gaji_program where username=p_username;
 if public.sla_gaji_sekarang()>=((p_periode||'-01')::date+interval '1 month 7 days') at time zone 'Asia/Makassar' then
  select jsonb_build_object('telat_pagi',d.telat_pagi,'alpa',d.alpa) into attendance from public.sla_gaji_disiplin_bulan d where d.username=p_username and d.periode=p_periode;
  if attendance is null then select to_jsonb(d) into attendance from public.sla_disiplin_kenaikan_gaji(p_username,p_periode) d; end if;
 end if;
 return jsonb_build_object('status','sukses','source',source,'saved',saved,'attendance',attendance,
  'eligible',case when lower(target.role)='sales' then p_periode>='2026-11' else public.sla_gaji_cabang(target) in ('Kendari','Raha') and coalesce(target.gaji_pokok,0)>0 and coalesce(target.gaji_pokok,0)<3000000 and program.username is not null and not program.otomatis_selesai and p_periode>=greatest(program.mulai_periode,case when public.sla_gaji_cabang(target)='Raha' then '2026-11' else '2026-10' end) end,
 'salaryCreditEligible',public.sla_gaji_cabang(target) in ('Kendari','Raha') and coalesce(target.gaji_pokok,0)>0 and coalesce(target.gaji_pokok,0)<3000000 and program.username is not null and not program.otomatis_selesai and p_periode>=greatest(program.mulai_periode,case when public.sla_gaji_cabang(target)='Raha' then '2026-11' else '2026-10' end),
  'programStart',program.mulai_periode,'canApprove',managing and target.username<>actor.username,
  'closed',public.sla_gaji_sekarang()>=((p_periode||'-01')::date+interval '1 month 7 days') at time zone 'Asia/Makassar',
  'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.periode,c.sumber) from public.sla_gaji_kredit c where c.username=p_username),'[]'));
end $function$;
CREATE OR REPLACE FUNCTION public.sla_performa_sahkan(p_auth_id uuid, p_username text, p_periode text, p_revision integer, p_hash text, p_input jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare context jsonb; prev jsonb; rowdata jsonb; actor text; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('performance:'||p_username||':'||p_periode,0));
 context:=public.sla_performa_akses(p_auth_id,p_username,p_periode);
 if not (context->>'canApprove')::boolean then raise exception 'Pengesahan memerlukan admin cabang lain, Manager atau Direktur.'; end if;
 if not (context->>'closed')::boolean or p_periode<'2026-11' then raise exception 'Pengesahan dimulai November dan setelah masa koreksi tanggal 7 berakhir.'; end if;
 if not (context->>'eligible')::boolean then raise exception 'Pegawai/periode berada di luar program kenaikan gaji.'; end if;
 if context->'source'->>'hash' is distinct from p_hash then raise exception 'Data tiket berubah. Muat ulang rekap sebelum mengesahkan.'; end if;
 prev:=context->'saved';
 if coalesce((prev->>'revision')::integer,0)<>p_revision then raise exception 'Rekap sudah berubah. Muat ulang.'; end if;
 if exists(select 1 from public.sla_gaji_kredit where username=p_username and periode=p_periode and sumber='performa' and kenaikan_id is not null) then raise exception 'Kredit sudah dipakai; koreksi memerlukan penyesuaian Manajemen.'; end if;
 if p_result->>'period' is distinct from p_periode or (case when context->'source'->'data'->'profile'->>'role'='sales' then p_result->'policy'->>'kind' is distinct from 'sales' or p_result->'policy'->>'version' is distinct from '1' else p_result->'policy'->>'version' is distinct from '2' end) or coalesce((p_result->>'complete')::boolean,false) is not true then raise exception 'Lengkapi pengesahan pencapaian, sampel, dan tinjauan mutu.'; end if;
 select username into strict actor from public.users where auth_id=p_auth_id;
 insert into public.sla_performa_bulan(username,periode,revision,input,hasil,source_hash,disahkan_oleh,disahkan_pada)
 values(p_username,p_periode,p_revision+1,p_input,p_result,p_hash,actor,public.sla_gaji_sekarang())
 on conflict(username,periode) do update set revision=excluded.revision,input=excluded.input,hasil=excluded.hasil,source_hash=excluded.source_hash,disahkan_oleh=excluded.disahkan_oleh,disahkan_pada=excluded.disahkan_pada;
 select to_jsonb(r) into rowdata from public.sla_performa_bulan r where username=p_username and periode=p_periode;
 insert into public.sla_performa_audit(username,periode,actor,sebelum,sesudah) values(p_username,p_periode,actor,prev,rowdata);
 -- Credit is reserved now, but salary changes only through the established daily evaluator.
 delete from public.sla_gaji_kredit where username=p_username and periode=p_periode and sumber='performa' and kenaikan_id is null;
 if (p_result->>'pass')::boolean and coalesce((context->>'salaryCreditEligible')::boolean,false) then insert into public.sla_gaji_kredit(username,periode,sumber) values(p_username,p_periode,'performa') on conflict do nothing; end if;
 return jsonb_build_object('status','sukses','saved',rowdata);
end $function$;
-- Carry forward only the targets the user already set for Juna and Ardan.
insert into public.sla_sales_targets(cabang,periode,username,omzet,konversi,followup_harian,bukti_wajib,updated_by)
 select cabang,'2026-11',username,omzet,konversi,followup_harian,bukti_wajib,updated_by from public.sla_sales_targets
 where periode='2026-10' and username in ('juna','ardan') on conflict do nothing;
notify pgrst,'reload schema';
