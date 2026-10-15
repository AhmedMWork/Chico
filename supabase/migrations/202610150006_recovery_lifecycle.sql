begin;
-- Temporary encrypted credentials are used only to resume the same recovery operation.
alter table chico_private.recovery_tokens add column password_cipher text;
alter table chico_private.recovery_tokens add column recovery_state text check(recovery_state in ('reserved','applying','ambiguous','auth_applied','completed'));
create or replace function public.chico_service_recovery_begin(p_hash text,p_cipher text) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare t chico_private.recovery_tokens;
begin
 perform pg_advisory_xact_lock(15001002);
 select * into t from chico_private.recovery_tokens where token_hash=p_hash for update;
 if not found then return null;end if;
 if t.recovery_state='completed' then return jsonb_build_object('completed',true);end if;
 if t.consumed_at is not null or (t.claim_id is null and t.expires_at<=now()) then return null;end if;
 if t.recovery_state in ('applying','ambiguous') then raise exception 'RECOVERY_PENDING: استعادة قيد التحقق؛ لا تصدر رمزًا آخر. يلزم حسم العملية السابقة من مسؤول التشغيل';end if;
 if t.claim_id is null then
  if not exists(select 1 from public.chico_accounts where user_id=t.user_id and status='active') then return null;end if;
  update chico_private.recovery_tokens set claim_id=gen_random_uuid(),password_cipher=p_cipher,recovery_state='reserved',claim_until=null where token_hash=p_hash returning * into t;
 end if;
 update chico_private.sessions set revoked_at=now() where user_id=t.user_id and revoked_at is null;
 return jsonb_build_object('user_id',t.user_id,'claim',t.claim_id,'cipher',t.password_cipher,'state',t.recovery_state);
end $$;
create or replace function public.chico_service_recovery_step(p_hash text,p_claim uuid,p_step text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare t chico_private.recovery_tokens;
begin
 perform pg_advisory_xact_lock(15001002);
 select * into t from chico_private.recovery_tokens where token_hash=p_hash and claim_id=p_claim for update;
 if not found then raise exception 'رمز الاستعادة غير صالح';end if;
 if p_step='applying' and t.recovery_state='reserved' then update chico_private.recovery_tokens set recovery_state='applying' where token_hash=p_hash;
 elsif p_step='auth_applied' and t.recovery_state in ('applying','auth_applied') then update chico_private.recovery_tokens set recovery_state='auth_applied' where token_hash=p_hash;
 elsif p_step='ambiguous' and t.recovery_state='applying' then update chico_private.recovery_tokens set recovery_state='ambiguous' where token_hash=p_hash;
 else raise exception 'انتقال استعادة غير صالح';end if;
end $$;
-- Called by the server after confirmed Auth success. It is safe to retry after the token expires.
create or replace function public.chico_service_recovery_finish(p_hash text,p_claim uuid) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare t chico_private.recovery_tokens;
begin
 perform pg_advisory_xact_lock(15001002);
 select * into t from chico_private.recovery_tokens where token_hash=p_hash and claim_id=p_claim for update;
 if not found then raise exception 'رمز الاستعادة غير صالح';end if;
 if t.recovery_state='completed' then return;end if;
 if t.recovery_state is not null and t.recovery_state<>'auth_applied' then raise exception 'لم يؤكد مزود الدخول اكتمال الاستعادة';end if;
 update chico_private.recovery_tokens set consumed_at=now(),password_cipher=null,recovery_state='completed' where token_hash=p_hash;
 update chico_private.sessions set revoked_at=now() where user_id=t.user_id and revoked_at is null;
 update public.chico_accounts set must_change_password=false where user_id=t.user_id;
end $$;
-- Legacy test/service claim is retained but now fences sessions and permission changes permanently until finish.
create or replace function public.chico_recovery_blocked(p_user uuid) returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select exists(select 1 from chico_private.recovery_tokens where user_id=p_user and consumed_at is null and claim_id is not null);
$$;
revoke all on function public.chico_recovery_blocked(uuid) from public,anon,authenticated;
revoke all on function public.chico_service_recovery_begin(text,text),public.chico_service_recovery_step(text,uuid,text) from public,anon,authenticated;
grant execute on function public.chico_service_recovery_begin(text,text),public.chico_service_recovery_step(text,uuid,text) to service_role;

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
 if exists(select 1 from chico_private.recovery_tokens where user_id=p_user and consumed_at is null and claim_id is not null) then raise exception 'استعادة الوصول قيد التنفيذ؛ انتظر انتهاء المحاولة قبل إصدار رمز آخر';end if;
 update chico_private.recovery_tokens set consumed_at=now() where user_id=p_user and consumed_at is null;
 insert into chico_private.recovery_tokens(user_id,token_hash,issued_by,expires_at) values(p_user,p_hash,auth.uid(),now()+interval '15 minutes');
 perform public.chico_log('recovery_issued',p_user::text);
end $$;
create or replace function public.chico_service_session_create(p_user uuid,p_auth_session uuid,p_hash text,p_cipher text,p_access_expires timestamptz,p_remember boolean,p_agent text) returns void language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform pg_advisory_xact_lock(15001002);
 if public.chico_recovery_blocked(p_user) then raise exception 'استعادة الوصول قيد التنفيذ؛ أعد المحاولة بعد اكتمالها';end if;
 if not exists(select 1 from public.chico_accounts where user_id=p_user and status<>'disabled') then raise exception using errcode='42501',message='الحساب غير متاح'; end if;
 insert into chico_private.sessions(user_id,auth_session_id,token_hash,tokens_cipher,access_expires_at,expires_at,idle_seconds,remembered,user_agent)
 values(p_user,p_auth_session,p_hash,p_cipher,p_access_expires,now()+case when p_remember then interval '30 days' else interval '12 hours' end,case when p_remember then 604800 else 3600 end,p_remember,'');
end $$;
create or replace function public.chico_valid_session() returns boolean language sql stable security definer set search_path=public,chico_private,pg_temp as $$
 select not public.chico_recovery_blocked(auth.uid()) and exists(select 1 from chico_private.sessions s join public.chico_accounts a on a.user_id=s.user_id
 where s.user_id=auth.uid() and s.auth_session_id::text=auth.jwt()->>'session_id'
 and s.revoked_at is null and s.expires_at>now() and s.last_seen_at+make_interval(secs=>s.idle_seconds)>now()
 and a.status<>'disabled');
$$;
commit;
