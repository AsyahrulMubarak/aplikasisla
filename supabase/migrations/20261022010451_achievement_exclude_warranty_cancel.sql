begin;
-- Warranty claims and cancelled work never create new achievement points.
-- Historical posted achievements/bonus snapshots and salary ledgers are retained.
create function public.sla_achievement_ticket_eligible(p_ticket public.tiket)
returns boolean language sql immutable security invoker set search_path='' as $$
 select lower(btrim(coalesce(p_ticket.status,''))) not in ('cancel','batal')
  and nullif(btrim(to_jsonb(p_ticket)->>'garansi_asal'),'') is null
  and nullif(btrim(to_jsonb(p_ticket)->>'referensi_tiket_asal'),'') is null;
$$;
revoke all on function public.sla_achievement_ticket_eligible(public.tiket) from public,anon;
grant execute on function public.sla_achievement_ticket_eligible(public.tiket) to authenticated,service_role;

create function public.sla_guard_achievement_eligibility() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.penilaian_teknisi->'achievement' is not null and
  (tg_op='INSERT' or new.penilaian_teknisi->'achievement' is distinct from old.penilaian_teknisi->'achievement')
  and not public.sla_achievement_ticket_eligible(new) then
   raise exception 'Tiket garansi dan Cancel/Batal tidak mendapat poin pencapaian.';
 end if;
 return new;
end $$;
revoke all on function public.sla_guard_achievement_eligibility() from public,anon,authenticated;
create trigger sla_guard_achievement_eligibility before insert or update on public.tiket
 for each row execute function public.sla_guard_achievement_eligibility();
notify pgrst,'reload schema';
commit;

