create or replace function public.sla_performa_sahkan(p_auth_id uuid,p_username text,p_periode text,p_revision integer,p_hash text,p_input jsonb,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare context jsonb; prev jsonb; rowdata jsonb; actor text; begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Akses server diperlukan.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('performance:'||p_username||':'||p_periode,0));
 context:=public.sla_performa_akses(p_auth_id,p_username,p_periode);
 if not (context->>'canApprove')::boolean then raise exception 'Pengesahan memerlukan admin cabang lain, Manager atau Direktur.'; end if;
 if not (context->>'closed')::boolean or p_periode<'2026-11' then raise exception 'Pengesahan dimulai November dan setelah masa koreksi tanggal 7 berakhir.'; end if;
 if not (context->>'eligible')::boolean then raise exception 'Pegawai/periode berada di luar program kenaikan gaji.'; end if;
 if context->'source'->>'hash' is distinct from p_hash then raise exception 'Data tiket berubah. Muat ulang rekap sebelum mengesahkan.'; end if;
 prev:=context->'saved';
 if coalesce((prev->>'revision')::integer,0)<>p_revision then raise exception 'Rekap sudah berubah. Muat ulang.'; end if;
 if exists(select 1 from public.sla_gaji_kredit where username=p_username and periode=p_periode and sumber='performa' and kenaikan_id is not null) then raise exception 'Kredit sudah dipakai; koreksi memerlukan penyesuaian Manajemen.'; end if;
 if p_result->>'period' is distinct from p_periode or p_result->'policy'->>'version'<>'1' or coalesce((p_result->>'complete')::boolean,false) is not true then raise exception 'Lengkapi pengesahan pencapaian, sampel, dan tinjauan mutu.'; end if;
 select username into strict actor from public.users where auth_id=p_auth_id;
 insert into public.sla_performa_bulan(username,periode,revision,input,hasil,source_hash,disahkan_oleh,disahkan_pada)
 values(p_username,p_periode,p_revision+1,p_input,p_result,p_hash,actor,public.sla_gaji_sekarang())
 on conflict(username,periode) do update set revision=excluded.revision,input=excluded.input,hasil=excluded.hasil,source_hash=excluded.source_hash,disahkan_oleh=excluded.disahkan_oleh,disahkan_pada=excluded.disahkan_pada;
 select to_jsonb(r) into rowdata from public.sla_performa_bulan r where username=p_username and periode=p_periode;
 insert into public.sla_performa_audit(username,periode,actor,sebelum,sesudah) values(p_username,p_periode,actor,prev,rowdata);
 -- Credit is reserved now, but salary changes only through the established daily evaluator.
 delete from public.sla_gaji_kredit where username=p_username and periode=p_periode and sumber='performa' and kenaikan_id is null;
 if (p_result->>'pass')::boolean then insert into public.sla_gaji_kredit(username,periode,sumber) values(p_username,p_periode,'performa') on conflict do nothing; end if;
 return jsonb_build_object('status','sukses','saved',rowdata);
end $$;

revoke all on function public.sla_performa_sumber(text,text),public.sla_performa_akses(uuid,text,text),public.sla_performa_sahkan(uuid,text,text,integer,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sla_performa_sumber(text,text),public.sla_performa_akses(uuid,text,text),public.sla_performa_sahkan(uuid,text,text,integer,text,jsonb,jsonb) to service_role;
