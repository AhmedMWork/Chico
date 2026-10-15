begin;
-- v1.1 upgrade: operational pseudonyms only; no client fingerprint or external identity.
update chico_private.sessions set user_agent='';
delete from chico_private.rate_limits where bucket like '%:ip:%';
update public.chico_members set external_ref=null;
alter table public.chico_members add constraint chico_no_external_identity check(external_ref is null);
update public.chico_audit set before_data=before_data-'external_ref'-'user_agent',after_data=after_data-'external_ref'-'user_agent';
update public.chico_audit set after_data=after_data-'name' where action='file_upload';
-- Opaque session IDs remain necessary for explicit revocation. The legacy p_agent is ignored.


create or replace function public.chico_service_session_create(p_user uuid,p_auth_session uuid,p_hash text,p_cipher text,p_access_expires timestamptz,p_remember boolean,p_agent text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 if not exists(select 1 from public.chico_accounts where user_id=p_user and status<>'disabled') then raise exception using errcode='42501',message='الحساب غير متاح'; end if;
 insert into chico_private.sessions(user_id,auth_session_id,token_hash,tokens_cipher,access_expires_at,expires_at,idle_seconds,remembered,user_agent)
 values(p_user,p_auth_session,p_hash,p_cipher,p_access_expires,now()+case when p_remember then interval '30 days' else interval '12 hours' end,case when p_remember then 604800 else 3600 end,p_remember,'');
end $$;

create or replace function public.chico_my_sessions() returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor(false);
begin return coalesce((select jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'last_seen_at',last_seen_at,'expires_at',expires_at,'current',auth_session_id::text=auth.jwt()->>'session_id')) from chico_private.sessions where user_id=u and revoked_at is null and expires_at>now()),'[]'::jsonb);end $$;

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
 if nullif(p_data->>'report_id','') is not null then
  select * into old from public.chico_reports where id=(p_data->>'report_id')::uuid for update;
  if old.id is null then raise exception 'التقرير غير موجود؛ لن يُنشأ بدلًا منه تقرير جديد';end if;
  if old.staff_id<>staff or old.report_type<>kind or old.period_start<>w then raise exception 'هوية التقرير ونوعه وفترته ثابتة؛ أنشئ تقريرًا مستقلًا لنقل الفترة';end if;
 elsif p_data->>'expected_version' is not null then
  raise exception 'معرف التقرير مطلوب لتصحيح سجل موجود';
 elsif kind='weekly' then select * into old from public.chico_reports where staff_id=staff and period_start=w and report_type='weekly' for update;
 else select * into old from public.chico_reports where staff_id=staff and measured_at=t and report_type=kind for update;end if;
 if kind='daily' and exists(select 1 from public.chico_reports where staff_id=staff and period_start=w and report_type='daily' and ticket_mode<>mode and status='published' and id<>coalesce(old.id,gen_random_uuid())) then raise exception 'لا تخلط العدد اليومي بالإجمالي التراكمي في الفترة نفسها';end if;
 if old.id is not null then
  if p_data->>'report_id' is not null and ((p_data->>'expected_version') is null or (p_data->>'expected_version')::integer<>old.version) then raise exception 'تغير السجل؛ حدّث الصفحة قبل إعادة الحفظ';end if;
  if old.measured_at=t and old.tickets=(p_data->>'tickets')::integer and old.hours=(p_data->>'hours')::numeric and old.rating=(p_data->>'rating')::numeric and old.ticket_mode=mode and old.complaints is not distinct from (p_data->>'complaints')::integer and old.requests_done is not distinct from (p_data->>'requests_done')::integer and old.messages is not distinct from (p_data->>'messages')::integer and old.source=p_data->>'source' and (nullif(p_data->>'source_file','') is null or old.source_file=(p_data->>'source_file')::uuid or exists(select 1 from public.chico_files a join public.chico_files b on a.content_hash=b.content_hash where a.id=old.source_file and b.id=(p_data->>'source_file')::uuid)) and old.status=new_status then return jsonb_build_object('id',old.id,'version',old.version,'unchanged',true);end if;
  if old.status='published' and (not public.chico_manage() or length(trim(reason))<3) then raise exception using errcode='42501',message='تصحيح تقرير منشور يحتاج القيادة وسببًا موثقًا';end if;
  if old.status='draft' and old.created_by<>actor and not public.chico_manage() then raise exception using errcode='42501',message='هذه المسودة تخص عضوًا آخر';end if;
  if (p_data->>'expected_version') is null or (p_data->>'expected_version')::integer<>old.version then raise exception 'تغير السجل؛ حدّث الصفحة قبل إعادة الحفظ';end if;
  insert into public.chico_report_versions(report_id,previous,reason,changed_by) values(old.id,to_jsonb(old),case when reason='' then 'تحديث مسودة' else reason end,actor);
  update public.chico_reports set measured_at=t,rank_at_measurement=public.chico_rank_at(staff,t),policy_version=(public.chico_policy_at(t)).version,target_snapshot=(public.chico_policy_at(t)).config->'goals'->public.chico_rank_at(staff,t),ticket_mode=mode,tickets=(p_data->>'tickets')::integer,hours=(p_data->>'hours')::numeric,rating=(p_data->>'rating')::numeric,
   complaints=(p_data->>'complaints')::integer,requests_done=(p_data->>'requests_done')::integer,messages=(p_data->>'messages')::integer,source=p_data->>'source',source_file=coalesce(nullif(p_data->>'source_file','')::uuid,source_file),status=new_status,version=version+1,updated_by=actor,updated_at=now()
   where id=old.id returning * into row;
 else
  insert into public.chico_reports(staff_id,measured_at,report_type,ticket_mode,tickets,hours,rating,complaints,requests_done,messages,source,status,created_by,updated_by,rank_at_measurement,policy_version,target_snapshot,source_file)
  values(staff,t,kind,mode,(p_data->>'tickets')::integer,(p_data->>'hours')::numeric,(p_data->>'rating')::numeric,(p_data->>'complaints')::integer,(p_data->>'requests_done')::integer,(p_data->>'messages')::integer,p_data->>'source',new_status,actor,actor,public.chico_rank_at(staff,t),(public.chico_policy_at(t)).version,(public.chico_policy_at(t)).config->'goals'->public.chico_rank_at(staff,t),nullif(p_data->>'source_file','')::uuid) returning * into row;
 end if;
 perform public.chico_log('save_report',row.id::text,case when old.id is null then null else to_jsonb(old) end,to_jsonb(row));
 return jsonb_build_object('id',row.id,'version',row.version,'unchanged',false);
