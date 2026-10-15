begin;
alter table public.chico_notifications add column audience text not null default 'self' check(audience in ('self','management'));
alter table public.chico_notifications add column kind text not null default 'info' check(kind in ('info','success','warning','danger'));
alter table public.chico_notifications add column event_key text;
create unique index chico_notification_event_unique on chico_notifications(user_id,event_key,audience) where event_key is not null;
create index chico_notification_feed_index on chico_notifications(user_id,created_at desc,id desc);
update chico_notifications set audience='management' where title='حساب جديد بانتظار الاعتماد';
drop policy notifications_read on chico_notifications;
create policy notifications_read on chico_notifications for select to authenticated using(chico_valid_session() and user_id=auth.uid() and (audience='self' or chico_manage()));
create or replace function public.chico_service_register(p_user uuid,p_username text,p_alias text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 if public.chico_normalize_username(p_username)='owner chico' then raise exception 'اسم المستخدم غير متاح';end if;
 insert into chico_accounts(user_id) values(p_user);
 insert into chico_private.login_identifiers(user_id,username,username_normalized,auth_alias) values(p_user,trim(regexp_replace(p_username,' +',' ','g')),public.chico_normalize_username(p_username),p_alias);
 insert into chico_notifications(user_id,title,body,link,audience,kind,event_key)
 select a.user_id,'حساب جديد بانتظار الموافقة','راجع الحساب من إدارة الحسابات.','/app?view=accounts','management','warning','registration:'||p_user
 from chico_accounts a join chico_members m on m.id=a.member_id where a.status='active' and (m.rank='responsible' or exists(select 1 from chico_grants g where g.user_id=a.user_id and g.capability='owner'));
end $$;
create or replace function public.chico_notification_feed(p_before timestamptz default null,p_before_id uuid default null) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare u uuid:=chico_actor(false);lead boolean:=chico_manage();
begin
 if (p_before is null)<>(p_before_id is null) then raise exception 'راجع صفحة التنبيهات';end if;
 return jsonb_build_object('can_manage',lead,'rows',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc) from(select * from chico_notifications where user_id=u and (audience='self' or lead) and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 50)n),'[]'::jsonb),'unread_count',(select count(*) from chico_notifications where user_id=u and read_at is null and (audience='self' or lead)));
