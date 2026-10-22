-- Match Juna's November target to the supplied form: evidence is optional.
update public.sla_sales_targets set bukti_wajib=false,updated_at=now()
where cabang='Kendari' and periode='2026-11' and username='juna'
 and omzet=50000000 and konversi=60 and followup_harian=8 and bukti_wajib=true;
