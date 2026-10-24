-- Read-only plan. Do not infer numbers from generic buyer labels or conflicting evidence.
with sales as (
 select s.*,case when lower(coalesce(s.cabang,'Kendari'))='raha' then 'Raha' else 'Kendari' end branch,
  lower(regexp_replace(trim(s.nama_pembeli),'\s+',' ','g')) customer
 from public.penjualan s where s.no_wa_pembeli is null
), evidence as (
 select s.id_penjualan,s.branch,public.sla_ops_phone(k.no_wa) phone,'transaction_receipt' source
 from sales s join public.sla_ops_crm_receipts r on r.cabang=s.branch and r.source='Penjualan' and r.reference=s.id_penjualan
 join public.database_klien k on k.id_klien=r.customer_id and coalesce(k.cabang,'Kendari')=s.branch
 union all
 select s.id_penjualan,s.branch,public.sla_ops_phone(k.no_wa),'exact_crm_customer'
 from sales s join public.database_klien k on coalesce(k.cabang,'Kendari')=s.branch
  and lower(regexp_replace(trim(k.nama_klien),'\s+',' ','g'))=s.customer
 where k.sumber='Penjualan' and s.customer !~ '^(umum|user\M)'
 union all
 select s.id_penjualan,s.branch,public.sla_ops_phone(p.no_wa),'exact_prospect_customer_sales'
 from sales s join public.prospek p on coalesce(p.cabang,'Kendari')=s.branch
  and lower(regexp_replace(trim(p.nama_calon_customer),'\s+',' ','g'))=s.customer
  and p.tanggal_input<=s.waktu_lapor
  and regexp_split_to_array(lower(trim(p.sales_penanggung_jawab)),'\s*,\s*') <@ regexp_split_to_array(lower(trim(s.sales)),'\s*,\s*')
 where s.customer !~ '^(umum|user\M)' and nullif(trim(p.sales_penanggung_jawab),'') is not null
)
select id_penjualan,branch,min(phone) no_wa_pembeli,array_agg(distinct source order by source) evidence
from evidence where phone ~ '^628[0-9]{7,12}$'
group by id_penjualan,branch having count(distinct phone)=1 order by id_penjualan;
