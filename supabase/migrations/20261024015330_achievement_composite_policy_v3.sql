-- Adopt the agreed technician composite policy. Sales keeps its three-target policy.
-- Replace only the policy gate; preserve approval permissions, locks, audits and salary guards.
set local lock_timeout='5s';
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.sla_performa_sahkan(uuid,text,text,integer,text,jsonb,jsonb)'::regprocedure);
 if position('p_result->''policy''->>''version'' is distinct from ''2''' in definition)=0 then
  raise exception 'Versi fungsi pengesahan berubah. Periksa sebelum migrasi kebijakan.';
 end if;
 execute replace(definition,'p_result->''policy''->>''version'' is distinct from ''2''','p_result->''policy''->>''version'' is distinct from ''3''');
end $migration$;
-- Include the ticket exemption and paused-deadline evidence in the server source.
do $migration$
declare definition text; signature regprocedure;
begin
 signature:=coalesce(to_regprocedure('public.sla_performa_sumber_teknisi(text,text)'),to_regprocedure('public.sla_performa_sumber(text,text)'));
 definition:=pg_get_functiondef(signature);
 if position('''status'',t.status,' in definition)=0 then raise exception 'Sumber penilaian teknisi berubah. Periksa migrasi.'; end if;
 execute replace(definition,'''status'',t.status,','''status'',t.status,''no_transaksi'',t.no_transaksi,''sla_jeda_sisa_detik'',t.sla_jeda_sisa_detik,');
end $migration$;
notify pgrst, 'reload schema';
