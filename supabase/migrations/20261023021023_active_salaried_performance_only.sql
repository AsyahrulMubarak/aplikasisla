-- Only active employees with positive base salary participate in performance recaps.
-- Keep past reviews, credits, salary history and ticket contribution shares intact.
CREATE OR REPLACE FUNCTION public.sla_performa_akses(p_auth_id uuid, p_username text DEFAULT NULL::text, p_periode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare actor public.users%rowtype; target public.users%rowtype; access text; managing boolean; source jsonb; saved jsonb; program public.sla_gaji_program%rowtype; attendance jsonb; begin
 if coalesce(auth.role(),'')<>'service_role' or p_auth_id is null then raise exception 'Akses server diperlukan.'; end if;
 select * into strict actor from public.users where auth_id=p_auth_id;
 if actor.account_active is not true then raise exception 'Akun nonaktif.'; end if;
 access:=lower(coalesce(nullif(btrim(actor.hak_akses_cabang),''),actor.cabang,''));
 managing:=lower(actor.role) in ('admin','admin_raha','manager','direktur');
 if access not in ('kendari','raha','semua') then raise exception 'Hak cabang tidak valid.'; end if;
 if p_username is null then return jsonb_build_object('status','sukses','managing',managing,'users',coalesce((select jsonb_agg(jsonb_build_object('username',u.username,'name',u.nama_asli,'branch',public.sla_gaji_cabang(u),'role',lower(u.role)) order by u.nama_asli) from public.users u where u.account_active is true and coalesce(u.gaji_pokok,0)>0 and lower(u.role) in ('teknisi','freelance','sales') and (u.username=actor.username or managing and (access='semua' or public.sla_gaji_cabang(u)=initcap(access)))),'[]')); end if;
 select * into strict target from public.users where username=p_username;
 if lower(target.role) not in ('teknisi','freelance','sales') or not (target.username=actor.username or managing and (access='semua' or public.sla_gaji_cabang(target)=initcap(access))) then raise exception 'Akses rekap ditolak.'; end if;
 if target.account_active is not true or coalesce(target.gaji_pokok,0)<=0 then raise exception 'Rekap hanya untuk pegawai aktif dengan gaji pokok.'; end if;
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

CREATE OR REPLACE FUNCTION public.sla_performa_sumber(p_username text, p_periode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare u public.users%rowtype; result jsonb; v_branch text; v_start timestamptz; v_end timestamptz;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 select * into strict u from public.users where username=p_username;
 if u.account_active is not true or coalesce(u.gaji_pokok,0)<=0 then raise exception 'Rekap hanya untuk pegawai aktif dengan gaji pokok.'; end if;
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
  'duplicateName',(select count(*)<>1 from public.users x where x.account_active is true and lower(btrim(x.nama_asli))=lower(btrim(u.nama_asli)) and public.sla_gaji_cabang(x)=v_branch),
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
end $function$;

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
 if u.account_active is not true or coalesce(u.gaji_pokok,0)<=0 then raise exception 'Rekap hanya untuk pegawai aktif dengan gaji pokok.'; end if;
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
  'duplicateName',(select count(*)<>1 from public.users x where x.account_active is true and lower(btrim(x.nama_asli))=lower(btrim(u.nama_asli)) and public.sla_gaji_cabang(x)=branch),
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

CREATE OR REPLACE FUNCTION public.sla_performa_sahkan(p_auth_id uuid, p_username text, p_periode text, p_revision integer, p_hash text, p_input jsonb, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare context jsonb; prev jsonb; rowdata jsonb; actor text; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 -- Match the evaluator lock order so deactivation and approval serialize.
 perform 1 from public.users where username=p_username for share;
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

CREATE OR REPLACE FUNCTION public.sla_evaluasi_kenaikan_gaji()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_now timestamptz:=public.sla_gaji_sekarang(); v_local timestamp:=v_now at time zone 'Asia/Makassar';
 v_last date; v_period text; v_start date; v_user public.users%rowtype; v_program record; v_stats record;
 v_months text[]; v_keys text[]; v_id uuid; v_salary numeric; v_count integer; v_evaluated integer:=0; v_raised integer:=0;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 if not pg_try_advisory_xact_lock(734252611) then return jsonb_build_object('status','sibuk'); end if;
 v_last:=(date_trunc('month',v_local)-case when extract(day from v_local)>=8 then interval '1 month' else interval '2 months' end)::date;
 for v_program in select * from public.sla_gaji_program where not otomatis_selesai order by username loop
  select * into v_user from public.users where username=v_program.username for update;
  if not found or v_user.account_active is not true or coalesce(v_user.gaji_pokok,0)<=0 or v_user.gaji_pokok>=3000000 or public.sla_gaji_cabang(v_user) not in ('Kendari','Raha') then continue; end if;
  -- Reviews and the evaluator serialize on the employee/period lock. Used credits remain immutable.
  v_start:=greatest((case when public.sla_gaji_cabang(v_user)='Raha' then '2026-11-01' else '2026-10-01' end)::date,(v_program.mulai_periode||'-01')::date);
  for v_period in select to_char(d,'YYYY-MM') from generate_series(v_start::timestamp,v_last::timestamp,interval '1 month') d loop
   perform pg_advisory_xact_lock(hashtextextended('performance:'||v_user.username||':'||v_period,0));
   if not exists(select 1 from public.sla_gaji_disiplin_bulan where username=v_user.username and periode=v_period) then
    select count(*) into v_count from public.users u where u.account_active is true and lower(trim(u.nama_asli))=lower(trim(v_user.nama_asli)) and public.sla_gaji_cabang(u)=public.sla_gaji_cabang(v_user);
    v_salary:=public.sla_gaji_nominal_periode(v_user.username,v_period);
    if v_count<>1 or v_salary<=0 or v_salary>=3000000 then
     insert into public.sla_gaji_disiplin_bulan values(v_user.username,v_period,0,0,false,case when v_count<>1 then 'Profil bernama sama dalam cabang; perlu ditinjau Manajemen.' else 'Gaji pokok di luar program otomatis.' end,v_salary,null,v_now);
    else
     select * into v_stats from public.sla_disiplin_kenaikan_gaji(v_user.username,v_period);
     insert into public.sla_gaji_disiplin_bulan values(v_user.username,v_period,v_stats.telat_pagi,v_stats.alpa,v_stats.telat_pagi<=3 and v_stats.alpa<=2,
      case when v_stats.telat_pagi>3 or v_stats.alpa>2 then 'Telat pagi >3 kali atau alpa >2 hari.' else 'Memenuhi batas disiplin.' end,v_salary,null,v_now);
    end if;
    v_evaluated:=v_evaluated+1;
   end if;
   insert into public.sla_gaji_kredit(username,periode,sumber,kenaikan_id)
    select username,periode,'kehadiran',kenaikan_id from public.sla_gaji_disiplin_bulan where username=v_user.username and periode=v_period and memenuhi_syarat on conflict do nothing;
   delete from public.sla_gaji_kredit c where c.username=v_user.username and c.periode=v_period and c.sumber='performa' and c.kenaikan_id is null
    and not exists(select 1 from public.sla_performa_bulan r where r.username=c.username and r.periode=c.periode and (r.hasil->>'pass')::boolean and r.source_hash=public.sla_performa_sumber(r.username,r.periode)->>'hash');
   -- Performance may be approved after attendance evaluation; existing months must be revisited.
   insert into public.sla_gaji_kredit(username,periode,sumber)
    select r.username,r.periode,'performa' from public.sla_performa_bulan r where r.username=v_user.username and r.periode=v_period and r.periode>='2026-11'
     and (r.hasil->>'pass')::boolean and r.source_hash=public.sla_performa_sumber(r.username,r.periode)->>'hash' on conflict do nothing;
   loop
    select array_agg(periode||':'||sumber order by periode,sumber),array_agg(distinct periode order by periode) into v_keys,v_months from (
     select periode,sumber from public.sla_gaji_kredit where username=v_user.username and kenaikan_id is null and periode<=v_period order by periode,sumber limit 6
    ) q;
    exit when coalesce(cardinality(v_keys),0)<6 or coalesce(cardinality(v_months),0)<3;
    perform set_config('sla.salary_kind','Otomatis',true); perform set_config('sla.salary_actor','Sistem',true);
    perform set_config('sla.salary_reason','Enam kredit kehadiran/performa dari minimal tiga bulan berbeda.',true); perform set_config('sla.salary_months',v_months::text,true);
    update public.users set gaji_pokok=least(3000000,gaji_pokok+250000) where username=v_user.username returning * into v_user;
    select id into strict v_id from public.sla_gaji_riwayat where username=v_user.username and jenis='Otomatis' and bulan_dipakai=v_months order by urutan desc limit 1;
    update public.sla_gaji_kredit set kenaikan_id=v_id where username=v_user.username and periode||':'||sumber=any(v_keys) and kenaikan_id is null;
    update public.sla_gaji_disiplin_bulan d set kenaikan_id=v_id where d.username=v_user.username and exists(select 1 from public.sla_gaji_kredit c where c.username=d.username and c.periode=d.periode and c.sumber='kehadiran' and c.kenaikan_id=v_id);
    v_raised:=v_raised+1; exit when v_user.gaji_pokok>=3000000;
   end loop;
   exit when v_user.gaji_pokok>=3000000;
  end loop;
 end loop;
 perform set_config('sla.salary_kind','',true); perform set_config('sla.salary_months','',true);
 perform set_config('sla.salary_actor','',true); perform set_config('sla.salary_reason','',true);
 return jsonb_build_object('status','sukses','bulanDievaluasi',v_evaluated,'kenaikan',v_raised);
end $function$;

notify pgrst, 'reload schema';
