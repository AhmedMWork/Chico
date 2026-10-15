begin;
create or replace function public.chico_import_plan(p_preview uuid) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();preview chico_private.import_previews;item jsonb;old_report public.chico_reports;old_member public.chico_members;operation text;result jsonb:='[]'::jsonb;after_value jsonb;before_value jsonb;
begin
 if not public.chico_cap('manage_imports') then raise exception using errcode='42501',message='الاستيراد يحتاج صلاحية الاستيراد';end if;
 select * into preview from chico_private.import_previews where id=p_preview and user_id=actor and expires_at>now();if not found then raise exception 'انتهت المراجعة؛ أعد تجهيز الملف';end if;
 if preview.type='reports' and not public.chico_publish() then raise exception using errcode='42501',message='نشر الإحصائيات لرتبة Moderator فما فوق فقط';end if;
 for item in select value from jsonb_array_elements(preview.rows) loop
  operation='create';before_value=null;after_value=item;
  if preview.type='members' then
   select * into old_member from public.chico_members where id=nullif(item->>'staff_id','')::uuid;
   if old_member.id is not null then
    before_value=jsonb_build_object('display_name',old_member.display_name,'rank',old_member.rank,'joined_at',old_member.joined_at);
    after_value=jsonb_build_object('display_name',item->>'display_name','rank',item->>'rank','joined_at',item->>'joined_at');
    operation=case when before_value=after_value then 'unchanged' else 'update' end;
   end if;
  else
   select * into old_report from public.chico_reports r where r.staff_id=(item->>'staff_id')::uuid and r.report_type=item->>'report_type' and
    (nullif(item->>'report_id','') is not null and r.id=(item->>'report_id')::uuid or nullif(item->>'report_id','') is null and case when item->>'report_type'='weekly' then r.period_start=public.chico_week((item->>'measured_at')::timestamptz) else r.measured_at=(item->>'measured_at')::timestamptz end) limit 1;
   if old_report.id is not null then
    before_value=jsonb_build_object('tickets',old_report.tickets,'hours',old_report.hours,'rating',old_report.rating,'complaints',old_report.complaints,'requests_done',old_report.requests_done,'messages',old_report.messages,'measured_at',old_report.measured_at);
    after_value=jsonb_build_object('tickets',(item->>'tickets')::integer,'hours',(item->>'hours')::numeric,'rating',(item->>'rating')::numeric,'complaints',(item->>'complaints')::integer,'requests_done',(item->>'requests_done')::integer,'messages',(item->>'messages')::integer,'measured_at',(item->>'measured_at')::timestamptz);
    operation=case when before_value=after_value and old_report.ticket_mode=item->>'ticket_mode' and old_report.status='published' and exists(select 1 from public.chico_files where id=old_report.source_file and content_hash=preview.file_hash) then 'unchanged' else 'update' end;
    after_value=after_value||jsonb_build_object('report_id',old_report.id,'expected_version',old_report.version);
    if operation='update' and not public.chico_manage() then operation='rejected';end if;
   end if;
  end if;
  result=result||jsonb_build_array(jsonb_build_object('index',(item->>'_source_row')::integer,'staff_id',item->>'staff_id','operation',operation,'before',before_value,'after',after_value));
 end loop;return result;
end $$;
revoke all on function public.chico_import_plan(uuid) from public,anon;
grant execute on function public.chico_import_plan(uuid) to authenticated;
commit;
