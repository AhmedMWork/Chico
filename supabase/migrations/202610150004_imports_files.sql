begin;
create table public.chico_files (
 id uuid primary key default gen_random_uuid(), path text not null unique,
 original_name text not null check(length(original_name) between 1 and 150),mime text not null,size integer not null check(size between 1 and 4194304),content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.chico_files enable row level security;
revoke all on public.chico_files from anon,authenticated;
grant select on public.chico_files to authenticated;
create policy files_read on public.chico_files for select to authenticated using(public.chico_data_session() and (created_by=auth.uid() or public.chico_manage()));

-- Private bucket; a file cannot become public through an application setting.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chico-files','chico-files',false,4194304,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','image/png','image/jpeg','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy chico_storage_insert on storage.objects for insert to authenticated with check(bucket_id='chico-files' and (storage.foldername(name))[1]=auth.uid()::text and public.chico_data_session() and (public.chico_publish() or public.chico_cap('manage_imports')));
create policy chico_storage_read on storage.objects for select to authenticated using(bucket_id='chico-files' and public.chico_data_session() and ((storage.foldername(name))[1]=auth.uid()::text or public.chico_manage()));
create policy chico_storage_delete_orphan on storage.objects for delete to authenticated using(bucket_id='chico-files' and public.chico_data_session() and (storage.foldername(name))[1]=auth.uid()::text and not exists(select 1 from public.chico_files f where f.path=name));

alter table public.chico_reports add column source_file uuid references public.chico_files(id);
create or replace function public.chico_service_file_register(p_user uuid,p_path text,p_name text,p_mime text,p_size integer,p_hash text) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and a.status='active' and (m.game_status='active' and m.rank in ('moderator','administrator','responsible') or exists(select 1 from public.chico_grants where user_id=p_user and capability in ('owner','manage_imports')))) then raise exception using errcode='42501',message='رفع الملفات غير مسموح';end if;
 if split_part(p_path,'/',1)<>p_user::text or p_path like '%..%' or length(p_path)>160 then raise exception 'مسار الملف غير صالح';end if;
 if not exists(select 1 from storage.objects where bucket_id='chico-files' and name=p_path) then raise exception 'لم يحفظ الملف في التخزين بعد';end if;
 if p_mime not in ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','image/png','image/jpeg','image/webp','application/pdf') then raise exception 'نوع الملف غير مسموح';end if;
 insert into public.chico_files(path,original_name,mime,size,content_hash,created_by) values(p_path,p_name,p_mime,p_size,p_hash,p_user) returning id into result;
 insert into public.chico_audit(actor,action,target_id,after_data) values(p_user,'file_upload',result::text,jsonb_build_object('name',p_name,'size',p_size));return result;
end $$;
create or replace function public.chico_file_path(p_id uuid) returns text language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();result text;
begin
 select path into result from public.chico_files where id=p_id and (created_by=actor or public.chico_manage());
 if result is null then raise exception using errcode='42501',message='الملف غير متاح لهذا الحساب';end if;return result;
end $$;

create table chico_private.import_previews (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.chico_accounts(user_id),file_id uuid not null references public.chico_files(id),
 file_hash text not null,type text not null,rows jsonb not null,expires_at timestamptz not null default now()+interval '10 minutes'
);
create or replace function public.chico_service_import_prepare(p_user uuid,p_type text,p_hash text,p_file uuid,p_rows jsonb) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and a.status='active' and (exists(select 1 from public.chico_grants g where g.user_id=p_user and g.capability='owner') or m.rank in ('administrator','responsible') and exists(select 1 from public.chico_grants g where g.user_id=p_user and g.capability='manage_imports'))) then raise exception using errcode='42501',message='الاستيراد غير مسموح';end if;
 if not exists(select 1 from public.chico_files where id=p_file and content_hash=p_hash and (created_by=p_user or exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=p_user and m.rank in ('administrator','responsible')))) then raise exception 'المصدر غير متاح';end if;
 delete from chico_private.import_previews where expires_at<now();
 insert into chico_private.import_previews(user_id,file_id,file_hash,type,rows) values(p_user,p_file,p_hash,p_type,p_rows) returning id into result;return result;
