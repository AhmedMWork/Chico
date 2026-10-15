begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chico-avatars','chico-avatars',false,1048576,array['image/png']) on conflict(id) do update set public=false,file_size_limit=1048576,allowed_mime_types=array['image/png'];
create policy chico_avatar_read on storage.objects for select to authenticated using(bucket_id='chico-avatars' and public.chico_data_session() and ((storage.foldername(name))[1]=auth.uid()::text or public.chico_manage()));
create or replace function public.chico_avatar_set(p_path text) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();staff uuid:=public.chico_staff_id();old_path text;
begin
 perform pg_advisory_xact_lock(15001002);perform public.chico_actor();
 if split_part(p_path,'/',1)<>actor::text or p_path !~ '^[a-f0-9-]+/[a-f0-9-]+\.png$' or not exists(select 1 from storage.objects where bucket_id='chico-avatars' and name=p_path) then raise exception 'الصورة غير صالحة';end if;
 select avatar_path into old_path from public.chico_members where id=staff for update;
 update public.chico_members set avatar_path=p_path,avatar_updated_at=now(),updated_at=now() where id=staff;
 perform public.chico_log('avatar_change',staff::text,null,jsonb_build_object('changed',true));return jsonb_build_object('old_path',old_path);
end $$;
revoke all on function public.chico_avatar_set(text) from public,anon;
grant execute on function public.chico_avatar_set(text) to authenticated;
create or replace function public.chico_avatar_path(p_staff uuid,p_period date default public.chico_week(now())) returns text language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare path text;
begin
 perform public.chico_actor();
 if not public.chico_manage() and p_staff<>public.chico_staff_id() and not exists(select 1 from jsonb_array_elements(public.chico_top(p_period,'helpers')||public.chico_top(p_period,'moderators')) t where t->>'staff_id'=p_staff::text) then raise exception using errcode='42501',message='الصورة غير متاحة';end if;
 select avatar_path into path from public.chico_members where id=p_staff;return path;
end $$;
revoke all on function public.chico_avatar_path(uuid,date) from public,anon;
grant execute on function public.chico_avatar_path(uuid,date) to authenticated;
create or replace function public.chico_member_history(p_staff uuid,p_before bigint default 9223372036854775807) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform public.chico_actor();if p_staff<>public.chico_staff_id() and not public.chico_manage() then raise exception using errcode='42501',message='تقدر تشوف سجلك فقط';end if;
 return coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',(select m.display_name from public.chico_accounts ac join public.chico_members m on m.id=ac.member_id where ac.user_id=a.actor))) from(
 select * from public.chico_audit a where a.id<p_before and (
 a.target_id=p_staff::text or exists(select 1 from public.chico_accounts ac where ac.member_id=p_staff and ac.user_id::text=a.target_id)
 or a.before_data->>'staff_id'=p_staff::text or a.after_data->>'staff_id'=p_staff::text
 or exists(select 1 from public.chico_reports x where x.staff_id=p_staff and x.id::text=a.target_id)
 or exists(select 1 from public.chico_flags x where x.staff_id=p_staff and x.id::text=a.target_id)
 or exists(select 1 from public.chico_discipline x where x.staff_id=p_staff and x.id::text=a.target_id)
 or exists(select 1 from public.chico_training x where x.staff_id=p_staff and x.id::text=a.target_id)
 or exists(select 1 from public.chico_requests x where x.staff_id=p_staff and x.id::text=a.target_id)
 or exists(select 1 from public.chico_shifts x where x.staff_id=p_staff and x.id::text=a.target_id)
 or a.target_id like '%:'||p_staff::text)
 order by a.id desc limit 50)a),'[]'::jsonb);
end $$;
revoke all on function public.chico_member_history(uuid,bigint) from public,anon;
grant execute on function public.chico_member_history(uuid,bigint) to authenticated;
commit;
