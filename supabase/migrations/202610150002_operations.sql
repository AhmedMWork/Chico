begin;
create table public.chico_reports (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 measured_at timestamptz not null, period_start date generated always as (public.chico_week(measured_at)) stored,
 report_type text not null check(report_type in ('daily','weekly')),
 ticket_mode text not null default 'week_to_date' check(ticket_mode in ('week_to_date','daily_count')),
 tickets integer not null check(tickets between 0 and 100000), hours numeric(7,2) not null check(hours between 0 and 168),
 rating numeric(4,2) not null check(rating between 0 and 5), complaints integer check(complaints>=0),
 requests_done integer check(requests_done>=0), messages integer check(messages>=0), source text not null check(length(source) between 3 and 500),
 status text not null check(status in ('draft','published')), version integer not null default 1,
 rank_at_measurement text not null check(rank_at_measurement in ('helper','senior_helper','moderator','administrator','responsible')), target_snapshot jsonb,policy_version integer not null default 1,
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(staff_id,measured_at,report_type), check(report_type<>'weekly' or ticket_mode='week_to_date')
);
create unique index chico_weekly_final_unique on public.chico_reports(staff_id,period_start) where report_type='weekly';
create index chico_report_period on public.chico_reports(period_start,staff_id);
create table public.chico_report_versions (
 id bigint generated always as identity primary key, report_id uuid not null references public.chico_reports(id),
 previous jsonb not null, reason text not null, changed_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.chico_flags (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 occurred_at timestamptz not null, source text not null, reason text not null, amount integer not null check(amount between 1 and 100),
 status text not null default 'verified' check(status in ('verified','voided')), void_reason text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(staff_id,occurred_at,source)
);
create table public.chico_discipline (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 kind text not null check(kind in ('warning','reprimand','dismissal','blacklist')),
 reason text not null, source text not null, occurred_at timestamptz not null,
 derived_from uuid[] not null default '{}', status text not null default 'verified' check(status in ('verified','voided')),
 consumed_by uuid references public.chico_discipline(id), void_reason text,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(staff_id,kind,occurred_at,source)
);
create table public.chico_training (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 stage text not null check(stage in ('waiting_training','training','awaiting_return','returned')),
 reason text not null, notes text not null default '', created_by uuid not null references auth.users(id),
 opened_at timestamptz not null default now(), training_completed_at timestamptz, returned_at timestamptz, updated_at timestamptz not null default now()
);
create unique index chico_one_open_training on public.chico_training(staff_id) where stage<>'returned';
create table public.chico_shifts (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 starts_at timestamptz not null, ends_at timestamptz not null, substitute_id uuid references public.chico_members(id),
 coverage text not null default 'assigned' check(coverage in ('assigned','needs_substitute','covered')),
 notes text not null default '', created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours'), check(substitute_id is null or substitute_id<>staff_id),unique(staff_id,starts_at)
);
create table public.chico_requests (
 id uuid primary key default gen_random_uuid(), staff_id uuid not null references public.chico_members(id),
 type text not null check(type in ('leave','excuse')), starts_at timestamptz not null, ends_at timestamptz not null,
 notice_at timestamptz not null, units integer not null check(units between 1 and 31), month_start date not null,
 reason text not null, source text not null, substitute_id uuid references public.chico_members(id),
 substitute_accepted boolean not null default false,status text not null default 'pending' check(status in ('pending','approved','rejected')),
 decision_reason text, decided_by uuid references auth.users(id), decided_at timestamptz,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 check(ends_at>starts_at),unique(staff_id,type,starts_at,source)
);
create index chico_requests_month on public.chico_requests(staff_id,month_start,type,status);
create table public.chico_meetings (
 id uuid primary key default gen_random_uuid(), starts_at timestamptz not null unique,
 title text not null default 'اجتماع الفريق الأسبوعي', channel_url text not null default '',
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.chico_attendance (
 meeting_id uuid not null references public.chico_meetings(id),staff_id uuid not null references public.chico_members(id),
 status text not null check(status in ('present','late','absent','excused')),note text not null default '',
 recorded_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),primary key(meeting_id,staff_id)
);
create table public.chico_confirmations (
 staff_id uuid not null references public.chico_members(id),period_start date not null,
 confirmed boolean not null,updated_by uuid not null references auth.users(id),updated_at timestamptz not null default now(),primary key(staff_id,period_start)
);
create table public.chico_import_jobs (
 id uuid primary key default gen_random_uuid(), file_hash text not null, type text not null check(type in ('members','reports')),
 selection_hash text not null,
 status text not null check(status in ('preview','applied')),summary jsonb not null default '{}', created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),applied_at timestamptz,unique(file_hash,type,selection_hash)
);

