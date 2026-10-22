begin;
create or replace function public.sla_achievement_ticket_eligible(p_ticket public.tiket)
returns boolean language sql immutable security invoker set search_path='' as $$
 select lower(btrim(coalesce(p_ticket.status,''))) not in ('cancel','batal','outsource')
  and nullif(btrim(to_jsonb(p_ticket)->>'garansi_asal'),'') is null
  and nullif(btrim(to_jsonb(p_ticket)->>'referensi_tiket_asal'),'') is null;
$$;
create or replace function public.sla_guard_achievement_eligibility() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.penilaian_teknisi->'achievement' is not null and
  (tg_op='INSERT' or new.penilaian_teknisi->'achievement' is distinct from old.penilaian_teknisi->'achievement')
  and not public.sla_achievement_ticket_eligible(new) then
   raise exception 'Tiket garansi, Cancel/Batal, dan Outsource tidak mendapat poin pencapaian.';
 end if;
 return new;
end $$;
commit;

