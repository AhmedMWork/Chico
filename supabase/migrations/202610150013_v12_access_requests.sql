begin;
-- v1.2: full administration belongs to the Owner and Responsible only.
create or replace function public.chico_manage() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select public.chico_valid_session() and exists(select 1 from public.chico_accounts a join public.chico_members m on m.id=a.member_id where a.user_id=auth.uid() and a.status='active' and (m.rank='responsible' or public.chico_is_owner()));
$$;
create or replace function public.chico_cap(p_name text) returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select case when p_name='owner' then public.chico_is_owner() else p_name in ('approve_accounts','manage_imports','manage_settings','manage_points') and public.chico_manage() end;
$$;
create or replace function public.chico_assert_target(p_user uuid) returns void language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform public.chico_actor();if not public.chico_manage() then raise exception using errcode='42501',message='الإدارة لصاحب الموقع وResponsible';end if;
 if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور';end if;
 if not public.chico_is_owner() and exists(select 1 from public.chico_grants where user_id=p_user and capability='owner') then raise exception using errcode='42501',message='حساب صاحب الموقع محمي';end if;
end $$;
create or replace function public.chico_assert_staff_manage(p_staff uuid,p_sensitive boolean default false) returns void language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform public.chico_actor();if not public.chico_manage() then raise exception using errcode='42501',message='الإدارة لصاحب الموقع وResponsible';end if;
 if not exists(select 1 from public.chico_members where id=p_staff) then raise exception 'العضو غير موجود';end if;
 if p_sensitive and not public.chico_is_owner() and exists(select 1 from public.chico_accounts a join public.chico_grants g using(user_id) where a.member_id=p_staff and g.capability='owner') then raise exception using errcode='42501',message='حساب صاحب الموقع محمي';end if;
end $$;
drop policy reports_read on public.chico_reports;
create policy reports_read on public.chico_reports for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
-- Uploaded team evidence is available to management only, including when the uploader changes rank.
drop policy files_read on public.chico_files;
create policy files_read on public.chico_files for select to authenticated using(public.chico_data_session() and public.chico_manage());
drop policy chico_storage_read on storage.objects;
create policy chico_storage_read on storage.objects for select to authenticated using(bucket_id='chico-files' and public.chico_data_session() and public.chico_manage() and exists(select 1 from public.chico_files f where f.path=name and f.lifecycle='active'));
create or replace function public.chico_file_path(p_id uuid) returns text language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare result text;
begin
 perform public.chico_actor();if not public.chico_manage() then raise exception using errcode='42501',message='الملفات الأصلية للإدارة فقط';end if;
 select path into result from public.chico_files where id=p_id and lifecycle='active';if result is null then raise exception 'الملف غير متاح';end if;return result;
end $$;
alter table public.chico_members add column avatar_path text;
alter table public.chico_members add column avatar_updated_at timestamptz;
alter table public.chico_requests add column discord_url text;
alter table public.chico_requests add column decision_policy_snapshot jsonb;
alter table public.chico_requests drop constraint chico_requests_status_check;
alter table public.chico_requests add constraint chico_requests_status_check check(status in ('pending','approved','rejected','cancelled'));
alter table public.chico_requests add constraint chico_discord_message_url check(discord_url is null or discord_url ~ '^https://(discord\.com|discordapp\.com)/channels/[0-9]{5,22}/[0-9]{5,22}/[0-9]{5,22}$');


create or replace function public.chico_balance(p_staff uuid,p_month date default date_trunc('month',now() at time zone 'Asia/Riyadh')::date,p_at date default (now() at time zone 'Asia/Riyadh')::date) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare m public.chico_members;conf jsonb;leave_quota integer;excuse_quota integer;used_leave integer;held_leave integer;base_leave_quota integer;probation_used integer;used_excuse integer;held_excuse integer;
begin
 select * into m from public.chico_members where id=p_staff;if not found then return '{}'::jsonb;end if;
 select config into conf from public.chico_settings where id;
 leave_quota=(conf->'leave'->>m.rank)::integer;base_leave_quota=leave_quota;excuse_quota=(conf->'excuses'->>m.rank)::integer;
 if leave_quota is not null and p_at<m.joined_at+14 then leave_quota=0;
 elsif leave_quota is not null and p_at<m.joined_at+30 then leave_quota=least(1,leave_quota);end if;
 select coalesce(sum(units) filter(where type='leave' and status='approved'),0),coalesce(sum(units) filter(where type='leave' and status='pending'),0),
 coalesce(sum(units) filter(where type='excuse' and status='approved'),0),coalesce(sum(units) filter(where type='excuse' and status='pending'),0)
 into used_leave,held_leave,used_excuse,held_excuse from public.chico_requests where staff_id=p_staff and month_start=date_trunc('month',p_month)::date;
 select coalesce(sum(units),0) into probation_used from public.chico_requests where staff_id=p_staff and month_start=date_trunc('month',p_month)::date and type='leave' and status='approved' and (starts_at at time zone 'Asia/Riyadh')::date<m.joined_at+30;
 return jsonb_build_object('month',date_trunc('month',p_month)::date,'leave_quota',leave_quota,'leave_used',used_leave,'leave_held',held_leave,'leave_available',case when leave_quota is null then null else greatest(0,least(base_leave_quota-used_leave,case when p_at<m.joined_at+30 then leave_quota-probation_used else base_leave_quota-used_leave end)) end,
 'excuse_quota',excuse_quota,'excuse_used',used_excuse,'excuse_held',held_excuse,'excuse_available',case when excuse_quota is null then null else greatest(0,excuse_quota-used_excuse) end);