create or replace function public.chico_balance(p_staff uuid,p_month date default date_trunc('month',now() at time zone 'Asia/Riyadh')::date,p_at date default (now() at time zone 'Asia/Riyadh')::date) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare m public.chico_members;conf jsonb;leave_quota integer;excuse_quota integer;used_leave integer;held_leave integer;used_excuse integer;held_excuse integer;
begin
 select * into m from public.chico_members where id=p_staff;if not found then return '{}'::jsonb;end if;
 select config into conf from public.chico_settings where id;
 leave_quota=(conf->'leave'->>m.rank)::integer;excuse_quota=(conf->'excuses'->>m.rank)::integer;
 if leave_quota is not null and p_at<m.joined_at+14 then leave_quota=0;
 elsif leave_quota is not null and p_at<m.joined_at+30 then leave_quota=least(1,leave_quota);end if;
 select coalesce(sum(units) filter(where type='leave' and status='approved'),0),coalesce(sum(units) filter(where type='leave' and status='pending'),0),
 coalesce(sum(units) filter(where type='excuse' and status='approved'),0),coalesce(sum(units) filter(where type='excuse' and status='pending'),0)
 into used_leave,held_leave,used_excuse,held_excuse from public.chico_requests where staff_id=p_staff and month_start=date_trunc('month',p_month)::date;
 return jsonb_build_object('month',date_trunc('month',p_month)::date,'leave_quota',leave_quota,'leave_used',used_leave,'leave_held',held_leave,'leave_available',case when leave_quota is null then null else greatest(0,leave_quota-used_leave-held_leave) end,
 'excuse_quota',excuse_quota,'excuse_used',used_excuse,'excuse_held',held_excuse,'excuse_available',case when excuse_quota is null then null else greatest(0,excuse_quota-used_excuse-held_excuse) end);
end $$;
revoke all on function public.chico_balance(uuid,date,date) from public,anon,authenticated;

create or replace function public.chico_assert_target(p_user uuid) returns void language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare actor_rank text;target_rank text;
begin
 perform public.chico_actor();
 if not public.chico_cap('approve_accounts') then raise exception using errcode='42501',message='إدارة الحسابات غير مسموحة';end if;
 if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
 if public.chico_is_owner() then return;end if;
 if p_user=auth.uid() or exists(select 1 from public.chico_grants where user_id=p_user and capability='owner') then raise exception using errcode='42501',message='لا يمكنك تعديل هذا الحساب';end if;
 select m.rank into target_rank from public.chico_accounts a left join public.chico_members m on m.id=a.member_id where a.user_id=p_user;
 if target_rank in ('administrator','responsible') then raise exception using errcode='42501',message='الحساب خارج نطاق صلاحياتك';end if;
end $$;
revoke all on function public.chico_assert_target(uuid) from public,anon,authenticated;

