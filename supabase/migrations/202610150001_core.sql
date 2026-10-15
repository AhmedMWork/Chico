begin;
create schema if not exists chico_private;
revoke all on schema chico_private from public, anon, authenticated;
grant usage on schema chico_private to service_role;
revoke create on schema public from public, anon, authenticated;

create table public.chico_members (
 id uuid primary key default gen_random_uuid(), display_name text not null check(length(display_name) between 2 and 60), external_ref text unique, flags_reviewed boolean not null default false,flags_reviewed_at timestamptz,
 rank text not null check(rank in ('helper','senior_helper','moderator','administrator','responsible')),
 joined_at date not null, game_status text not null default 'active' check(game_status in ('active','training','dismissed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.chico_accounts (
 user_id uuid primary key references auth.users(id) on delete restrict,
 status text not null default 'pending' check(status in ('pending','active','rejected','disabled')),
 member_id uuid unique references public.chico_members(id), must_change_password boolean not null default false,
 reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(status<>'active' or member_id is not null)
);
create table chico_private.login_identifiers (
 user_id uuid primary key references public.chico_accounts(user_id) on delete restrict,
 username text not null, username_normalized text not null unique check(username_normalized=lower(username_normalized)),
 auth_alias text not null unique,
 check(username_normalized ~ '^[a-z0-9][a-z0-9._-]{2,31}$')
);
create table public.chico_grants (
 user_id uuid not null references public.chico_accounts(user_id), capability text not null check(capability in ('owner','approve_accounts','manage_imports','manage_settings')),
 granted_by uuid references auth.users(id), created_at timestamptz not null default now(), primary key(user_id,capability)
);
create unique index chico_single_owner on public.chico_grants(capability) where capability='owner';
create table chico_private.sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique,
 user_id uuid not null references public.chico_accounts(user_id), auth_session_id uuid not null unique,
 tokens_cipher text not null, access_expires_at timestamptz not null, expires_at timestamptz not null,
 idle_seconds integer not null check(idle_seconds between 60 and 604800), remembered boolean not null,
 last_seen_at timestamptz not null default now(), created_at timestamptz not null default now(),
 revoked_at timestamptz, verified_at timestamptz not null default now(),
 refresh_lease uuid, refresh_lease_until timestamptz, user_agent text not null default '',
 check(length(token_hash)=64), check(expires_at>created_at)
);
create index chico_session_user on chico_private.sessions(user_id);
create table chico_private.recovery_tokens (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.chico_accounts(user_id),
 token_hash text not null unique check(length(token_hash)=64), issued_by uuid not null references auth.users(id),
 expires_at timestamptz not null, consumed_at timestamptz, claim_id uuid, claim_until timestamptz,
 created_at timestamptz not null default now()
);
create table chico_private.rate_limits (
 bucket text primary key, attempts integer not null default 1, window_start timestamptz not null default now()
);
create table public.chico_audit (
 id bigint generated always as identity primary key, actor uuid references auth.users(id), action text not null,
 target_id text, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create index chico_audit_date on public.chico_audit(created_at desc);
create table public.chico_settings (
 id boolean primary key default true check(id),
 config jsonb not null default '{"leave":{"helper":3,"senior_helper":3,"moderator":4,"administrator":null,"responsible":null},"excuses":{"helper":4,"senior_helper":4,"moderator":4,"administrator":null,"responsible":null},"meeting_channel":"","excuse_channel":"","leave_channel":""}'::jsonb,
 version integer not null default 1, updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
insert into public.chico_settings(id) values(true);
update public.chico_settings set config=config||'{"goals": {"helper": {"tickets": 120, "hours": 14, "rating": 4.8, "complaints": null, "requests": null, "messages": null}, "senior_helper": {"tickets": 120, "hours": 14, "rating": 4.8, "complaints": null, "requests": null, "messages": 70}, "moderator": {"tickets": 200, "hours": 14, "rating": 4.85, "complaints": 15, "requests": 20, "messages": null}}}'::jsonb;
create table public.chico_policy_versions(version integer primary key,config jsonb not null,created_at timestamptz not null default now(),changed_by uuid references auth.users(id));
insert into public.chico_policy_versions(version,config) select version,config from public.chico_settings;
create table public.chico_notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.chico_accounts(user_id),
 title text not null, body text not null default '', link text not null default '/app', read_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.chico_rank_history (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 old_rank text, new_rank text not null, changed_by uuid not null references auth.users(id), reason text not null,
 created_at timestamptz not null default now()
);

create or replace function public.chico_valid_session() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select exists(select 1 from chico_private.sessions s join public.chico_accounts a on a.user_id=s.user_id
 where s.user_id=auth.uid() and s.auth_session_id::text=auth.jwt()->>'session_id'
 and s.revoked_at is null and s.expires_at>now() and s.last_seen_at+make_interval(secs=>s.idle_seconds)>now()
 and a.status<>'disabled');
$$;
create or replace function public.chico_data_session() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select public.chico_valid_session() and exists(select 1 from public.chico_accounts where user_id=auth.uid() and status='active' and member_id is not null);
$$;
create or replace function public.chico_actor(p_active boolean default true) returns uuid language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
begin
 if auth.uid() is null or not public.chico_valid_session() then raise exception using errcode='42501',message='جلسة الدخول غير صالحة'; end if;
 if p_active and not exists(select 1 from public.chico_accounts where user_id=auth.uid() and status='active' and member_id is not null) then raise exception using errcode='42501',message='الحساب غير معتمد'; end if;
 return auth.uid();
end $$;
create or replace function public.chico_is_owner() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select public.chico_valid_session() and exists(select 1 from public.chico_accounts a join public.chico_grants g using(user_id) where a.user_id=auth.uid() and a.status='active' and g.capability='owner');
$$;
create or replace function public.chico_manage() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select public.chico_valid_session() and exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=auth.uid() and a.status='active' and (m.rank in ('administrator','responsible') or public.chico_is_owner()));
$$;
create or replace function public.chico_cap(p_name text) returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select public.chico_valid_session() and exists(select 1 from public.chico_accounts a where a.user_id=auth.uid() and a.status='active' and (public.chico_is_owner() or exists(select 1 from public.chico_grants g join public.chico_members m on m.id=a.member_id where g.user_id=a.user_id and g.capability=p_name and m.rank in ('administrator','responsible'))));
$$;
create or replace function public.chico_publish() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select public.chico_valid_session() and exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=auth.uid() and a.status='active' and m.game_status='active' and m.rank in ('moderator','administrator','responsible'));
$$;
create or replace function public.chico_staff_id() returns uuid language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select member_id from public.chico_accounts where user_id=auth.uid() and status='active' and public.chico_valid_session();
$$;
create or replace function public.chico_week(p_time timestamptz) returns date language sql immutable as $$
 select date_trunc('week',timezone('Asia/Riyadh',p_time)-interval '3 hours')::date;
$$;
create or replace function public.chico_log(p_action text,p_target text,p_before jsonb default null,p_after jsonb default null) returns void language sql security definer set search_path=public,chico_private,pg_temp as $$
 insert into public.chico_audit(actor,action,target_id,before_data,after_data) values(auth.uid(),p_action,p_target,p_before,p_after);
$$;
revoke all on function public.chico_log(text,text,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.chico_me() returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor(false); result jsonb;
begin
 select jsonb_build_object('user_id',a.user_id,'username',l.username,'status',a.status,'member',case when a.status='active' then to_jsonb(m) else null end,
 'owner',exists(select 1 from public.chico_grants g where g.user_id=u and g.capability='owner'),
 'capabilities',coalesce((select jsonb_agg(g.capability) from public.chico_grants g where g.user_id=u),'[]'::jsonb),
 'must_change_password',a.must_change_password)
 into result from public.chico_accounts a join chico_private.login_identifiers l using(user_id)
 left join public.chico_members m on m.id=a.member_id where a.user_id=u;
 return result;
end $$;

-- Service-only operations. The application never calls these with a visitor's token.
create or replace function public.chico_service_lookup(p_username text) returns jsonb language sql security definer set search_path=public,chico_private,pg_temp as $$
 select jsonb_build_object('user_id',user_id,'auth_alias',auth_alias) from chico_private.login_identifiers where username_normalized=lower(trim(p_username));
$$;
create or replace function public.chico_service_register(p_user uuid,p_username text,p_alias text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 insert into public.chico_accounts(user_id) values(p_user);
 insert into chico_private.login_identifiers(user_id,username,username_normalized,auth_alias) values(p_user,trim(p_username),lower(trim(p_username)),p_alias);
 insert into public.chico_notifications(user_id,title,body) select g.user_id,'حساب جديد بانتظار الاعتماد','وصل طلب عضوية جديد؛ راجع الهوية قبل الاعتماد.' from public.chico_grants g join public.chico_accounts a using(user_id) where g.capability in ('owner','approve_accounts') and a.status='active' group by g.user_id;
end $$;
create or replace function public.chico_service_session_create(p_user uuid,p_auth_session uuid,p_hash text,p_cipher text,p_access_expires timestamptz,p_remember boolean,p_agent text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 if not exists(select 1 from public.chico_accounts where user_id=p_user and status<>'disabled') then raise exception using errcode='42501',message='الحساب غير متاح'; end if;
 insert into chico_private.sessions(user_id,auth_session_id,token_hash,tokens_cipher,access_expires_at,expires_at,idle_seconds,remembered,user_agent)
 values(p_user,p_auth_session,p_hash,p_cipher,p_access_expires,now()+case when p_remember then interval '30 days' else interval '12 hours' end,case when p_remember then 604800 else 3600 end,p_remember,left(p_agent,250));
end $$;
create or replace function public.chico_service_session_get(p_hash text) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare s chico_private.sessions;
begin
 select x.* into s from chico_private.sessions x join public.chico_accounts a using(user_id) where x.token_hash=p_hash and x.revoked_at is null and x.expires_at>now() and x.last_seen_at+make_interval(secs=>x.idle_seconds)>now() and a.status<>'disabled';
 if not found then return null; end if;
 update chico_private.sessions set last_seen_at=now() where id=s.id and last_seen_at<now()-interval '30 seconds';
 return to_jsonb(s);
end $$;
create or replace function public.chico_service_refresh_lock(p_hash text) returns uuid language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare lease uuid:=gen_random_uuid();
begin
 update chico_private.sessions set refresh_lease=lease,refresh_lease_until=now()+interval '90 seconds'
 where token_hash=p_hash and revoked_at is null and expires_at>now() and (refresh_lease_until is null or refresh_lease_until<now());
 if not found then return null; end if;return lease;
end $$;
create or replace function public.chico_service_refresh_save(p_hash text,p_lease uuid,p_cipher text,p_access_expires timestamptz) returns boolean language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 update chico_private.sessions set tokens_cipher=p_cipher,access_expires_at=p_access_expires,refresh_lease=null,refresh_lease_until=null where token_hash=p_hash and refresh_lease=p_lease and revoked_at is null;
 return found;
end $$;
create or replace function public.chico_service_refresh_release(p_hash text,p_lease uuid) returns void language sql security definer set search_path=public,chico_private,pg_temp as $$
 update chico_private.sessions set refresh_lease=null,refresh_lease_until=null where token_hash=p_hash and refresh_lease=p_lease;
$$;
create or replace function public.chico_service_revoke(p_hash text,p_all boolean default false) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid;
begin
 select user_id into u from chico_private.sessions where token_hash=p_hash and revoked_at is null;
 update chico_private.sessions set revoked_at=now() where (token_hash=p_hash or (p_all and user_id=u)) and revoked_at is null;
end $$;
create or replace function public.chico_service_verify(p_hash text) returns void language sql security definer set search_path=public,chico_private,pg_temp as $$
 update chico_private.sessions set verified_at=now() where token_hash=p_hash and revoked_at is null;
$$;
create or replace function public.chico_recent_verification() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select exists(select 1 from chico_private.sessions where user_id=auth.uid() and auth_session_id::text=auth.jwt()->>'session_id' and public.chico_valid_session() and verified_at>now()-interval '15 minutes');
$$;
create or replace function public.chico_service_rate(p_bucket text,p_limit integer,p_window integer) returns boolean language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare n integer;
begin
 if length(p_bucket)>150 or p_limit not between 1 and 1000 or p_window not between 1 and 86400 then raise exception 'Invalid rate limit';end if;
 insert into chico_private.rate_limits(bucket,attempts) values(p_bucket,1)
 on conflict(bucket) do update set attempts=case when chico_private.rate_limits.window_start<now()-make_interval(secs=>p_window) then 1 else chico_private.rate_limits.attempts+1 end,
 window_start=case when chico_private.rate_limits.window_start<now()-make_interval(secs=>p_window) then now() else chico_private.rate_limits.window_start end returning attempts into n;
 delete from chico_private.rate_limits where window_start<now()-interval '2 days';
 return n<=p_limit;
end $$;
create or replace function public.chico_service_bootstrap(p_user uuid,p_display text,p_rank text default 'moderator',p_joined date default (now() at time zone 'Asia/Riyadh')::date) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare staff uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 perform pg_advisory_xact_lock(15001001);
 if exists(select 1 from public.chico_grants where capability='owner') then raise exception using errcode='42501',message='تم إعداد المالك بالفعل';end if;
 if not exists(select 1 from public.chico_accounts where user_id=p_user and status='pending') then raise exception 'سجل حسابك أولًا';end if;
 if p_joined>(now() at time zone 'Asia/Riyadh')::date then raise exception 'تاريخ الانضمام لا يكون مستقبليًا';end if;
 insert into public.chico_members(display_name,rank,joined_at) values(p_display,p_rank,p_joined) returning id into staff;
 update public.chico_accounts set status='active',member_id=staff,reviewed_by=p_user,reviewed_at=now() where user_id=p_user;
 insert into public.chico_grants(user_id,capability,granted_by) values(p_user,'owner',p_user);
 insert into public.chico_audit(actor,action,target_id,after_data) values(p_user,'bootstrap_owner',p_user::text,jsonb_build_object('member_id',staff));
end $$;

alter table public.chico_policy_versions enable row level security;
create policy chico_policy_read on public.chico_policy_versions for select to authenticated using(public.chico_data_session());
grant select on public.chico_policy_versions to authenticated;
alter table public.chico_members enable row level security;
alter table public.chico_accounts enable row level security;
alter table public.chico_grants enable row level security;
alter table public.chico_audit enable row level security;
alter table public.chico_settings enable row level security;
alter table public.chico_notifications enable row level security;
alter table public.chico_rank_history enable row level security;
create policy members_read on public.chico_members for select to authenticated using(public.chico_data_session() and (id=public.chico_staff_id() or public.chico_manage()));
create policy accounts_read on public.chico_accounts for select to authenticated using(public.chico_valid_session() and (user_id=auth.uid() or public.chico_cap('approve_accounts')));
create policy grants_read on public.chico_grants for select to authenticated using(public.chico_valid_session() and (user_id=auth.uid() or public.chico_is_owner()));
create policy audit_read on public.chico_audit for select to authenticated using(public.chico_manage());
create policy settings_read on public.chico_settings for select to authenticated using(public.chico_valid_session() and exists(select 1 from public.chico_accounts where user_id=auth.uid() and status='active'));
create policy notifications_read on public.chico_notifications for select to authenticated using(public.chico_valid_session() and user_id=auth.uid());
create policy rank_history_read on public.chico_rank_history for select to authenticated using(public.chico_valid_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
revoke all on public.chico_members,public.chico_accounts,public.chico_grants,public.chico_audit,public.chico_settings,public.chico_notifications,public.chico_rank_history from anon,authenticated;
grant select on public.chico_members,public.chico_accounts,public.chico_grants,public.chico_audit,public.chico_settings,public.chico_notifications,public.chico_rank_history to authenticated;
grant all on all tables in schema chico_private to service_role;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'chico_%'
 loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  if f.proname like 'chico_service_%' then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname<>'chico_log' then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
commit;
