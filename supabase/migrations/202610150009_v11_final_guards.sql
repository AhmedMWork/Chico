begin;
create or replace function public.chico_password_issue(p_hash text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor();
begin
 perform pg_advisory_xact_lock(15001002);perform public.chico_actor();
 if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
 if public.chico_recovery_blocked(u) then raise exception 'تغيير بيانات الدخول قيد التنفيذ';end if;
 update chico_private.recovery_tokens set consumed_at=now() where user_id=u and consumed_at is null;
 insert into chico_private.recovery_tokens(user_id,token_hash,issued_by,expires_at) values(u,p_hash,u,now()+interval '15 minutes');
 perform public.chico_log('password_change_started',u::text);
end $$;
revoke all on function public.chico_password_issue(text) from public,anon;
grant execute on function public.chico_password_issue(text) to authenticated;

create or replace function public.chico_service_import_prepare(p_user uuid,p_type text,p_hash text,p_file uuid,p_rows jsonb) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and a.status='active' and (exists(select 1 from public.chico_grants g where g.user_id=p_user and g.capability='owner') or m.rank in ('administrator','responsible') and exists(select 1 from public.chico_grants g where g.user_id=p_user and g.capability='manage_imports'))) then raise exception using errcode='42501',message='الاستيراد غير مسموح';end if;
 if not exists(select 1 from public.chico_files where id=p_file and lifecycle='active' and content_hash=p_hash and (created_by=p_user or exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and m.rank in ('administrator','responsible')))) then raise exception 'المصدر غير متاح';end if;
 delete from chico_private.import_previews where expires_at<now();
 insert into chico_private.import_previews(user_id,file_id,file_hash,type,rows) values(p_user,p_file,p_hash,p_type,p_rows) returning id into result;return result;
end $$;
commit;
