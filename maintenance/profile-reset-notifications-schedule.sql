begin;
-- Reuse the existing encrypted server credential without exposing it in command text.
do $$
begin
  if not exists(select 1 from vault.secrets where name = 'sla_payroll_server_key') then
    raise exception 'Kredensial scheduler SLA belum tersedia.';
  end if;
  perform cron.schedule('sla-notif-reset-sandi', '*/5 * * * *', $job$
    select net.http_post(
      url := 'https://oozkqjgllubhjctnkxwl.supabase.co/functions/v1/sla-profile',
      headers := jsonb_build_object('Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name = 'sla_payroll_server_key'),
        'x-sla-job-key',(select decrypted_secret from vault.decrypted_secrets where name = 'sla_payroll_server_key')),
      body := '{"action":"prosesNotifResetSandi"}'::jsonb,
      timeout_milliseconds := 100000
    );
  $job$);
end $$;
commit;
