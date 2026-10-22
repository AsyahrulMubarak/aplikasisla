-- Installed paused; enable only after all old GAS timers have been removed.
create function public.sla_ops_snapshot() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
  'tickets',coalesce((select jsonb_agg(to_jsonb(t) order by id_tiket) from public.tiket t),'[]'),
  'users',coalesce((select jsonb_agg(jsonb_build_object('username',username,'nama_asli',nama_asli,'role',role,'no_wa',no_wa,'cabang',cabang,'hak_akses_cabang',hak_akses_cabang,'account_active',account_active) order by username) from public.users),'[]'),
  'warranties',coalesce((select jsonb_agg(to_jsonb(g) order by id_garansi) from public.garansi g),'[]'),
  'prospects',coalesce((select jsonb_agg(to_jsonb(p) order by id_prospek) from public.prospek p),'[]'),
  'previous',coalesce((select jsonb_agg(jsonb_build_object('id_garansi',id_garansi,'terkirim_pada',terkirim_pada)) from public.sla_notif_penitipan),'[]')
 )
$$;
revoke all on function public.sla_ops_snapshot() from public,anon,authenticated;
grant execute on function public.sla_ops_snapshot() to service_role;
do $$
declare item record; job_id bigint; command text;
begin
 if not exists(select 1 from vault.secrets where name='sla_payroll_server_key') then raise exception 'Kredensial scheduler SLA belum tersedia'; end if;
 for item in select * from (values
  ('sla-ops-queue','* * * * *','processQueue'),
  ('sla-ops-tickets','*/5 * * * *','scanTickets'),
  ('sla-ops-prospects','0 23 * * *','scanProspects'),
  ('sla-ops-after-sales','0 1 * * *','scanWarranty'),
  ('sla-penitipan-garansi','*/5 * * * *','scanStorage')
 ) as jobs(name,schedule,action) loop
  command:=format($job$
   select net.http_post(
    url:='https://oozkqjgllubhjctnkxwl.supabase.co/functions/v1/sla-operations',
    headers:=jsonb_build_object('Content-Type','application/json',
     'apikey',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key'),
     'x-sla-job-key',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key')),
    body:=jsonb_build_object('action',%L),timeout_milliseconds:=100000
   );
  $job$,item.action);
  job_id:=cron.schedule(item.name,item.schedule,command);
  perform cron.alter_job(job_id,active:=false);
 end loop;
end $$;
