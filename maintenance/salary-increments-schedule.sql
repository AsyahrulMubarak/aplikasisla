-- Run daily at 06:15 WITA, independently of employee logins. Existing jobs stay intact.
begin;
create extension if not exists pg_net with schema extensions;
drop function if exists public.sla_installer_automatisasi_gaji();
create or replace function public.sla_installer_automatisasi_gaji(p_server_key text) returns jsonb
 language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key text; v_id uuid; v_job bigint;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 v_key:=p_server_key;
 if nullif(v_key,'') is null or length(v_key)<30 or length(v_key)>4096 then raise exception 'Kredensial server tidak tersedia.'; end if;
 -- Reuse the authenticated server key; keep it encrypted and out of job command text.
 select id into v_id from vault.secrets where name='sla_payroll_server_key' limit 1;
 if v_id is null then perform vault.create_secret(v_key,'sla_payroll_server_key','Existing server credential for the salary scheduler');
 else perform vault.update_secret(v_id,v_key,'sla_payroll_server_key','Existing server credential for the salary scheduler'); end if;
 for v_job in select jobid from cron.job where jobname='sla-kenaikan-gaji' loop perform cron.unschedule(v_job); end loop;
 perform cron.schedule('sla-kenaikan-gaji','15 22 * * *',$job$
 select net.http_post(
  url:='https://oozkqjgllubhjctnkxwl.supabase.co/functions/v1/sla-payroll-attendance',
  headers:=jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key'),
   'x-sla-job-key',(select decrypted_secret from vault.decrypted_secrets where name='sla_payroll_server_key')),
  body:='{"action":"prosesKenaikanGajiOtomatis"}'::jsonb,timeout_milliseconds:=100000);
 $job$);
 return jsonb_build_object('status','sukses','jadwalWita','06:15','mulaiPeriode','2026-10');
end $$;
revoke all on function public.sla_installer_automatisasi_gaji(text) from public,anon,authenticated;
grant execute on function public.sla_installer_automatisasi_gaji(text) to service_role;
commit;
