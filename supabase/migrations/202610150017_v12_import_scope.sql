begin;
create or replace function public.chico_service_import_prepare(p_user uuid,p_type text,p_hash text,p_file uuid,p_rows jsonb) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and a.status='active' and (m.rank='responsible' or exists(select 1 from public.chico_grants where user_id=p_user and capability='owner'))) then raise exception using errcode='42501',message='الاستيراد للإدارة فقط';end if;
 if not exists(select 1 from public.chico_files where id=p_file and lifecycle='active' and content_hash=p_hash) then raise exception 'المصدر غير متاح';end if;
 delete from chico_private.import_previews where expires_at<now();
 insert into chico_private.import_previews(user_id,file_id,file_hash,type,rows) values(p_user,p_file,p_hash,p_type,p_rows) returning id into result;return result;
end $$;
create or replace function public.chico_service_file_register(p_user uuid,p_path text,p_name text,p_mime text,p_size integer,p_hash text) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and a.status='active' and (m.rank='responsible' or exists(select 1 from public.chico_grants where user_id=p_user and capability='owner'))) then raise exception using errcode='42501',message='رفع ملفات الفريق للإدارة فقط';end if;
 if split_part(p_path,'/',1)<>p_user::text or p_path like '%..%' or length(p_path)>160 then raise exception 'مسار الملف غير صالح';end if;
 select id into result from public.chico_files where path=p_path and created_by=p_user and content_hash=p_hash and lifecycle='active';if result is not null then return result;end if;
 if not exists(select 1 from storage.objects where bucket_id='chico-files' and name=p_path) then raise exception 'لم يحفظ الملف في التخزين بعد';end if;
 if p_mime<>'text/csv' then raise exception 'مصدر غير منقح؛ استخدم CSV التشغيلي المنقى';end if;
 insert into public.chico_files(path,original_name,mime,size,content_hash,created_by) values(p_path,'source-'||left(p_hash,12)||'.csv',p_mime,p_size,p_hash,p_user) returning id into result;
 insert into public.chico_audit(actor,action,target_id,after_data) values(p_user,'file_upload',result::text,jsonb_build_object('size',p_size));return result;
end $$;
commit;
