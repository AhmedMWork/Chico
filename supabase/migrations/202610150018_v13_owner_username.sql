begin;
create or replace function public.chico_normalize_username(p_value text) returns text language sql immutable set search_path=pg_catalog as $$select lower(trim(regexp_replace(p_value,' +',' ','g')))$$;
revoke all on function public.chico_normalize_username(text) from public,anon,authenticated;
do $$declare c record;begin for c in select conname from pg_constraint where conrelid='chico_private.login_identifiers'::regclass and contype='c' and pg_get_constraintdef(oid) like '%username_normalized%' loop execute format('alter table chico_private.login_identifiers drop constraint %I',c.conname);end loop;end $$;
alter table chico_private.login_identifiers add constraint chico_username_format check(username_normalized=public.chico_normalize_username(username) and username_normalized ~ '^[a-z0-9][a-z0-9._ -]{2,31}$' and username_normalized !~ '  ' and right(username_normalized,1)<>' ');
create or replace function public.chico_service_lookup(p_username text) returns jsonb language sql security definer set search_path=public,chico_private,pg_temp as $$select jsonb_build_object('user_id',user_id,'auth_alias',auth_alias) from chico_private.login_identifiers where username_normalized=public.chico_normalize_username(p_username)$$;
-- Initial ownership is provisioned by a trusted operator, never from a public username match.
create or replace function public.chico_service_provision_owner(p_user uuid,p_alias text,p_username text,p_display text,p_rank text,p_joined date) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare staff uuid;name text:=public.chico_normalize_username(p_username);
begin
 perform pg_advisory_xact_lock(15001002);perform pg_advisory_xact_lock(15001001);
 if exists(select 1 from chico_grants where capability='owner') then raise exception 'تم إعداد المالك بالفعل';end if;
 if exists(select 1 from chico_accounts where user_id=p_user) or exists(select 1 from chico_private.login_identifiers where username_normalized=name) then raise exception 'الحساب موجود بالفعل؛ لا يتم ترقيته تلقائيًا';end if;
 if name !~ '^[a-z0-9][a-z0-9._ -]{2,31}$' or p_alias !~ '^[a-f0-9-]+@accounts\.chico\.invalid$' or length(trim(p_display)) not between 2 and 60 or p_rank not in ('helper','senior_helper','moderator','administrator','responsible') or p_joined is null or p_joined>(now() at time zone 'Asia/Riyadh')::date then raise exception 'راجع اسم الحساب والرتبة وتاريخ الانضمام';end if;
 insert into chico_members(display_name,rank,joined_at) values(trim(p_display),p_rank,p_joined) returning id into staff;
 insert into chico_accounts(user_id,status,member_id,reviewed_by,reviewed_at) values(p_user,'active',staff,p_user,now());
 insert into chico_private.login_identifiers(user_id,username,username_normalized,auth_alias) values(p_user,trim(regexp_replace(p_username,' +',' ','g')),name,p_alias);
 insert into chico_grants(user_id,capability,granted_by) values(p_user,'owner',p_user);
 insert into chico_audit(actor,action,target_id,after_data) values(p_user,'bootstrap_owner',p_user::text,jsonb_build_object('member_id',staff));
 return jsonb_build_object('user_id',p_user,'member_id',staff,'owner',true);
end $$;
create or replace function public.chico_service_provision_state(p_user uuid) returns jsonb language sql security definer set search_path=public,chico_private,pg_temp as $$select jsonb_build_object('account_exists',exists(select 1 from chico_accounts where user_id=p_user),'owner',exists(select 1 from chico_grants where user_id=p_user and capability='owner'))$$;
revoke all on function public.chico_service_provision_owner(uuid,text,text,text,text,date),public.chico_service_provision_state(uuid) from public,anon,authenticated;
grant execute on function public.chico_service_provision_owner(uuid,text,text,text,text,date),public.chico_service_provision_state(uuid) to service_role;
-- Preserve v1.2 command behavior behind a private implementation.
alter function public.chico_command(text,jsonb) rename to chico_command_v12;
revoke all on function public.chico_command_v12(text,jsonb) from public,anon,authenticated;
create or replace function public.chico_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();name text;display_value text;old text;
begin
 perform pg_advisory_xact_lock(15001002);perform public.chico_actor();
 if p_action='self_username' then
  if not chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور';end if;
  name=public.chico_normalize_username(p_data->>'username');display_value=trim(regexp_replace(p_data->>'username',' +',' ','g'));
  if name !~ '^[a-z0-9][a-z0-9._ -]{2,31}$' or name in ('admin','administrator','owner','root','support','system','chico') or (name='owner chico' and not chico_is_owner()) then raise exception 'اسم المستخدم غير متاح';end if;
  select username into old from chico_private.login_identifiers where user_id=actor for update;
  update chico_private.login_identifiers set username=display_value,username_normalized=name where user_id=actor;
  perform chico_log(p_action,actor::text,jsonb_build_object('username',old),jsonb_build_object('username',display_value));return jsonb_build_object('username',display_value);
 elsif p_action='notification_read_all' then
  update chico_notifications set read_at=now() where user_id=actor and read_at is null and (audience='self' or chico_manage());return jsonb_build_object('ok',true);
 end if;
 return public.chico_command_v12(p_action,p_data);
end $$;
revoke all on function public.chico_command(text,jsonb) from public,anon;
grant execute on function public.chico_command(text,jsonb) to authenticated;
commit;
