-- New technician weights: 55/20/10/5/5/5, total-score threshold 80.
-- Preserve existing reviews, drafts, grade/bonus snapshots and all salary/credit rows.
set local lock_timeout='5s';
do $migration$
declare definition text;
begin
 definition:=pg_get_functiondef('public.sla_performa_sahkan(uuid,text,text,integer,text,jsonb,jsonb)'::regprocedure);
 if position('p_result->''policy''->>''version'' is distinct from ''3''' in definition)=0 then
  raise exception 'Versi fungsi pengesahan berubah. Periksa migrasi kebijakan.';
 end if;
 execute replace(definition,'p_result->''policy''->>''version'' is distinct from ''3''','p_result->''policy''->>''version'' is distinct from ''4''');
end $migration$;
notify pgrst,'reload schema';