create or replace function public.chico_approve_account(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=(p_data->>'user_id')::uuid;old public.chico_accounts;staff uuid;rank_value text:=p_data->>'rank';name text:=trim(p_data->>'display_name');previous_rank text;joined date:=(p_data->>'joined_at')::date;
begin
 perform pg_advisory_xact_lock(15001002);
 perform public.chico_assert_target(u);
 if coalesce(p_data->>'decision','active') not in ('active','rejected') then raise exception 'قرار اعتماد غير صالح';end if;
 select * into old from public.chico_accounts where user_id=u for update;if not found then raise exception 'الحساب غير موجود';end if;
 if old.status<>'pending' then raise exception 'تمت مراجعة هذا الحساب بالفعل';end if;
 if p_data->>'decision'='rejected' then update public.chico_accounts set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where user_id=u;
 else
  if not public.chico_is_owner() and rank_value in ('administrator','responsible') then raise exception using errcode='42501',message='تعيين القيادة يحتاج المالك';end if;
  if joined>(now() at time zone 'Asia/Riyadh')::date then raise exception 'تاريخ الانضمام لا يكون مستقبليًا';end if;
  staff=nullif(p_data->>'staff_id','')::uuid;
  if staff is null then insert into public.chico_members(display_name,rank,joined_at) values(name,rank_value,joined) returning id into staff;
  else
   perform 1 from public.chico_members where id=staff for update;if not found then raise exception 'عضو الفريق غير موجود';end if;
   if exists(select 1 from public.chico_accounts where member_id=staff and user_id<>u) then raise exception 'عضو الفريق مرتبط بحساب آخر';end if;
   if not public.chico_is_owner() and exists(select 1 from public.chico_members where id=staff and rank in ('administrator','responsible')) then raise exception using errcode='42501',message='العضو خارج نطاقك';end if;
   select rank into previous_rank from public.chico_members where id=staff;
   update public.chico_members set display_name=name,rank=rank_value,joined_at=joined,updated_at=now() where id=staff;
   if previous_rank<>rank_value then insert into public.chico_rank_history(staff_id,old_rank,new_rank,changed_by,reason) values(staff,previous_rank,rank_value,auth.uid(),'رتبة عند ربط واعتماد الحساب');end if;
  end if;
  update public.chico_accounts set member_id=staff,status='active',reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where user_id=u;
  if coalesce((p_data->>'approve_accounts')::boolean,false) then
   if not public.chico_is_owner() or rank_value not in ('administrator','responsible') then raise exception using errcode='42501',message='منح إدارة الحسابات يحتاج المالك ورتبة قيادية';end if;
   insert into public.chico_grants(user_id,capability,granted_by) values(u,'approve_accounts',auth.uid()) on conflict do nothing;
  end if;
 end if;
 perform public.chico_log('approve_account',u::text,to_jsonb(old),jsonb_build_object('status',p_data->>'decision','member_id',staff));
 insert into public.chico_notifications(user_id,title,body) values(u,case when p_data->>'decision'='rejected' then 'تمت مراجعة طلب عضويتك' else 'تم اعتماد حسابك' end,case when p_data->>'decision'='rejected' then 'تواصل مع المسؤول للمراجعة.' else 'يمكنك الآن الدخول إلى مساحتك.' end);
 return jsonb_build_object('user_id',u,'member_id',staff);
end $$;
revoke all on function public.chico_approve_account(jsonb) from public,anon,authenticated;

create or replace function public.chico_rank_at(p_staff uuid,p_time timestamptz) returns text language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select coalesce((select new_rank from public.chico_rank_history where staff_id=p_staff and created_at<=p_time order by created_at desc,id desc limit 1),
 (select old_rank from public.chico_rank_history where staff_id=p_staff and created_at>p_time order by created_at,id limit 1),
 (select rank from public.chico_members where id=p_staff));
$$;
revoke all on function public.chico_rank_at(uuid,timestamptz) from public,anon,authenticated;
create or replace function public.chico_policy_at(p_time timestamptz) returns public.chico_policy_versions language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select p from public.chico_policy_versions p order by (created_at<=p_time) desc,case when created_at<=p_time then -version else version end limit 1;
$$;
revoke all on function public.chico_policy_at(timestamptz) from public,anon,authenticated;
create or replace function public.chico_save_report(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();staff uuid:=(p_data->>'staff_id')::uuid;t timestamptz:=(p_data->>'measured_at')::timestamptz;kind text:=p_data->>'report_type';mode text:=coalesce(p_data->>'ticket_mode','week_to_date');
 w date:=public.chico_week(t);old public.chico_reports;row public.chico_reports;new_status text:=case when coalesce((p_data->>'publish')::boolean,true) then 'published' else 'draft' end;reason text:=coalesce(p_data->>'correction_reason','');
begin
 perform pg_advisory_xact_lock(15001002);
 if not public.chico_publish() then raise exception using errcode='42501',message='نشر الإحصائيات لرتبة Moderator فما فوق فقط';end if;
 if nullif(p_data->>'source_file','') is not null then perform public.chico_file_path((p_data->>'source_file')::uuid);end if;
 if t>now()+interval '5 minutes' then raise exception 'وقت التقرير لا يكون مستقبليًا';end if;
 if w<>public.chico_week(now()) and not public.chico_manage() then raise exception using errcode='42501',message='الفترة السابقة للقراءة فقط؛ التصحيح يحتاج القيادة';end if;
 if not exists(select 1 from public.chico_members where id=staff) then raise exception 'عضو الفريق غير موجود';end if;
 perform pg_advisory_xact_lock(hashtextextended(staff::text||w::text||kind,0));
 if kind='weekly' then select * into old from public.chico_reports where staff_id=staff and period_start=w and report_type='weekly' for update;
 else select * into old from public.chico_reports where staff_id=staff and measured_at=t and report_type=kind for update;end if;
 if kind='daily' and exists(select 1 from public.chico_reports where staff_id=staff and period_start=w and report_type='daily' and ticket_mode<>mode and status='published' and id<>coalesce(old.id,gen_random_uuid())) then raise exception 'لا تخلط العدد اليومي بالإجمالي التراكمي في الفترة نفسها';end if;
 if old.id is not null then
  if old.tickets=(p_data->>'tickets')::integer and old.hours=(p_data->>'hours')::numeric and old.rating=(p_data->>'rating')::numeric and old.ticket_mode=mode and old.complaints is not distinct from (p_data->>'complaints')::integer and old.requests_done is not distinct from (p_data->>'requests_done')::integer and old.messages is not distinct from (p_data->>'messages')::integer and old.source=p_data->>'source' and (nullif(p_data->>'source_file','') is null or old.source_file=(p_data->>'source_file')::uuid or exists(select 1 from public.chico_files a join public.chico_files b on a.content_hash=b.content_hash where a.id=old.source_file and b.id=(p_data->>'source_file')::uuid)) and old.status=new_status then return jsonb_build_object('id',old.id,'version',old.version,'unchanged',true);end if;
  if old.status='published' and (not public.chico_manage() or length(trim(reason))<3) then raise exception using errcode='42501',message='تصحيح تقرير منشور يحتاج القيادة وسببًا موثقًا';end if;
  if old.status='draft' and old.created_by<>actor and not public.chico_manage() then raise exception using errcode='42501',message='هذه المسودة تخص عضوًا آخر';end if;
  if (p_data->>'expected_version') is null or (p_data->>'expected_version')::integer<>old.version then raise exception 'تغير السجل؛ حدّث الصفحة قبل إعادة الحفظ';end if;
  insert into public.chico_report_versions(report_id,previous,reason,changed_by) values(old.id,to_jsonb(old),case when reason='' then 'تحديث مسودة' else reason end,actor);
  update public.chico_reports set measured_at=t,ticket_mode=mode,tickets=(p_data->>'tickets')::integer,hours=(p_data->>'hours')::numeric,rating=(p_data->>'rating')::numeric,
   complaints=(p_data->>'complaints')::integer,requests_done=(p_data->>'requests_done')::integer,messages=(p_data->>'messages')::integer,source=p_data->>'source',source_file=coalesce(nullif(p_data->>'source_file','')::uuid,source_file),status=new_status,version=version+1,updated_by=actor,updated_at=now()
   where id=old.id returning * into row;
 else
  insert into public.chico_reports(staff_id,measured_at,report_type,ticket_mode,tickets,hours,rating,complaints,requests_done,messages,source,status,created_by,updated_by,rank_at_measurement,policy_version,target_snapshot,source_file)
  values(staff,t,kind,mode,(p_data->>'tickets')::integer,(p_data->>'hours')::numeric,(p_data->>'rating')::numeric,(p_data->>'complaints')::integer,(p_data->>'requests_done')::integer,(p_data->>'messages')::integer,p_data->>'source',new_status,actor,actor,public.chico_rank_at(staff,t),(public.chico_policy_at(t)).version,(public.chico_policy_at(t)).config->'goals'->public.chico_rank_at(staff,t),nullif(p_data->>'source_file','')::uuid) returning * into row;
 end if;
 perform public.chico_log('save_report',row.id::text,case when old.id is null then null else to_jsonb(old) end,to_jsonb(row));
 return jsonb_build_object('id',row.id,'version',row.version,'unchanged',false);
end $$;
revoke all on function public.chico_save_report(jsonb) from public,anon,authenticated;

create or replace function public.chico_add_request(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare staff uuid:=(p_data->>'staff_id')::uuid;kind text:=p_data->>'type';a timestamptz:=(p_data->>'starts_at')::timestamptz;b timestamptz:=(p_data->>'ends_at')::timestamptz;n timestamptz:=(p_data->>'notice_at')::timestamptz;
month_value date:=date_trunc('month',a at time zone 'Asia/Riyadh')::date;units_value integer;balance jsonb;available integer;result uuid;
begin
 perform public.chico_actor();if not public.chico_manage() then raise exception using errcode='42501',message='تسجيل الطلبات يحتاج إدارة الفريق';end if;
 perform 1 from public.chico_members where id=staff for update;if not found then raise exception 'العضو غير موجود';end if;
 if a<(select joined_at from public.chico_members where id=staff)::timestamp at time zone 'Asia/Riyadh' then raise exception 'الطلب قبل تاريخ انضمام العضو';end if;
 if b<=a or n>now()+interval '5 minutes' then raise exception 'أوقات الطلب غير صالحة';end if;
 if date_trunc('month',(b-interval '1 second') at time zone 'Asia/Riyadh')::date<>month_value then raise exception 'قسّم الطلب الممتد لشهرين إلى طلبين منفصلين';end if;
 if kind='excuse' then
  if n>=a-interval '1 hour' then raise exception 'التبرير قبل المناوبة بأكثر من ساعة';end if;
  if nullif(p_data->>'substitute_id','') is null or (p_data->>'substitute_id')::uuid=staff then raise exception 'حدد بديلًا آخر للمناوبة';end if;units_value=1;
 else
  if (a at time zone 'Asia/Riyadh')::time<>time '00:00' or (b at time zone 'Asia/Riyadh')::time<>time '00:00' then raise exception 'الإجازة تحدد بأيام كاملة';end if;
  units_value=(b at time zone 'Asia/Riyadh')::date-(a at time zone 'Asia/Riyadh')::date;
 end if;
 balance=public.chico_balance(staff,month_value,(a at time zone 'Asia/Riyadh')::date);available=(balance->>(case when kind='leave' then 'leave_available' else 'excuse_available' end))::integer;
 if available is null then raise exception 'سياسة الرصيد لهذه الرتبة لم تضبط بعد';end if;
 if units_value>available then raise exception 'الرصيد المتاح لا يكفي؛ الطلبات المعلقة تحجز الرصيد';end if;
 insert into public.chico_requests(staff_id,type,starts_at,ends_at,notice_at,units,month_start,reason,source,substitute_id,substitute_accepted,created_by)
 values(staff,kind,a,b,n,units_value,month_value,trim(p_data->>'reason'),trim(p_data->>'source'),nullif(p_data->>'substitute_id','')::uuid,coalesce((p_data->>'substitute_accepted')::boolean,false),auth.uid()) returning id into result;
 perform public.chico_log('request_create',result::text,null,p_data);return jsonb_build_object('id',result);
end $$;
revoke all on function public.chico_add_request(jsonb) from public,anon,authenticated;

create or replace function public.chico_my_sessions() returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor(false);
begin return coalesce((select jsonb_agg(jsonb_build_object('id',id,'user_agent',user_agent,'created_at',created_at,'last_seen_at',last_seen_at,'expires_at',expires_at,'current',auth_session_id::text=auth.jwt()->>'session_id')) from chico_private.sessions where user_id=u and revoked_at is null and expires_at>now()),'[]'::jsonb);end $$;
create or replace function public.chico_recovery_issue(p_user uuid,p_hash text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform pg_advisory_xact_lock(15001002);
 perform public.chico_assert_target(p_user);
 update chico_private.recovery_tokens set consumed_at=now() where user_id=p_user and consumed_at is null;
 insert into chico_private.recovery_tokens(user_id,token_hash,issued_by,expires_at) values(p_user,p_hash,auth.uid(),now()+interval '15 minutes');
 perform public.chico_log('recovery_issued',p_user::text);
end $$;
create or replace function public.chico_service_recovery_claim(p_hash text,p_claim uuid) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 update chico_private.recovery_tokens set claim_id=p_claim,claim_until=now()+interval '2 minutes'
 where token_hash=p_hash and consumed_at is null and expires_at>now() and (claim_until is null or claim_until<now()) returning user_id into result;
 if result is null then return null;end if;return jsonb_build_object('user_id',result);
end $$;
create or replace function public.chico_service_recovery_finish(p_hash text,p_claim uuid) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid;
begin
 update chico_private.recovery_tokens set consumed_at=now() where token_hash=p_hash and claim_id=p_claim and consumed_at is null and expires_at>now() returning user_id into u;
 if u is null then raise exception 'رمز الاستعادة غير صالح';end if;
 update chico_private.sessions set revoked_at=now() where user_id=u and revoked_at is null;
 update public.chico_accounts set must_change_password=false where user_id=u;
end $$;

create or replace function public.chico_dashboard(p_period date default public.chico_week(now())) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor();staff uuid:=public.chico_staff_id();lead boolean:=public.chico_manage();publish boolean:=public.chico_publish();approval boolean:=public.chico_cap('approve_accounts');data jsonb;
begin
 if extract(isodow from p_period)<>1 then raise exception 'الفترة يجب أن تبدأ يوم الاثنين';end if;
 data=jsonb_build_object('account',public.chico_me(),'period',p_period,
 'members',coalesce((select jsonb_agg(case when lead or m.id=staff then to_jsonb(m) else jsonb_build_object('id',m.id,'display_name',m.display_name,'rank',m.rank,'game_status',m.game_status) end order by m.display_name) from public.chico_members m where lead or publish or m.id=staff),'[]'::jsonb),
 'snapshots',coalesce((select jsonb_agg(to_jsonb(r) order by r.measured_at desc) from public.chico_reports r where r.period_start=p_period and (lead or r.staff_id=staff or r.created_by=u)),'[]'::jsonb),
 'flags',coalesce((select jsonb_agg(to_jsonb(f) order by occurred_at desc) from public.chico_flags f where lead or f.staff_id=staff),'[]'::jsonb),
 'discipline',coalesce((select jsonb_agg(to_jsonb(d) order by occurred_at desc) from public.chico_discipline d where lead or d.staff_id=staff),'[]'::jsonb),
 'training',coalesce((select jsonb_agg(to_jsonb(t) order by opened_at desc) from public.chico_training t where lead or t.staff_id=staff),'[]'::jsonb),
 'shifts',coalesce((select jsonb_agg(to_jsonb(s) order by starts_at) from public.chico_shifts s where (lead or s.staff_id=staff or s.substitute_id=staff) and s.ends_at>now()-interval '7 days' and s.starts_at<now()+interval '30 days'),'[]'::jsonb),
 'requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from public.chico_requests r where (lead or r.staff_id=staff) and r.created_at>now()-interval '6 months'),'[]'::jsonb),
 'meetings',coalesce((select jsonb_agg(to_jsonb(m) order by starts_at desc) from public.chico_meetings m where starts_at>now()-interval '90 days'),'[]'::jsonb),
 'attendance',coalesce((select jsonb_agg(to_jsonb(a)) from public.chico_attendance a where lead or a.staff_id=staff),'[]'::jsonb),
 'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by created_at desc) from public.chico_notifications n where n.user_id=u and n.created_at>now()-interval '90 days'),'[]'::jsonb),
 'pending_accounts',case when approval then coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'username',l.username,'status',a.status,'created_at',a.created_at) order by a.created_at) from public.chico_accounts a join chico_private.login_identifiers l using(user_id) where a.status='pending'),'[]'::jsonb) else '[]'::jsonb end,
 'accounts',case when approval then coalesce((select jsonb_agg(jsonb_build_object('user_id',a.user_id,'member_id',a.member_id,'status',a.status,'display_name',m.display_name,'rank',m.rank,'created_at',a.created_at)) from public.chico_accounts a left join public.chico_members m on m.id=a.member_id where a.status<>'pending'),'[]'::jsonb) else '[]'::jsonb end,
 'audit',case when lead then coalesce((select jsonb_agg(to_jsonb(a)) from (select * from public.chico_audit order by created_at desc limit 100) a),'[]'::jsonb) else '[]'::jsonb end,
 'balances',public.chico_balance(staff),
 'settings',(select config from public.chico_settings where id),
 'grants',case when public.chico_is_owner() then coalesce((select jsonb_agg(to_jsonb(g)) from public.chico_grants g),'[]'::jsonb) else '[]'::jsonb end,
 'confirmations',coalesce((select jsonb_agg(to_jsonb(c)) from public.chico_confirmations c where c.period_start=p_period and (lead or c.staff_id=staff)),'[]'::jsonb),
 'import_jobs',case when public.chico_cap('manage_imports') or public.chico_is_owner() then coalesce((select jsonb_agg(to_jsonb(j)) from public.chico_import_jobs j),'[]'::jsonb) else '[]'::jsonb end);
 return data;
