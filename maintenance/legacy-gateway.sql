begin;
create or replace function public.sla_konfigurasi_gateway_lama()
returns jsonb language sql security definer
set search_path=pg_catalog,vault
as $$
  select decrypted_secret::jsonb
  from vault.decrypted_secrets
  where name='sla_legacy_gateway'
  limit 1;
$$;
revoke all on function public.sla_konfigurasi_gateway_lama() from public,anon,authenticated;
grant execute on function public.sla_konfigurasi_gateway_lama() to service_role;
comment on function public.sla_konfigurasi_gateway_lama() is 'Private service-only configuration for authenticated legacy gateway; never return this RPC result to a browser.';
commit;
