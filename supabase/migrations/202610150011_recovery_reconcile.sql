begin;
-- Operator-only resolution requires external confirmation that no Auth request remains pending.
create or replace function public.chico_service_recovery_reconcile(p_claim uuid,p_resolution text,p_reason text) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare t chico_private.recovery_tokens;
begin
 perform pg_advisory_xact_lock(15001002);
 if p_resolution not in ('confirmed_applied','confirmed_not_applied') or length(trim(p_reason))<15 then raise exception 'نتيجة مؤكدة وسبب تشغيل موثق مطلوبان';end if;
 select * into t from chico_private.recovery_tokens where claim_id=p_claim and consumed_at is null and recovery_state in ('applying','ambiguous') for update;
 if not found then raise exception 'لا توجد عملية ملتبسة بهذا المعرف';end if;
 update chico_private.recovery_tokens set recovery_state=case when p_resolution='confirmed_applied' then 'auth_applied' else 'reserved' end where claim_id=p_claim;
 insert into public.chico_audit(action,target_id,after_data) values('credentials_reconciled',t.user_id::text,jsonb_build_object('resolution',p_resolution,'reason',trim(p_reason)));
 return jsonb_build_object('hash',t.token_hash,'claim',t.claim_id);
end $$;
revoke all on function public.chico_service_recovery_reconcile(uuid,text,text) from public,anon,authenticated;
grant execute on function public.chico_service_recovery_reconcile(uuid,text,text) to service_role;
commit;