end $$;

do $$ declare table_name text;begin
 foreach table_name in array array['chico_reports','chico_report_versions','chico_flags','chico_discipline','chico_training','chico_shifts','chico_requests','chico_meetings','chico_attendance','chico_confirmations','chico_import_jobs'] loop
  execute format('alter table public.%I enable row level security',table_name);
  execute format('revoke all on public.%I from anon,authenticated',table_name);
  execute format('grant select on public.%I to authenticated',table_name);
 end loop;
end $$;
create policy reports_read on public.chico_reports for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage() or created_by=auth.uid()));
create policy report_versions_read on public.chico_report_versions for select to authenticated using(public.chico_manage());
create policy flags_read on public.chico_flags for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
create policy discipline_read on public.chico_discipline for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
create policy training_read on public.chico_training for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
create policy shifts_read on public.chico_shifts for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or substitute_id=public.chico_staff_id() or public.chico_manage()));
create policy requests_read on public.chico_requests for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
create policy meetings_read on public.chico_meetings for select to authenticated using(public.chico_valid_session() and exists(select 1 from public.chico_accounts where user_id=auth.uid() and status='active'));
create policy attendance_read on public.chico_attendance for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
create policy confirmations_read on public.chico_confirmations for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
create policy imports_read on public.chico_import_jobs for select to authenticated using(public.chico_manage() and public.chico_cap('manage_imports'));

do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'chico_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  if f.proname like 'chico_service_%' then execute format('grant execute on function %s to service_role',f.signature);
  elsif f.proname in ('chico_balance','chico_log','chico_assert_target','chico_approve_account','chico_save_report','chico_add_request','chico_rank_at') then null;
  else execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
commit;
