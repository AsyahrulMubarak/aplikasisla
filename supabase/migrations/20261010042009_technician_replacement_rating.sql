begin;

-- NULL identifies old tickets whose textual audit has not yet been captured.
alter table public.tiket add column if not exists riwayat_penggantian_teknisi jsonb;
alter table public.tiket add constraint tiket_riwayat_penggantian_array
  check (riwayat_penggantian_teknisi is null or jsonb_typeof(riwayat_penggantian_teknisi) = 'array');

create or replace function public.sla_nama_penggantian_teknisi(p_names text)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct name order by name), array[]::text[])
  from (select case when normalized = 'syawal' then 'muhammad syawal' else normalized end as name
    from (select lower(regexp_replace(btrim(x), '\s+', ' ', 'g')) as normalized
      from regexp_split_to_table(coalesce(p_names, ''), ',') x) cleaned) names
  where name not in ('', '-', 'belum ditugaskan');
$$;

create or replace function public.sla_tanggal_catatan_penggantian(p_date text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(btrim(p_date), '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4}),?\s+([0-9]{1,2})[.:]([0-9]{2})[.:]([0-9]{2})$');
  if m is not null then
    if m[4]::int > 23 or m[5]::int > 59 or m[6]::int > 59 then return null; end if;
    return make_timestamp(m[3]::int, m[2]::int, m[1]::int, m[4]::int, m[5]::int, m[6]::double precision) at time zone 'Asia/Makassar';
  end if;
  m := regexp_match(btrim(p_date), '^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2}):([0-9]{2})$');
  if m is not null then
    if m[4]::int > 23 or m[5]::int > 59 or m[6]::int > 59 then return null; end if;
    return make_timestamp(m[1]::int, m[2]::int, m[3]::int, m[4]::int, m[5]::int, m[6]::double precision) at time zone 'Asia/Makassar';
  end if;
  return null;
exception when datetime_field_overflow or invalid_datetime_format then return null;
end;
$$;

create or replace function public.sla_catatan_penggantian_teknisi(p_note text, p_previous text, p_current text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare m text[]; history jsonb := '[]'::jsonb;
begin
  for m in select regexp_matches(coalesce(p_note, ''), '\[([^\]\r\n]+)\][^\r\n]*PERGANTIAN TEKNISI[\r\n]+Dari: ([^\r\n]*)[\r\n]+Ke: ([^\r\n]*)', 'g') loop
    history := history || jsonb_build_array(jsonb_build_object('waktu', public.sla_tanggal_catatan_penggantian(m[1]), 'dari', btrim(m[2]), 'ke', btrim(m[3]), 'sumber', 'catatan_lama'));
  end loop;
  if history = '[]'::jsonb and cardinality(public.sla_nama_penggantian_teknisi(p_previous)) > 0 then
    history := jsonb_build_array(jsonb_build_object('waktu', null, 'dari', p_previous, 'ke', p_current, 'sumber', 'metadata_lama'));
  end if;
  return history;
end;
$$;

create or replace function public.sla_jaga_riwayat_penggantian_teknisi()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare removed boolean;
begin
  if tg_op = 'INSERT' then
    new.riwayat_penggantian_teknisi := '[]'::jsonb;
    return new;
  end if;
  -- Clients cannot add, edit, or erase the journal. Seed from OLD before notes change.
  new.riwayat_penggantian_teknisi := coalesce(old.riwayat_penggantian_teknisi,
    public.sla_catatan_penggantian_teknisi(old.keterangan, old.teknisi_sebelumnya, old.teknisi));
  if coalesce(old.id_tiket, '') not like 'SLS-%'
    and lower(btrim(coalesce(old.status, ''))) not in ('selesai', 'closed', 'cancel', 'batal') then
    select exists(select 1 from unnest(public.sla_nama_penggantian_teknisi(old.teknisi)) name
      where not (name = any(public.sla_nama_penggantian_teknisi(new.teknisi)))) into removed;
    if removed then
      new.riwayat_penggantian_teknisi := new.riwayat_penggantian_teknisi || jsonb_build_array(
        jsonb_build_object('waktu', statement_timestamp(), 'dari', old.teknisi, 'ke', new.teknisi, 'sumber', 'server'));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sla_nama_penggantian_teknisi(text) from public, anon, authenticated;
revoke all on function public.sla_tanggal_catatan_penggantian(text) from public, anon, authenticated;
revoke all on function public.sla_catatan_penggantian_teknisi(text,text,text) from public, anon, authenticated;
revoke all on function public.sla_jaga_riwayat_penggantian_teknisi() from public, anon, authenticated;
grant execute on function public.sla_nama_penggantian_teknisi(text), public.sla_tanggal_catatan_penggantian(text), public.sla_catatan_penggantian_teknisi(text,text,text) to authenticated, service_role;
create trigger sla_jaga_riwayat_penggantian_teknisi before insert or update on public.tiket
for each row execute function public.sla_jaga_riwayat_penggantian_teknisi();

comment on column public.tiket.riwayat_penggantian_teknisi is 'Server-maintained removal history. NULL: legacy audit read from notes; []: no replacements. Existing ticket fields and points are unchanged.';
commit;
