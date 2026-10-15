begin;
alter table public.chico_files add column lifecycle text not null default 'quarantined' check(lifecycle in ('active','deleting','quarantined'));
alter table public.chico_files alter column lifecycle set default 'active';
update public.chico_files set original_name='legacy-source-'||left(id::text,8)||'.'||case when mime='text/csv' then 'csv' when mime like '%spreadsheet%' then 'xlsx' else 'bin' end;
-- Existing v1 sources require privacy review before they can be served again.
drop policy chico_storage_read on storage.objects;
create policy chico_storage_read on storage.objects for select to authenticated using(bucket_id='chico-files' and public.chico_data_session() and exists(select 1 from public.chico_files f where f.path=name and f.lifecycle='active' and (f.created_by=auth.uid() or public.chico_manage())));
create or replace function public.chico_service_file_register(p_user uuid,p_path text,p_name text,p_mime text,p_size integer,p_hash text) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and a.status='active' and (m.game_status='active' and m.rank in ('moderator','administrator','responsible') or exists(select 1 from public.chico_grants where user_id=p_user and capability in ('owner','manage_imports')))) then raise exception using errcode='42501',message='رفع الملفات غير مسموح';end if;
 if split_part(p_path,'/',1)<>p_user::text or p_path like '%..%' or length(p_path)>160 then raise exception 'مسار الملف غير صالح';end if;
 select id into result from public.chico_files where path=p_path and created_by=p_user and content_hash=p_hash and lifecycle='active';if result is not null then return result;end if;
 if not exists(select 1 from storage.objects where bucket_id='chico-files' and name=p_path) then raise exception 'لم يحفظ الملف في التخزين بعد';end if;
 if p_mime<>'text/csv' then raise exception 'مصدر غير منقح؛ استخدم CSV التشغيلي المنقى';end if;
 insert into public.chico_files(path,original_name,mime,size,content_hash,created_by) values(p_path,'source-'||left(p_hash,12)||'.csv',p_mime,p_size,p_hash,p_user) returning id into result;
 insert into public.chico_audit(actor,action,target_id,after_data) values(p_user,'file_upload',result::text,jsonb_build_object('size',p_size));return result;
end $$;
create or replace function public.chico_file_path(p_id uuid) returns text language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();result text;
begin
 select path into result from public.chico_files where id=p_id and lifecycle='active' and (created_by=actor or public.chico_manage());
 if result is null then raise exception using errcode='42501',message='الملف غير متاح لهذا الحساب';end if;return result;
end $$;
create or replace function public.chico_file_reuse(p_hash text) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor();result jsonb;
begin
 if not (public.chico_publish() or public.chico_cap('manage_imports')) then raise exception using errcode='42501',message='رفع الملفات غير مسموح';end if;
 select jsonb_build_object('id',id,'path',path) into result from public.chico_files where created_by=u and content_hash=p_hash and lifecycle='active' order by created_at limit 1;return result;
end $$;
-- Cleanup is two phase. Once marked, commands cannot link or reopen a candidate.
create or replace function public.chico_service_sources_cleanup(p_finalize uuid default null) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(15001002);
 delete from chico_private.import_previews where expires_at<now();
 if p_finalize is not null then delete from public.chico_files where id=p_finalize and lifecycle='deleting';return '{}'::jsonb;end if;
 update public.chico_files f set lifecycle='deleting' where f.created_at<now()-interval '7 days' and not exists(select 1 from public.chico_reports where source_file=f.id) and not exists(select 1 from public.chico_report_versions where previous->>'source_file'=f.id::text) and not exists(select 1 from public.chico_import_jobs where summary->>'file_id'=f.id::text) and not exists(select 1 from chico_private.import_previews where file_id=f.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',path)),'[]'::jsonb) into result from (select id,path from public.chico_files where lifecycle='deleting' order by created_at limit 25) f;return result;
end $$;
revoke all on function public.chico_service_sources_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.chico_service_sources_cleanup(uuid) to service_role;
create or replace function public.chico_audit_page(p_before bigint default 9223372036854775807) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform public.chico_actor();if not public.chico_manage() then raise exception using errcode='42501',message='سجل التدقيق يحتاج إدارة الفريق';end if;
 return coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',(select m.display_name from public.chico_accounts c join public.chico_members m on m.id=c.member_id where c.user_id=a.actor),'target_name',coalesce((select display_name from public.chico_members where id::text=a.target_id),(select m.display_name from public.chico_accounts c join public.chico_members m on m.id=c.member_id where c.user_id::text=a.target_id)))) from(select * from public.chico_audit where id<p_before order by id desc limit 100)a),'[]'::jsonb);
end $$;
revoke all on function public.chico_audit_page(bigint) from public,anon;
grant execute on function public.chico_audit_page(bigint) to authenticated;
commit;
