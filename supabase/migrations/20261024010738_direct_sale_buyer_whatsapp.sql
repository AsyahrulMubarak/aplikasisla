-- Older sales remain nullable until a buyer number can be recovered with evidence.
alter table public.penjualan add column if not exists no_wa_pembeli text;
comment on column public.penjualan.no_wa_pembeli is 'Nomor WhatsApp pembeli penjualan langsung dalam format 628. NULL berarti belum tercatat pada data lama.';
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.penjualan'::regclass and conname='penjualan_no_wa_pembeli_valid') then
  alter table public.penjualan add constraint penjualan_no_wa_pembeli_valid
   check (no_wa_pembeli is null or no_wa_pembeli ~ '^628[0-9]{7,12}$');
 end if;
end $$;
notify pgrst, 'reload schema';