end $$;
revoke all on function public.chico_service_import_prepare(uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.chico_service_import_prepare(uuid,text,text,uuid,jsonb) to service_role;
create or replace function public.chico_import(p_type text,p_hash text,p_file uuid,p_rows jsonb,p_preview uuid,p_confirmed boolean) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();job public.chico_import_jobs;item jsonb;result jsonb;staff uuid;changed integer:=0;unchanged integer:=0;number integer:=0;flags_value integer;flags_recorded integer;old_member public.chico_members;source_name text;expected integer;selection text:=md5(p_rows::text);
begin
 perform pg_advisory_xact_lock(15001002);
 perform public.chico_actor();
 if not exists(select 1 from chico_private.import_previews where id=p_preview and user_id=actor and file_id=p_file and file_hash=p_hash and type=p_type and rows=p_rows and expires_at>now()) then raise exception using errcode='42501',message='راجع الملف على الخادم قبل اعتماد الدفعة';end if;
 if not public.chico_cap('manage_imports') then raise exception using errcode='42501',message='استيراد البيانات يحتاج صلاحية الاستيراد';end if;
 if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
 if p_confirmed is distinct from true or p_type not in ('members','reports') or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'راجع الدفعة وحدد نوعها قبل الاعتماد';end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'الدفعة تتكون من 1 إلى 500 سجل';end if;
 if octet_length(p_rows::text)>500000 then raise exception 'حجم الدفعة أكبر من المسموح';end if;
 perform public.chico_file_path(p_file);select original_name into source_name from public.chico_files where id=p_file and content_hash=p_hash;
 if source_name is null then raise exception 'بصمة الملف لا تطابق المصدر المحفوظ';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_hash||p_type||selection,0));
 select * into job from public.chico_import_jobs where file_hash=p_hash and type=p_type and selection_hash=selection for update;
 if found and job.status='applied' then return jsonb_build_object('already_applied',true,'applied',0,'unchanged',jsonb_array_length(p_rows));end if;
 insert into public.chico_import_jobs(file_hash,type,selection_hash,status,created_by,summary) values(p_hash,p_type,selection,'preview',actor,jsonb_build_object('file_id',p_file)) on conflict(file_hash,type,selection_hash) do nothing;
 for item in select value from jsonb_array_elements(p_rows) loop
  number=number+1;
  begin
   if p_type='members' then
    staff=nullif(item->>'staff_id','')::uuid;
    if staff is null and nullif(item->>'external_ref','') is not null then select id into staff from public.chico_members where external_ref=item->>'external_ref';end if;
    if staff is null then
     if nullif(item->>'external_ref','') is null and exists(select 1 from public.chico_members where lower(display_name)=lower(item->>'display_name')) then raise exception 'اسم موجود دون معرف؛ راجع الربط قبل إنشاء عضو جديد';end if;
     result=public.chico_command('member_create',item);changed=changed+1;
    else
     perform public.chico_assert_staff_manage(staff,true);select * into old_member from public.chico_members where id=staff for update;
     if old_member.display_name=item->>'display_name' and old_member.rank=item->>'rank' and old_member.joined_at=(item->>'joined_at')::date and old_member.external_ref is not distinct from nullif(item->>'external_ref','') then unchanged=unchanged+1;
     else
      if old_member.rank<>item->>'rank' then perform public.chico_command('rank_member',jsonb_build_object('staff_id',staff,'rank',item->>'rank','reason','تحديث من دفعة استيراد معتمدة'));end if;
      perform public.chico_command('member_edit',item||jsonb_build_object('staff_id',staff));changed=changed+1;
     end if;
    end if;
   else
    if not public.chico_publish() then raise exception using errcode='42501',message='نشر الإحصائيات لرتبة Moderator فما فوق فقط';end if;
    staff=(item->>'staff_id')::uuid;
    result=public.chico_save_report(item||jsonb_build_object('publish',true,'source','ملف معتمد · بصمة '||left(p_hash,16),'source_file',p_file));
    if coalesce((result->>'unchanged')::boolean,false) then unchanged=unchanged+1;else changed=changed+1;end if;
    if item->>'flags_total' is not null then
     perform public.chico_command('flags_baseline',jsonb_build_object('staff_id',staff,'total',(item->>'flags_total')::integer,'measured_at',item->>'measured_at','reason','تسوية إجمالي تراكمي من ملف راجعه المسؤول','source','import:'||p_hash));
    end if;
   end if;
  exception when others then raise exception using errcode='P0001',message='السجل '||number||': '||sqlerrm;
  end;
 end loop;
 update public.chico_import_jobs set status='applied',applied_at=now(),summary=jsonb_build_object('file_id',p_file,'applied',changed,'unchanged',unchanged,'total',number) where file_hash=p_hash and type=p_type and selection_hash=selection;
 perform public.chico_log('import_applied',p_hash,null,jsonb_build_object('type',p_type,'applied',changed,'unchanged',unchanged,'file_id',p_file));
 return jsonb_build_object('applied',changed,'unchanged',unchanged,'total',number);
end $$;
revoke all on function public.chico_service_file_register(uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.chico_service_file_register(uuid,text,text,text,integer,text) to service_role;
revoke all on function public.chico_file_path(uuid),public.chico_import(text,text,uuid,jsonb,uuid,boolean) from public,anon;
grant execute on function public.chico_file_path(uuid),public.chico_import(text,text,uuid,jsonb,uuid,boolean) to authenticated;
commit;