end $$;
revoke all on function public.chico_notification_feed(timestamptz,uuid) from public,anon;
grant execute on function public.chico_notification_feed(timestamptz,uuid) to authenticated;
create or replace function public.chico_event_notifications() returns trigger language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare staff uuid;subject uuid;label text;section text:='history';tone text:='info';broadcast boolean:=false;management boolean:=true;value text;key text:='audit:'||new.id;
begin
 label=case new.action
 when 'save_report' then 'تحديث الإحصائيات' when 'request_create' then 'طلب جديد' when 'request_cancel' then 'تم إلغاء طلب' when 'request_decide' then 'تم الرد على الطلب'
 when 'points_adjust' then 'تعديل النقاط' when 'points_void' then 'إلغاء تعديل نقاط' when 'points_policy' then 'تحديث نظام النقاط'
 when 'rank_member' then 'تغيير الرتبة' when 'rename_account' then 'تغيير اسم الإداري' when 'member_edit' then 'تحديث ملف الإداري' when 'member_create' then 'انضمام إداري للفريق'
 when 'flag_add' then 'فلاج جديد' when 'flags_baseline' then 'تحديث الفلاجات' when 'flag_void' then 'إلغاء فلاج' when 'discipline_add' then 'قرار جديد في السجل' when 'discipline_void' then 'إلغاء قرار في السجل'
 when 'training_open' then 'تحديث التدريب' when 'training_stage' then 'تحديث التدريب' when 'review_resolve' then 'نتيجة مراجعة'
 when 'shift_create' then 'مناوبة جديدة' when 'shift_cover' then 'تحديث تغطية مناوبة' when 'meeting_create' then 'اجتماع جديد' when 'attendance' then 'تحديث حضور الاجتماع'
 when 'settings' then 'تحديث إعدادات الفريق' when 'import_applied' then 'تحديث بيانات الفريق' when 'account_status' then 'تحديث حالة الحساب' when 'account_reopen' then 'الحساب بانتظار المراجعة'
 when 'approve_account' then 'قرار اعتماد حساب' when 'transfer_owner' then 'نقل ملكية الموقع' when 'self_username' then 'تم تغيير اسم المستخدم' when 'avatar_change' then 'تم تغيير الصورة' when 'recovery_issued' then 'تم إصدار رمز استعادة لحسابك' when 'session_revoke' then 'تم إنهاء جلسة دخول' else null end;
 if label is null then return new;end if;
 if new.action in ('recovery_issued','session_revoke') then
  if new.action='recovery_issued' then select user_id into subject from chico_accounts where user_id::text=new.target_id;
  else select user_id into subject from chico_private.sessions where id::text=new.target_id and user_id=new.actor;end if;
  if subject is not null then insert into chico_notifications(user_id,title,body,link,audience,kind,event_key) values(subject,label,'راجع أمان حسابك من الملف الشخصي.','/app?view=profile','self','warning',key) on conflict do nothing;end if;
  return new;
 end if;
 section=case when new.action like 'request_%' then 'requests' when new.action like 'points_%' then 'points' when new.action in ('save_report','import_applied') then 'reports' when new.action like 'shift_%' then 'shifts' when new.action in ('meeting_create','attendance') then 'meetings' when new.action in ('self_username','avatar_change') then 'profile' when new.action in ('approve_account','account_status','account_reopen') then 'accounts' else 'history' end;
 tone=case when new.action in ('flag_add','discipline_add','training_open') then 'danger' when new.action in ('request_create','review_resolve','account_reopen') then 'warning' when new.action in ('save_report','points_adjust','training_stage') then 'success' else 'info' end;
 broadcast=new.action in ('meeting_create','points_policy','settings');management=new.action not in ('self_username','avatar_change');
 value=coalesce(new.after_data->>'staff_id',new.before_data->>'staff_id');
 if value ~ '^[a-f0-9-]{36}$' then staff=value::uuid;end if;
 if staff is null then
  select m.id into staff from chico_members m where m.id::text=new.target_id;
  if staff is null then select a.member_id,a.user_id into staff,subject from chico_accounts a where a.user_id::text=new.target_id;end if;
  if staff is null then select r.staff_id into staff from chico_reports r where r.id::text=new.target_id;end if;
  if staff is null then select r.staff_id into staff from chico_requests r where r.id::text=new.target_id;end if;
  if staff is null then select r.staff_id into staff from chico_flags r where r.id::text=new.target_id;end if;
  if staff is null then select r.staff_id into staff from chico_discipline r where r.id::text=new.target_id;end if;
  if staff is null then select r.staff_id into staff from chico_training r where r.id::text=new.target_id;end if;
  if staff is null then select r.staff_id into staff from chico_shifts r where r.id::text=new.target_id;end if;
 end if;
 if subject is null then select user_id into subject from chico_accounts where member_id=staff;end if;
 if subject is not null and new.action not in ('request_decide','approve_account') then
  insert into chico_notifications(user_id,title,body,link,audience,kind,event_key) values(subject,label,'عندك تحديث يخص حسابك.','/app?view='||case when section in ('points','accounts') then 'history' else section end,'self',tone,key) on conflict do nothing;
 end if;
 if new.action in ('shift_create','shift_cover') then
  insert into chico_notifications(user_id,title,body,link,audience,kind,event_key) select a.user_id,label,'راجع تفاصيل المناوبة.','/app?view=shifts','self','info',key from chico_accounts a join chico_shifts s on a.member_id=s.substitute_id where s.id::text=new.target_id and a.user_id is distinct from subject on conflict do nothing;
  if new.action='shift_cover' then insert into chico_notifications(user_id,title,body,link,audience,kind,event_key) select a.user_id,label,'راجع تفاصيل المناوبة.','/app?view=shifts','self','info',key from chico_accounts a where a.member_id::text=new.before_data->>'substitute_id' and a.user_id is distinct from subject on conflict do nothing;end if;
 end if;
 insert into chico_notifications(user_id,title,body,link,audience,kind,event_key)
 select a.user_id,label,case when broadcast then 'راجع آخر تحديث للفريق.' else 'فيه تحديث يحتاج متابعتك.' end,'/app?view='||case when broadcast and section='points' then 'rules' when broadcast and section='history' then 'rules' else section end,case when broadcast then 'self' else 'management' end,tone,key
 from chico_accounts a join chico_members m on m.id=a.member_id where a.status='active' and a.user_id is distinct from subject and (broadcast or(management and a.user_id is distinct from new.actor and (m.rank='responsible' or exists(select 1 from chico_grants g where g.user_id=a.user_id and g.capability='owner')))) on conflict do nothing;
 return new;
end $$;
revoke all on function public.chico_event_notifications() from public,anon,authenticated;
create trigger chico_event_notifications after insert on chico_audit for each row execute function chico_event_notifications();
create or replace function public.chico_security_notifications() returns trigger language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 if tg_table_name='sessions' then insert into chico_notifications(user_id,title,body,link,event_key) values(new.user_id,'تسجيل دخول جديد','تم تسجيل الدخول لحسابك.','/app?view=profile','login:'||new.id) on conflict do nothing;
 elsif old.recovery_state is distinct from 'completed' and new.recovery_state='completed' then insert into chico_notifications(user_id,title,body,link,kind,event_key) values(new.user_id,'تم تغيير كلمة المرور','استخدم الكلمة الجديدة في الدخول.','/app?view=profile','success','password-change:'||gen_random_uuid()::text) on conflict do nothing;end if;
 return new;
end $$;
revoke all on function public.chico_security_notifications() from public,anon,authenticated;
create trigger chico_login_notification after insert on chico_private.sessions for each row execute function chico_security_notifications();
create trigger chico_password_notification after update on chico_private.recovery_tokens for each row execute function chico_security_notifications();
-- Update the definer DTO as well as RLS, so demoted managers cannot retain a management feed.
do $$declare body text;begin
 body=pg_get_functiondef('public.chico_dashboard(date)'::regprocedure);
 body=replace(body,$old$'notifications',coalesce((select jsonb_agg(to_jsonb(n) order by created_at desc) from public.chico_notifications n where n.user_id=u and n.created_at>now()-interval '90 days'),'[]'::jsonb)$old$,$new$'notifications',(public.chico_notification_feed()->'rows'),'unread_notifications',(public.chico_notification_feed()->'unread_count'),'notifications_can_manage',(public.chico_notification_feed()->'can_manage')$new$);
 execute body;
end $$;
commit;