end $$;

alter table public.chico_requests add column policy_snapshot jsonb;
alter table public.chico_confirmations add column target_snapshot integer;
alter table public.chico_confirmations add column policy_version integer;


create or replace function public.chico_add_request(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare staff uuid:=(p_data->>'staff_id')::uuid;kind text:=p_data->>'type';a timestamptz:=(p_data->>'starts_at')::timestamptz;b timestamptz:=(p_data->>'ends_at')::timestamptz;n timestamptz:=(p_data->>'notice_at')::timestamptz;
month_value date:=date_trunc('month',a at time zone 'Asia/Riyadh')::date;units_value integer;balance jsonb;available integer;result uuid;
begin
 perform public.chico_actor();if not public.chico_manage() then raise exception using errcode='42501',message='تسجيل الطلبات يحتاج إدارة الفريق';end if;
 perform 1 from public.chico_members where id=staff for update;if not found then raise exception 'العضو غير موجود';end if;
 if exists(select 1 from public.chico_requests r where r.staff_id=staff and r.status in ('pending','approved') and tstzrange(r.starts_at,r.ends_at,'[)')&&tstzrange(a,b,'[)')) then raise exception 'الطلب يتداخل مع إجازة أو تبرير محجوز أو معتمد';end if;
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
 insert into public.chico_requests(staff_id,type,starts_at,ends_at,notice_at,units,month_start,reason,source,substitute_id,substitute_accepted,created_by,policy_snapshot)
 values(staff,kind,a,b,n,units_value,month_value,trim(p_data->>'reason'),trim(p_data->>'source'),nullif(p_data->>'substitute_id','')::uuid,coalesce((p_data->>'substitute_accepted')::boolean,false),auth.uid(),jsonb_build_object('version',(select version from public.chico_settings where id),'rank',(select rank from public.chico_members where id=staff),'balance',balance,'evaluated_for',(a at time zone 'Asia/Riyadh')::date)) returning id into result;
 perform public.chico_log('request_create',result::text,null,p_data);return jsonb_build_object('id',result);
end $$;

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
   select rank,display_name,joined_at into rank_value,name,joined from public.chico_members where id=staff;
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

create table public.chico_review_tasks (
 id uuid primary key default gen_random_uuid(),staff_id uuid not null references public.chico_members(id),
 kind text not null default 'three_reprimands',source_ids uuid[] not null,status text not null default 'open' check(status in ('open','resolved','withdrawn')),
 reason text,created_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid references auth.users(id));
create unique index chico_one_open_review on public.chico_review_tasks(staff_id,kind) where status='open';
alter table public.chico_review_tasks enable row level security;
revoke all on public.chico_review_tasks from public,anon,authenticated;
grant select on public.chico_review_tasks to authenticated;
create policy review_read on public.chico_review_tasks for select to authenticated using(public.chico_data_session() and (public.chico_manage() or staff_id=public.chico_staff_id()));
create or replace function public.chico_review_sync() returns trigger language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare ids uuid[];last_resolved timestamptz;
begin
 select max(resolved_at) into last_resolved from public.chico_review_tasks where staff_id=new.staff_id and status='resolved';
 select array_agg(id order by occurred_at,id) into ids from public.chico_discipline where staff_id=new.staff_id and kind='reprimand' and status='verified' and (last_resolved is null or created_at>last_resolved);
 if coalesce(array_length(ids,1),0)>=3 then
  insert into public.chico_review_tasks(staff_id,source_ids) values(new.staff_id,ids) on conflict(staff_id,kind) where status='open' do update set source_ids=excluded.source_ids;
 else update public.chico_review_tasks set status='withdrawn',reason='لم تعد الوقائع المثبتة تبلغ ثلاثة توبيخات',resolved_at=now() where staff_id=new.staff_id and status='open';end if;
 return new;
end $$;
revoke all on function public.chico_review_sync() from public,anon,authenticated;
create trigger chico_discipline_review after insert or update of status on public.chico_discipline for each row execute function public.chico_review_sync();


create or replace function public.chico_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();staff uuid;target uuid;item uuid;old jsonb;result jsonb;rank_value text;
row_record record;warnings uuid[];derived_id uuid;total integer;balance jsonb;budget integer;used integer;conf jsonb;
v_start timestamptz;v_end timestamptz;v_reason text:=trim(coalesce(p_data->>'reason',''));source_value text:=trim(coalesce(p_data->>'source',''));name text;v_kind text;period date;
begin
 perform pg_advisory_xact_lock(15001002);
 perform public.chico_actor();
 if p_action in ('account_status','account_reopen','rename_account','discipline_add','discipline_void','training_open','training_stage','review_resolve') and not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
 if p_data ? 'external_ref' or p_data ? 'user_agent' then raise exception 'معرفات الهوية الخارجية ومعلومات الجهاز غير مسموحة';end if;
 if octet_length(p_data::text)>200000 then raise exception 'حجم البيانات أكبر من المسموح';end if;
 case p_action
 when 'approve_account' then return public.chico_approve_account(p_data);
 when 'report' then return public.chico_save_report(p_data);
 when 'request_create' then return public.chico_add_request(p_data);
 when 'rename_account' then
  target=(p_data->>'user_id')::uuid;perform public.chico_assert_target(target);name=trim(p_data->>'display_name');
  select a.member_id,to_jsonb(m) into staff,old from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=target;
  if staff is null then raise exception 'اعتمد الحساب أولًا';end if;
  update public.chico_members set display_name=name,updated_at=now() where id=staff;
  perform public.chico_log(p_action,target::text,old,jsonb_build_object('display_name',name));return jsonb_build_object('id',staff);
 when 'account_status' then
  target=(p_data->>'user_id')::uuid;perform public.chico_assert_target(target);
  if target=actor then raise exception 'لا يمكنك تعطيل حسابك من إدارة الحسابات';end if;
  select to_jsonb(a) into old from public.chico_accounts a where user_id=target for update;
  if old is null then raise exception 'الحساب غير موجود';end if;
  if p_data->>'status' not in ('active','disabled') or old->>'status' in ('pending','rejected') then raise exception 'حالة غير مسموحة؛ راجع الحساب عبر شاشة الاعتماد';end if;
  update public.chico_accounts set status=p_data->>'status',updated_at=now() where user_id=target;
  if p_data->>'status'='disabled' then update chico_private.sessions set revoked_at=now() where user_id=target and revoked_at is null;end if;
  perform public.chico_log(p_action,target::text,old,jsonb_build_object('status',p_data->>'status'));return jsonb_build_object('id',target);
 when 'account_reopen' then
  target=(p_data->>'user_id')::uuid;perform public.chico_assert_target(target);
  if length(v_reason)<3 then raise exception 'سبب إعادة المراجعة مطلوب';end if;
  update public.chico_accounts set status='pending',reviewed_by=null,reviewed_at=null,updated_at=now() where user_id=target and status='rejected' returning to_jsonb(chico_accounts) into result;
  if result is null then raise exception 'يمكن إعادة فتح الحساب المرفوض فقط';end if;
  perform public.chico_log(p_action,target::text,jsonb_build_object('status','rejected'),result);return jsonb_build_object('id',target);
 when 'review_resolve' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_review_tasks where id=item and status='open' for update;
  if not found then raise exception 'المراجعة غير متاحة أو حُسمت بالفعل';end if;
  perform public.chico_assert_staff_manage(row_record.staff_id,true);
  if length(v_reason)<3 then raise exception 'وثّق نتيجة المراجعة';end if;
  update public.chico_review_tasks set status='resolved',reason=v_reason,resolved_at=now(),resolved_by=actor where id=item;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),jsonb_build_object('reason',v_reason));return jsonb_build_object('id',item);
 when 'member_edit' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);
  if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
  if (p_data->>'joined_at')::date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'تاريخ الانضمام لا يكون مستقبليًا';end if;
  select to_jsonb(m) into old from public.chico_members m where id=staff for update;
  update public.chico_members set display_name=trim(p_data->>'display_name'),joined_at=(p_data->>'joined_at')::date,updated_at=now() where id=staff;
  perform public.chico_log(p_action,staff::text,old,p_data);return jsonb_build_object('id',staff);
 when 'rank_member' then
  perform pg_advisory_xact_lock(15001002);
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);
  if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
  rank_value=p_data->>'rank';if not public.chico_is_owner() and rank_value in ('administrator','responsible') then raise exception using errcode='42501',message='تعيين القيادة يحتاج المالك';end if;
  if length(v_reason)<3 then raise exception 'أضف سبب تغيير الرتبة';end if;
  if public.chico_staff_id()=staff and not public.chico_is_owner() then raise exception using errcode='42501',message='لا يمكنك تغيير رتبتك';end if;
  if exists(select 1 from chico_private.recovery_tokens t join public.chico_accounts a on a.user_id=t.user_id where a.member_id=staff and t.consumed_at is null and t.claim_until>now()) then raise exception 'استعادة الوصول قيد التنفيذ؛ أعد محاولة تغيير الرتبة بعد قليل';end if;
  update chico_private.recovery_tokens set consumed_at=now() where user_id in(select user_id from public.chico_accounts where member_id=staff) and consumed_at is null;
  select to_jsonb(m) into old from public.chico_members m where id=staff for update;
  update public.chico_members set rank=rank_value,updated_at=now() where id=staff;
  insert into public.chico_rank_history(staff_id,old_rank,new_rank,changed_by,reason) values(staff,old->>'rank',rank_value,actor,v_reason);
  if rank_value not in ('administrator','responsible') then delete from public.chico_grants where user_id in(select user_id from public.chico_accounts where member_id=staff) and capability<>'owner';end if;
  perform public.chico_log(p_action,staff::text,old,jsonb_build_object('rank',rank_value,'reason',v_reason));return jsonb_build_object('id',staff);
 when 'grant' then
  perform pg_advisory_xact_lock(15001002);
  if not public.chico_is_owner() or not public.chico_recent_verification() then raise exception using errcode='42501',message='منح الصلاحيات يحتاج المالك وإعادة التحقق';end if;
  target=(p_data->>'user_id')::uuid;v_kind=p_data->>'capability';
  if v_kind not in ('approve_accounts','manage_imports','manage_settings') then raise exception 'الصلاحية غير مسموحة بهذا المسار';end if;
  if not exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=target and a.status='active' and m.rank in ('administrator','responsible')) then raise exception 'هذه الصلاحية تحتاج حسابًا قياديًا معتمدًا';end if;
  if coalesce((p_data->>'enabled')::boolean,false) then insert into public.chico_grants(user_id,capability,granted_by) values(target,v_kind,actor) on conflict do nothing;
  else delete from public.chico_grants where user_id=target and capability=v_kind;end if;
  perform public.chico_log(p_action,target::text,null,jsonb_build_object('capability',v_kind,'enabled',p_data->'enabled'));return jsonb_build_object('id',target);
 when 'transfer_owner' then
  perform pg_advisory_xact_lock(15001001);
  if not public.chico_is_owner() or not public.chico_recent_verification() or p_data->>'confirmation' is distinct from 'TRANSFER OWNERSHIP' then raise exception using errcode='42501',message='نقل الملكية يحتاج المالك وتأكيدًا وإعادة التحقق';end if;
  target=(p_data->>'user_id')::uuid;
  if target=actor or not exists(select 1 from public.chico_accounts where user_id=target and status='active') then raise exception 'حدد حسابًا فعالًا آخر';end if;
  if exists(select 1 from chico_private.recovery_tokens where user_id in(target,actor) and consumed_at is null and claim_until>now()) then raise exception 'استعادة الوصول قيد التنفيذ؛ أعد محاولة النقل بعد قليل';end if;
  update chico_private.recovery_tokens set consumed_at=now() where user_id in(target,actor) and consumed_at is null;
  delete from public.chico_grants where user_id=actor and capability='owner';
  insert into public.chico_grants(user_id,capability,granted_by) values(target,'owner',actor);
  perform public.chico_log(p_action,target::text,jsonb_build_object('previous_owner',actor),jsonb_build_object('new_owner',target));return jsonb_build_object('id',target);
 when 'member_create' then
  if not public.chico_manage() then raise exception using errcode='42501',message='إضافة الأعضاء تحتاج إدارة الفريق';end if;
  rank_value=p_data->>'rank';if not public.chico_is_owner() and rank_value in ('administrator','responsible') then raise exception using errcode='42501',message='تعيين القيادة يحتاج المالك';end if;
  if (p_data->>'joined_at')::date>(now() at time zone 'Asia/Riyadh')::date then raise exception 'تاريخ الانضمام لا يكون مستقبليًا';end if;
  insert into public.chico_members(display_name,rank,joined_at) values(trim(p_data->>'display_name'),rank_value,(p_data->>'joined_at')::date) returning id into staff;
  perform public.chico_log(p_action,staff::text,null,p_data);return jsonb_build_object('id',staff);
 when 'flags_baseline' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);
  if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور لإتمام العملية';end if;
  v_start=(p_data->>'measured_at')::timestamptz;total=(p_data->>'total')::integer;
  if total not between 0 and 10000 or v_start>now()+interval '5 minutes' or length(source_value)<3 or length(v_reason)<3 then raise exception 'راجع الإجمالي والتاريخ والمصدر وسبب المراجعة';end if;
  perform 1 from public.chico_members where id=staff for update;
  if exists(select 1 from public.chico_members where id=staff and flags_reviewed_at>v_start) then raise exception 'الإجمالي أقدم من آخر مراجعة تراكمية؛ لا تضفه بأثر رجعي';end if;
  select coalesce(sum(amount),0) into used from public.chico_flags where staff_id=staff and status='verified' and occurred_at<=v_start;
  if total<used then raise exception 'الإجمالي أقل من الوقائع المثبتة؛ راجع الإلغاء الموثق أولًا';end if;
  if total-used>100 then raise exception 'فرق الفلاجات أكبر من 100؛ راجع وقائع المصدر';end if;
  if total>used then perform public.chico_command('flag_add',jsonb_build_object('staff_id',staff,'amount',total-used,'occurred_at',v_start,'reason',v_reason,'source','baseline:'||source_value));end if;
  update public.chico_members set flags_reviewed=true,flags_reviewed_at=v_start where id=staff;
  perform public.chico_log(p_action,staff::text,null,jsonb_build_object('total',total,'measured_at',v_start,'source',source_value,'difference',total-used));return jsonb_build_object('difference',total-used);
 when 'flag_add' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);
  if length(v_reason)<3 or length(source_value)<3 then raise exception 'حدد مصدر الفلاج وسببه';end if;
  if (p_data->>'occurred_at')::timestamptz>now()+interval '5 minutes' then raise exception 'وقت الواقعة لا يكون مستقبليًا';end if;
  insert into public.chico_flags(staff_id,occurred_at,amount,source,reason,created_by) values(staff,(p_data->>'occurred_at')::timestamptz,(p_data->>'amount')::integer,source_value,v_reason,actor) returning id into item;
  perform public.chico_log(p_action,item::text,null,p_data);return jsonb_build_object('id',item);
 when 'flag_void' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_flags where id=item for update;if not found then raise exception 'الفلاج غير موجود';end if;
  perform public.chico_assert_staff_manage(row_record.staff_id,true);if length(v_reason)<3 then raise exception 'أضف سبب إلغاء الفلاج';end if;
  update public.chico_flags set status='voided',void_reason=v_reason where id=item;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),jsonb_build_object('status','voided','reason',v_reason));return jsonb_build_object('id',item);
 when 'discipline_add' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);
  perform 1 from public.chico_members where id=staff for update;v_kind=p_data->>'kind';
  if length(v_reason)<3 or length(source_value)<3 then raise exception 'حدد مصدر القرار وسببه';end if;
  if (p_data->>'occurred_at')::timestamptz>now()+interval '5 minutes' then raise exception 'وقت الواقعة لا يكون مستقبليًا';end if;
  insert into public.chico_discipline(staff_id,kind,reason,source,occurred_at,created_by) values(staff,v_kind,v_reason,source_value,(p_data->>'occurred_at')::timestamptz,actor) returning id into item;
  if v_kind='warning' then
   select array_agg(id) into warnings from (select d.id from public.chico_discipline d where d.staff_id=staff and d.kind='warning' and status='verified' and consumed_by is null order by occurred_at,id limit 2 for update) w;
   if array_length(warnings,1)=2 then
    insert into public.chico_discipline(staff_id,kind,reason,source,occurred_at,derived_from,created_by) values(staff,'reprimand','تحويل تحذيرين موثقين','warning-conversion:'||item::text,now(),warnings,actor) returning id into derived_id;
    update public.chico_discipline set consumed_by=derived_id where id=any(warnings);
   end if;
  end if;
  if v_kind in ('dismissal','blacklist') then update public.chico_members set game_status='dismissed',updated_at=now() where id=staff;end if;
  perform public.chico_log(p_action,item::text,null,p_data);return jsonb_build_object('id',item,'derived_reprimand',derived_id);
 when 'discipline_void' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_discipline where id=item for update;if not found then raise exception 'الواقعة غير موجودة';end if;
  perform public.chico_assert_staff_manage(row_record.staff_id,true);if length(v_reason)<3 then raise exception 'أضف سبب الإلغاء';end if;
  if row_record.kind in ('dismissal','blacklist') then raise exception 'إلغاء الفصل يحتاج قرار عودة مستقلًا؛ لا يتغير الوضع بحذف الواقعة';end if;
  update public.chico_discipline set status='voided',void_reason=v_reason where id=item;
  if row_record.consumed_by is not null then
   update public.chico_discipline set status='voided',void_reason='إلغاء أحد التحذيرين: '||v_reason where id=row_record.consumed_by;
   update public.chico_discipline set consumed_by=null where consumed_by=row_record.consumed_by;
  end if;
  if row_record.kind='reprimand' then update public.chico_discipline set consumed_by=null where consumed_by=item;end if;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),jsonb_build_object('reason',v_reason));return jsonb_build_object('id',item);
 when 'training_open' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);
  if length(v_reason)<3 then raise exception 'أضف سبب الإيقاف للتدريب';end if;
  if exists(select 1 from public.chico_members where id=staff and game_status='dismissed') then raise exception 'العضو مفصول؛ العودة تحتاج قرار إعادة عضوية مستقلًا';end if;
  if exists(select 1 from public.chico_training where staff_id=staff and stage<>'returned') then raise exception 'يوجد مسار تدريب مفتوح لهذا العضو';end if;
  insert into public.chico_training(staff_id,stage,reason,created_by) values(staff,'waiting_training',v_reason,actor) returning id into item;
  update public.chico_members set game_status='training',updated_at=now() where id=staff;
  perform public.chico_log(p_action,item::text,null,p_data);return jsonb_build_object('id',item);
 when 'training_stage' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_training where id=item for update;if not found then raise exception 'حالة التدريب غير موجودة';end if;
  perform public.chico_assert_staff_manage(row_record.staff_id,true);v_kind=p_data->>'stage';
  if not ((row_record.stage='waiting_training' and v_kind='training') or (row_record.stage='training' and v_kind='awaiting_return') or (row_record.stage='awaiting_return' and v_kind='returned')) then raise exception 'انتقال غير صالح في مسار التدريب';end if;
  update public.chico_training set stage=v_kind,notes=coalesce(p_data->>'notes',''),training_completed_at=case when v_kind='awaiting_return' then now() else training_completed_at end,returned_at=case when v_kind='returned' then now() else returned_at end,updated_at=now() where id=item;
  if v_kind='returned' then update public.chico_members set game_status='active',updated_at=now() where id=row_record.staff_id;end if;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),jsonb_build_object('stage',v_kind,'notes',p_data->>'notes'));return jsonb_build_object('id',item);
 when 'shift_create' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff);
  v_start=(p_data->>'starts_at')::timestamptz;v_end=(p_data->>'ends_at')::timestamptz;
  perform 1 from public.chico_members where id=staff for update;
  if exists(select 1 from public.chico_shifts where (staff_id=staff or substitute_id=staff) and tstzrange(starts_at,ends_at,'[)')&&tstzrange(v_start,v_end,'[)')) then raise exception 'المناوبة تتداخل مع مناوبة أخرى';end if;
  insert into public.chico_shifts(staff_id,starts_at,ends_at,coverage,notes,created_by) values(staff,v_start,v_end,coalesce(p_data->>'coverage','assigned'),coalesce(p_data->>'notes',''),actor) returning id into item;
  perform public.chico_log(p_action,item::text,null,p_data);return jsonb_build_object('id',item);
 when 'shift_cover' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_shifts where id=item for update;if not found then raise exception 'المناوبة غير موجودة';end if;
  perform public.chico_assert_staff_manage(row_record.staff_id);staff=(p_data->>'substitute_id')::uuid;
  if staff=row_record.staff_id or not coalesce((p_data->>'accepted')::boolean,false) then raise exception 'يلزم بديل آخر وقبول التغطية';end if;
  perform 1 from public.chico_members where id=staff for update;
  if exists(select 1 from public.chico_shifts where id<>item and (staff_id=staff or substitute_id=staff) and tstzrange(starts_at,ends_at,'[)')&&tstzrange(row_record.starts_at,row_record.ends_at,'[)')) then raise exception 'البديل مرتبط بمناوبة متداخلة';end if;
  update public.chico_shifts set substitute_id=staff,coverage='covered' where id=item;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),p_data);return jsonb_build_object('id',item);
 when 'request_decide' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_requests where id=item for update;if not found then raise exception 'الطلب غير موجود';end if;
  perform public.chico_assert_staff_manage(row_record.staff_id);perform 1 from public.chico_members where id=row_record.staff_id for update;
  v_kind=p_data->>'decision';if v_kind not in ('approved','rejected') then raise exception 'قرار غير صالح';end if;
  if row_record.status<>'pending' then raise exception 'تم اتخاذ قرار بشأن الطلب بالفعل';end if;
  if v_kind='approved' and row_record.type='excuse' and not (row_record.substitute_accepted or coalesce((p_data->>'substitute_accepted')::boolean,false)) then raise exception 'قبول البديل للتغطية مطلوب قبل اعتماد التبرير';end if;
  if v_kind='rejected' and length(v_reason)<3 then raise exception 'أضف سبب رفض الطلب';end if;
  update public.chico_requests set status=v_kind,decision_reason=v_reason,decided_by=actor,decided_at=now(),substitute_accepted=substitute_accepted or coalesce((p_data->>'substitute_accepted')::boolean,false) where id=item;
  insert into public.chico_notifications(user_id,title,body) select user_id,'تحديث حالة طلبك',case when v_kind='approved' then 'تم اعتماد الطلب.' else 'تم رفض الطلب. راجع السبب في السجل.' end from public.chico_accounts where member_id=row_record.staff_id;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),jsonb_build_object('status',v_kind,'reason',v_reason));return jsonb_build_object('id',item);
 when 'meeting_create' then
  if not public.chico_manage() then raise exception using errcode='42501',message='إدارة الاجتماعات غير مسموحة';end if;
  v_start=(p_data->>'starts_at')::timestamptz;
  if extract(isodow from v_start at time zone 'Asia/Riyadh')<>1 or (v_start at time zone 'Asia/Riyadh')::time<>time '22:00' then raise exception 'الاجتماع الأسبوعي الاثنين 22:00 بتوقيت السعودية';end if;
  insert into public.chico_meetings(starts_at,title,channel_url,created_by) values(v_start,coalesce(nullif(trim(p_data->>'title'),''),'اجتماع الفريق الأسبوعي'),coalesce(p_data->>'channel_url',''),actor) returning id into item;
  perform public.chico_log(p_action,item::text,null,p_data);return jsonb_build_object('id',item);
 when 'attendance' then
  staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff);item=(p_data->>'meeting_id')::uuid;
  select * into row_record from public.chico_meetings where id=item;
  if not found or row_record.starts_at>now() then raise exception 'يسجل الحضور بعد بدء الاجتماع';end if;
  if p_data->>'status'='excused' and length(trim(coalesce(p_data->>'note','')))<3 then raise exception 'أضف التبرير المقبول';end if;
  insert into public.chico_attendance(meeting_id,staff_id,status,note,recorded_by) values(item,staff,p_data->>'status',coalesce(p_data->>'note',''),actor)
  on conflict(meeting_id,staff_id) do update set status=excluded.status,note=excluded.note,recorded_by=actor,updated_at=now();
  perform public.chico_log(p_action,item::text||':'||staff::text,null,p_data);return jsonb_build_object('id',item);
 when 'confirm_requests' then
  staff=public.chico_staff_id();period=(p_data->>'period_start')::date;
  if period<>public.chico_week(now()) then raise exception 'الفترة السابقة للقراءة فقط';end if;
  if not exists(select 1 from public.chico_members where id=staff and rank='moderator') then raise exception 'الإقرار يخص هدف Moderator';end if;
  insert into public.chico_confirmations(staff_id,period_start,confirmed,updated_by,target_snapshot,policy_version) values(staff,period,coalesce((p_data->>'confirmed')::boolean,false),actor,(select (config->'goals'->'moderator'->>'requests')::integer from public.chico_settings where id),(select version from public.chico_settings where id))
  on conflict(staff_id,period_start) do update set confirmed=excluded.confirmed,target_snapshot=excluded.target_snapshot,policy_version=excluded.policy_version,updated_by=actor,updated_at=now();
  perform public.chico_log(p_action,staff::text||':'||period::text,null,jsonb_build_object('confirmed',p_data->'confirmed','verification','self-declaration'));return jsonb_build_object('id',staff);
 when 'notification_read' then
  update public.chico_notifications set read_at=now() where id=(p_data->>'id')::uuid and user_id=actor;return jsonb_build_object('ok',true);
 when 'session_revoke' then
  item=(p_data->>'id')::uuid;update chico_private.sessions set revoked_at=now() where id=item and user_id=actor;perform public.chico_log(p_action,item::text);return jsonb_build_object('ok',true);
 when 'settings' then
  if not public.chico_cap('manage_settings') or not public.chico_recent_verification() then raise exception using errcode='42501',message='تغيير الإعدادات يحتاج الصلاحية وإعادة التحقق';end if;
  select config into old from public.chico_settings where id for update;conf=p_data->'config';
  if conf is null or jsonb_typeof(conf)<>'object' then raise exception 'الإعدادات غير صالحة';end if;
  for rank_value in select unnest(array['helper','senior_helper','moderator','administrator','responsible']) loop
   if conf->'leave'->rank_value is null or conf->'excuses'->rank_value is null or jsonb_typeof(conf->'leave'->rank_value) not in ('number','null') or jsonb_typeof(conf->'excuses'->rank_value) not in ('number','null') then raise exception 'حدد سياسة الرصيد لكل رتبة';end if;
   if (conf->'leave'->>rank_value)::integer not between 0 and 31 or (conf->'excuses'->>rank_value)::integer not between 0 and 31 then raise exception 'الرصيد بين صفر و31';end if;
  end loop;
  for rank_value in select unnest(array['helper','senior_helper','moderator']) loop
   if jsonb_typeof(conf->'goals'->rank_value)<>'object' or (conf->'goals'->rank_value->>'tickets')::integer not between 1 and 100000 or (conf->'goals'->rank_value->>'hours')::numeric not between 1 and 168 or (conf->'goals'->rank_value->>'rating')::numeric not between 0 and 5 or conf->'goals'->rank_value->>'tickets' is null or conf->'goals'->rank_value->>'hours' is null or conf->'goals'->rank_value->>'rating' is null then raise exception 'أهداف أداء غير صالحة';end if;
   for name in select unnest(array['complaints','requests','messages']) loop
    if conf->'goals'->rank_value->name is null or jsonb_typeof(conf->'goals'->rank_value->name) not in ('number','null') or (conf->'goals'->rank_value->>name)::integer not between 0 and 100000 then raise exception 'مهمة الرتبة غير صالحة';end if;
   end loop;
  end loop;
  if length(coalesce(conf->>'meeting_channel',''))>500 or length(coalesce(conf->>'leave_channel',''))>500 or length(coalesce(conf->>'excuse_channel',''))>500 then raise exception 'رابط القناة طويل جدًا';end if;
  update public.chico_settings set config=conf,version=version+1,updated_by=actor,updated_at=now() where id;
  insert into public.chico_policy_versions(version,config,changed_by) select version,config,actor from public.chico_settings where id;
  perform public.chico_log(p_action,'settings',old,conf);return jsonb_build_object('ok',true);
 else raise exception using errcode='22023',message='العملية غير معروفة';
 end case;