end $$;

create or replace function public.chico_add_request(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare staff uuid:=(p_data->>'staff_id')::uuid;kind text:=p_data->>'type';a timestamptz:=(p_data->>'starts_at')::timestamptz;b timestamptz:=(p_data->>'ends_at')::timestamptz;n timestamptz:=(p_data->>'notice_at')::timestamptz;
month_value date:=date_trunc('month',a at time zone 'Asia/Riyadh')::date;units_value integer;balance jsonb;available integer;result uuid;
begin
 perform public.chico_actor();perform pg_advisory_xact_lock(15001002);
 if not public.chico_manage() and staff<>public.chico_staff_id() then raise exception using errcode='42501',message='تقدر ترسل طلبك فقط';end if;
 if coalesce(p_data->>'discord_url','') !~ '^https://(discord\.com|discordapp\.com)/channels/[0-9]{5,22}/[0-9]{5,22}/[0-9]{5,22}$' then raise exception 'أرفق رابط رسالة Discord';end if;
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
 if units_value>available then raise exception 'الرصيد ما يكفي للطلب';end if;
 insert into public.chico_requests(staff_id,type,starts_at,ends_at,notice_at,units,month_start,reason,source,substitute_id,substitute_accepted,created_by,policy_snapshot,discord_url)
 values(staff,kind,a,b,n,units_value,month_value,trim(p_data->>'reason'),trim(p_data->>'source'),nullif(p_data->>'substitute_id','')::uuid,coalesce((p_data->>'substitute_accepted')::boolean,false),auth.uid(),jsonb_build_object('version',(select version from public.chico_settings where id),'rank',(select rank from public.chico_members where id=staff),'balance',balance,'evaluated_for',(a at time zone 'Asia/Riyadh')::date),p_data->>'discord_url') returning id into result;
 perform public.chico_log('request_create',result::text,null,p_data);return jsonb_build_object('id',result);
end $$;

create or replace function public.chico_save_report(p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();staff uuid:=(p_data->>'staff_id')::uuid;t timestamptz:=(p_data->>'measured_at')::timestamptz;kind text:=p_data->>'report_type';mode text:=coalesce(p_data->>'ticket_mode','week_to_date');
 w date:=public.chico_week(t);old public.chico_reports;row public.chico_reports;new_status text:=case when coalesce((p_data->>'publish')::boolean,true) then 'published' else 'draft' end;reason text:=coalesce(p_data->>'correction_reason','');
begin
 perform pg_advisory_xact_lock(15001002);
 if not public.chico_manage() and staff<>public.chico_staff_id() then raise exception using errcode='42501',message='إحصائياتك فقط';end if;
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
  if not public.chico_manage() and rank_value in ('administrator','responsible') then raise exception using errcode='42501',message='تعيين القيادة يحتاج المالك';end if;
  if joined>(now() at time zone 'Asia/Riyadh')::date then raise exception 'تاريخ الانضمام لا يكون مستقبليًا';end if;
  staff=nullif(p_data->>'staff_id','')::uuid;
  if staff is null then insert into public.chico_members(display_name,rank,joined_at) values(name,rank_value,joined) returning id into staff;
  else
   perform 1 from public.chico_members where id=staff for update;if not found then raise exception 'عضو الفريق غير موجود';end if;
   if exists(select 1 from public.chico_accounts where member_id=staff and user_id<>u) then raise exception 'عضو الفريق مرتبط بحساب آخر';end if;
   if not public.chico_is_owner() and exists(select 1 from public.chico_accounts a join public.chico_grants g using(user_id) where a.member_id=staff and g.capability='owner') then raise exception using errcode='42501',message='العضو خارج نطاقك';end if;
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

create or replace function public.chico_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();staff uuid;target uuid;item uuid;old jsonb;result jsonb;rank_value text;
row_record record;warnings uuid[];derived_id uuid;total integer;balance jsonb;budget integer;used integer;conf jsonb;v_target integer;v_policy integer;
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
 when 'self_username' then
  if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور';end if;
  name=lower(trim(p_data->>'username'));
  if name !~ '^[a-z0-9][a-z0-9._-]{2,31}$' or name in ('admin','administrator','owner','root','support','system','chico') then raise exception 'اسم المستخدم غير مناسب';end if;
  select username into source_value from chico_private.login_identifiers where user_id=actor for update;
  update chico_private.login_identifiers set username=name,username_normalized=name where user_id=actor;
  perform public.chico_log(p_action,actor::text,jsonb_build_object('username',source_value),jsonb_build_object('username',name));return jsonb_build_object('username',name);
 when 'request_cancel' then
  item=(p_data->>'id')::uuid;select * into row_record from public.chico_requests where id=item for update;
  if not found or row_record.status<>'pending' then raise exception 'تقدر تلغي الطلب المعلق فقط';end if;
  if not public.chico_manage() and row_record.staff_id<>public.chico_staff_id() then raise exception using errcode='42501',message='هذا الطلب مو لك';end if;
  update public.chico_requests set status='cancelled',decision_reason='ألغاه صاحب الطلب',decided_at=now(),decided_by=actor where id=item;
  perform public.chico_log(p_action,item::text,to_jsonb(row_record),jsonb_build_object('status','cancelled'));return jsonb_build_object('id',item);
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
  rank_value=p_data->>'rank';if not public.chico_manage() and rank_value in ('administrator','responsible') then raise exception using errcode='42501',message='تعيين القيادة يحتاج المالك';end if;
  if length(v_reason)<3 then raise exception 'أضف سبب تغيير الرتبة';end if;
  if public.chico_staff_id()=staff and not public.chico_is_owner() then raise exception using errcode='42501',message='لا يمكنك تغيير رتبتك';end if;
  if exists(select 1 from chico_private.recovery_tokens t join public.chico_accounts a on a.user_id=t.user_id where a.member_id=staff and t.consumed_at is null and t.claim_id is not null) then raise exception 'استعادة الوصول قيد التنفيذ؛ أعد محاولة تغيير الرتبة بعد قليل';end if;
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
  if exists(select 1 from chico_private.recovery_tokens where user_id in(target,actor) and consumed_at is null and claim_id is not null) then raise exception 'استعادة الوصول قيد التنفيذ؛ أعد محاولة النقل بعد قليل';end if;
  update chico_private.recovery_tokens set consumed_at=now() where user_id in(target,actor) and consumed_at is null;
  delete from public.chico_grants where user_id=actor and capability='owner';
  insert into public.chico_grants(user_id,capability,granted_by) values(target,'owner',actor);
  perform public.chico_log(p_action,target::text,jsonb_build_object('previous_owner',actor),jsonb_build_object('new_owner',target));return jsonb_build_object('id',target);
 when 'member_create' then
  if not public.chico_manage() then raise exception using errcode='42501',message='إضافة الأعضاء تحتاج إدارة الفريق';end if;
  rank_value=p_data->>'rank';if not public.chico_manage() and rank_value in ('administrator','responsible') then raise exception using errcode='42501',message='تعيين القيادة يحتاج المالك';end if;
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
  if v_kind='approved' then
   balance=public.chico_balance(row_record.staff_id,row_record.month_start,(row_record.starts_at at time zone 'Asia/Riyadh')::date);
   budget=(balance->>case when row_record.type='leave' then 'leave_available' else 'excuse_available' end)::integer;
   if budget is null or row_record.units>budget then raise exception 'الرصيد ما يكفي للموافقة';end if;
  end if;
  update public.chico_requests set status=v_kind,decision_reason=v_reason,decision_policy_snapshot=case when v_kind='approved' then jsonb_build_object('version',(select version from public.chico_settings where id),'balance',balance) else decision_policy_snapshot end,decided_by=actor,decided_at=now(),substitute_accepted=substitute_accepted or coalesce((p_data->>'substitute_accepted')::boolean,false) where id=item;
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
  select (r.target_snapshot->>'requests')::integer,r.policy_version into v_target,v_policy from public.chico_reports r where r.staff_id=staff and r.period_start=period and r.status='published' order by (r.report_type='weekly') desc,r.measured_at desc limit 1;
  if v_policy is null then select (config->'goals'->'moderator'->>'requests')::integer,version into v_target,v_policy from public.chico_settings where id;end if;
  if v_target is null or (p_data->>'expected_target')::integer is distinct from v_target then raise exception 'تغير هدف الطلبات؛ حدّث العرض وراجع الإقرار قبل الحفظ';end if;
  insert into public.chico_confirmations(staff_id,period_start,confirmed,updated_by,target_snapshot,policy_version) values(staff,period,coalesce((p_data->>'confirmed')::boolean,false),actor,v_target,v_policy)
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

commit;