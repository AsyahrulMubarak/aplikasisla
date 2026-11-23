-- Review drafts survive reloads without finalizing a month or issuing salary credit.
set local lock_timeout='5s';
create table public.sla_performa_draf (
 username text not null, periode text not null check(periode ~ '^\d{4}-(0[1-9]|1[0-2])$'),
 revision integer not null check(revision>0), based_revision integer not null,
 input jsonb not null check(jsonb_typeof(input)='object'), source_hash text not null,
 diperbarui_oleh text not null, diperbarui_pada timestamptz not null,
 primary key(username,periode)
);
alter table public.sla_performa_draf enable row level security;
revoke all on public.sla_performa_draf from public,anon,authenticated;
grant select,insert,update on public.sla_performa_draf to service_role;
create policy server on public.sla_performa_draf for all to service_role using(true) with check(true);

-- Extend the existing authorized context, preserving all role/branch/account guards.
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.sla_performa_akses(uuid,text,text)'::regprocedure);
 if position('''saved'',saved,''attendance'',attendance' in definition)=0 then raise exception 'Fungsi akses berubah; periksa migrasi draf.'; end if;
 definition:=replace(definition,'''saved'',saved,''attendance'',attendance',
  '''saved'',saved,''draft'',(select to_jsonb(d) from public.sla_performa_draf d where d.username=p_username and d.periode=p_periode),''attendance'',attendance');
 execute definition;
end $migration$;

create function public.sla_performa_simpan_draf(p_auth_id uuid,p_username text,p_periode text,p_revision integer,p_based_revision integer,p_hash text,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $function$
declare context jsonb; previous_revision integer; actor text; rowdata jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_auth_id is null then raise exception 'Akses server diperlukan.'; end if;
 perform 1 from public.users where username=p_username for share;
 perform pg_advisory_xact_lock(hashtextextended('performance:'||p_username||':'||p_periode,0));
 context:=public.sla_performa_akses(p_auth_id,p_username,p_periode);
 if not coalesce((context->>'canApprove')::boolean,false) then raise exception 'Tinjauan memerlukan admin, Manager atau Direktur yang berwenang.'; end if;
 if exists(select 1 from public.sla_gaji_kredit where username=p_username and periode=p_periode and sumber='performa' and kenaikan_id is not null) then raise exception 'Kredit sudah dipakai; tinjauan historis dikunci.'; end if;
 if context->'source'->>'hash' is distinct from p_hash then raise exception 'Data tiket berubah. Muat ulang sebelum menyimpan tinjauan.'; end if;
 if coalesce((context->'saved'->>'revision')::integer,0) is distinct from p_based_revision then raise exception 'Rekap telah disahkan ulang. Muat ulang tinjauan.'; end if;
 select revision into previous_revision from public.sla_performa_draf where username=p_username and periode=p_periode;
 if coalesce(previous_revision,0) is distinct from p_revision then raise exception 'Draf sudah diubah pada sesi lain. Muat ulang sebelum menyimpan.'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>60000 then raise exception 'Draf tidak valid atau terlalu besar.'; end if;
 select username into strict actor from public.users where auth_id=p_auth_id;
 insert into public.sla_performa_draf(username,periode,revision,based_revision,input,source_hash,diperbarui_oleh,diperbarui_pada)
 values(p_username,p_periode,p_revision+1,p_based_revision,p_input,p_hash,actor,public.sla_gaji_sekarang())
 on conflict(username,periode) do update set revision=excluded.revision,based_revision=excluded.based_revision,input=excluded.input,source_hash=excluded.source_hash,diperbarui_oleh=excluded.diperbarui_oleh,diperbarui_pada=excluded.diperbarui_pada;
 select to_jsonb(d) into rowdata from public.sla_performa_draf d where username=p_username and periode=p_periode;
 return rowdata;
end $function$;
revoke all on function public.sla_performa_simpan_draf(uuid,text,text,integer,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.sla_performa_simpan_draf(uuid,text,text,integer,integer,text,jsonb) to service_role;