end $$;

create or replace function public.chico_recovery_issue(p_user uuid,p_hash text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform pg_advisory_xact_lock(15001002);
 perform public.chico_assert_target(p_user);
 if exists(select 1 from chico_private.recovery_tokens where user_id=p_user and consumed_at is null and claim_until>now()) then raise exception 'استعادة الوصول قيد التنفيذ؛ انتظر انتهاء المحاولة قبل إصدار رمز آخر';end if;
 update chico_private.recovery_tokens set consumed_at=now() where user_id=p_user and consumed_at is null;
 insert into chico_private.recovery_tokens(user_id,token_hash,issued_by,expires_at) values(p_user,p_hash,auth.uid(),now()+interval '15 minutes');
 perform public.chico_log('recovery_issued',p_user::text);
end $$;

create or replace function public.chico_service_recovery_claim(p_hash text,p_claim uuid) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare result uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 update chico_private.recovery_tokens set claim_id=p_claim,claim_until=now()+interval '2 minutes'
 where token_hash=p_hash and consumed_at is null and expires_at>now() and (claim_until is null or claim_until<now()) returning user_id into result;
 if result is null then return null;end if;
 update chico_private.sessions set revoked_at=now() where user_id=result and revoked_at is null;return jsonb_build_object('user_id',result);
end $$;

create or replace function public.chico_service_recovery_finish(p_hash text,p_claim uuid) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid;
begin
 perform pg_advisory_xact_lock(15001002);
 if exists(select 1 from chico_private.recovery_tokens where token_hash=p_hash and claim_id=p_claim and consumed_at is not null) then return;end if;
 update chico_private.recovery_tokens set consumed_at=now() where token_hash=p_hash and claim_id=p_claim and consumed_at is null returning user_id into u;
 if u is null then raise exception 'رمز الاستعادة غير صالح';end if;
 update chico_private.sessions set revoked_at=now() where user_id=u and revoked_at is null;
 update public.chico_accounts set must_change_password=false where user_id=u;
end $$;

create or replace function public.chico_service_session_create(p_user uuid,p_auth_session uuid,p_hash text,p_cipher text,p_access_expires timestamptz,p_remember boolean,p_agent text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 if exists(select 1 from chico_private.recovery_tokens where user_id=p_user and consumed_at is null and claim_until>now()) then raise exception 'استعادة الوصول قيد التنفيذ؛ أعد تسجيل الدخول بعد قليل';end if;
 if not exists(select 1 from public.chico_accounts where user_id=p_user and status<>'disabled') then raise exception using errcode='42501',message='الحساب غير متاح'; end if;
 insert into chico_private.sessions(user_id,auth_session_id,token_hash,tokens_cipher,access_expires_at,expires_at,idle_seconds,remembered,user_agent)
 values(p_user,p_auth_session,p_hash,p_cipher,p_access_expires,now()+case when p_remember then interval '30 days' else interval '12 hours' end,case when p_remember then 604800 else 3600 end,p_remember,'');
end $$;

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
    if staff is null then
     if exists(select 1 from public.chico_members where lower(display_name)=lower(item->>'display_name')) then raise exception 'اسم موجود دون معرف؛ راجع الربط قبل إنشاء عضو جديد';end if;
     result=public.chico_command('member_create',item);changed=changed+1;
    else
     perform public.chico_assert_staff_manage(staff,true);select * into old_member from public.chico_members where id=staff for update;
     if old_member.display_name=item->>'display_name' and old_member.rank=item->>'rank' and old_member.joined_at=(item->>'joined_at')::date then unchanged=unchanged+1;
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

create or replace function public.chico_dashboard(p_period date default public.chico_week(now())) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor();staff uuid:=public.chico_staff_id();lead boolean:=public.chico_manage();publish boolean:=public.chico_publish();approval boolean:=public.chico_cap('approve_accounts');data jsonb;
begin
 if extract(isodow from p_period)<>1 then raise exception 'الفترة يجب أن تبدأ يوم الاثنين';end if;
 data=jsonb_build_object('account',public.chico_me(),'period',p_period,
 'members',coalesce((select jsonb_agg(case when lead or m.id=staff then to_jsonb(m)-'external_ref' else jsonb_build_object('id',m.id,'display_name',m.display_name,'rank',m.rank,'game_status',m.game_status) end order by m.display_name) from public.chico_members m where lead or publish or m.id=staff),'[]'::jsonb),
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
 'audit',case when lead then coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('actor_name',(select m.display_name from public.chico_accounts c join public.chico_members m on m.id=c.member_id where c.user_id=a.actor),'target_name',coalesce((select display_name from public.chico_members where id::text=a.target_id),(select m.display_name from public.chico_accounts c join public.chico_members m on m.id=c.member_id where c.user_id::text=a.target_id)))) from (select * from public.chico_audit order by created_at desc limit 100) a),'[]'::jsonb) else '[]'::jsonb end,
 'review_tasks',coalesce((select jsonb_agg(to_jsonb(t) order by created_at) from public.chico_review_tasks t where (lead or t.staff_id=staff) and t.status='open'),'[]'::jsonb),
 'fetched_at',now(),'balances',public.chico_balance(staff),
 'settings',(select config from public.chico_settings where id),
 'grants',case when public.chico_is_owner() then coalesce((select jsonb_agg(to_jsonb(g)) from public.chico_grants g),'[]'::jsonb) else '[]'::jsonb end,
 'confirmations',coalesce((select jsonb_agg(to_jsonb(c)) from public.chico_confirmations c where c.period_start=p_period and (lead or c.staff_id=staff)),'[]'::jsonb),
 'import_jobs',case when public.chico_cap('manage_imports') or public.chico_is_owner() then coalesce((select jsonb_agg(to_jsonb(j)) from public.chico_import_jobs j),'[]'::jsonb) else '[]'::jsonb end);
 return data;
end $$;

create or replace function public.chico_file_reuse(p_hash text) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=public.chico_actor();result jsonb;
begin
 if not (public.chico_publish() or public.chico_cap('manage_imports')) then raise exception using errcode='42501',message='رفع الملفات غير مسموح';end if;
 select jsonb_build_object('id',id,'path',path) into result from public.chico_files where created_by=u and content_hash=p_hash order by created_at limit 1;return result;
end $$;
revoke all on function public.chico_file_reuse(text) from public,anon;
grant execute on function public.chico_file_reuse(text) to authenticated;
commit;
