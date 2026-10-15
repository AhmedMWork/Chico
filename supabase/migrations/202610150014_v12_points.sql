begin;
create table public.chico_points_policies(version integer generated always as identity primary key,config jsonb not null,created_by uuid references auth.users(id),created_at timestamptz not null default now());
insert into public.chico_points_policies(config) values('{"max_points":100,"tickets":40,"hours":25,"rating":20,"tasks":15}');
create table public.chico_point_adjustments(id uuid primary key default gen_random_uuid(),staff_id uuid not null references public.chico_members(id),period_start date not null,amount numeric(8,2) not null check(amount<>0 and amount between -1000 and 1000),reason text not null check(length(reason) between 3 and 1000),status text not null default 'active' check(status in ('active','voided')),void_reason text,created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
alter table public.chico_points_policies enable row level security;alter table public.chico_point_adjustments enable row level security;
revoke all on public.chico_points_policies,public.chico_point_adjustments from public,anon,authenticated;
grant select on public.chico_points_policies,public.chico_point_adjustments to authenticated;
create policy points_policies_read on public.chico_points_policies for select to authenticated using(public.chico_data_session() and public.chico_manage());
create policy points_adjustments_read on public.chico_point_adjustments for select to authenticated using(public.chico_data_session() and (staff_id=public.chico_staff_id() or public.chico_manage()));
alter table public.chico_reports add column points_policy_version integer references public.chico_points_policies(version);
update public.chico_reports set points_policy_version=1;
create or replace function public.chico_points_snapshot() returns trigger language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
begin
 if tg_op='UPDATE' and new.measured_at=old.measured_at then new.points_policy_version=old.points_policy_version;
 else select version into new.points_policy_version from public.chico_points_policies order by (created_at<=new.measured_at) desc,case when created_at<=new.measured_at then -version else version end limit 1;end if;
 return new;
end $$;
revoke all on function public.chico_points_snapshot() from public,anon,authenticated;
create trigger chico_points_snapshot before insert or update on public.chico_reports for each row execute function public.chico_points_snapshot();
create or replace function public.chico_member_points(p_staff uuid,p_period date) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
declare r public.chico_reports;g jsonb;c jsonb;adjustment numeric;ticket_value numeric;weighted numeric:=0;weight_total numeric:=0;task_ratio numeric:=0;task_count integer:=0;target numeric;actual numeric;metric text;score numeric;maximum numeric;
begin
 select coalesce(sum(amount),0) into adjustment from public.chico_point_adjustments where staff_id=p_staff and period_start=p_period and status='active';
 select * into r from public.chico_reports where staff_id=p_staff and period_start=p_period and status='published' order by (report_type='weekly') desc,measured_at desc,version desc limit 1;
 if r.id is null or r.target_snapshot is null or r.rank_at_measurement in ('administrator','responsible') then return jsonb_build_object('base',null,'total',null,'adjustment',adjustment,'max',100);end if;
 g=r.target_snapshot;select config into c from public.chico_points_policies where version=coalesce(r.points_policy_version,1);maximum=(c->>'max_points')::numeric;
 ticket_value=r.tickets;
 if r.report_type='daily' and r.ticket_mode='daily_count' then select sum(tickets) into ticket_value from(select distinct on((measured_at at time zone 'Asia/Riyadh')::date) tickets from public.chico_reports where staff_id=p_staff and period_start=p_period and status='published' and report_type='daily' order by (measured_at at time zone 'Asia/Riyadh')::date,measured_at desc,version desc)x;end if;
 foreach metric in array array['tickets','hours','rating'] loop
  target=(g->>metric)::numeric;actual=case metric when 'tickets' then ticket_value when 'hours' then r.hours else r.rating end;
  if target is not null then weighted=weighted+(c->>metric)::numeric*case when target>0 then least(1,greatest(0,actual/target)) else 1 end;weight_total=weight_total+(c->>metric)::numeric;end if;
 end loop;
 foreach metric in array array['complaints','requests','messages'] loop
  target=(g->>metric)::numeric;actual=case metric when 'complaints' then r.complaints when 'requests' then r.requests_done else r.messages end;
  if target is not null and target>0 then task_count=task_count+1;task_ratio=task_ratio+least(1,greatest(0,coalesce(actual,0)/target));end if;
 end loop;
 if task_count>0 then weighted=weighted+(c->>'tasks')::numeric*task_ratio/task_count;weight_total=weight_total+(c->>'tasks')::numeric;end if;
 if weight_total<=0 then score=0;else score=round(maximum*weighted/weight_total,2);end if;
 return jsonb_build_object('base',score,'adjustment',adjustment,'total',greatest(0,score+adjustment),'max',maximum,'policy_version',r.points_policy_version,'rank',r.rank_at_measurement);
end $$;
revoke all on function public.chico_member_points(uuid,date) from public,anon,authenticated;
create or replace function public.chico_top(p_period date,p_group text) returns jsonb language plpgsql stable security definer set search_path=public,chico_private,pg_temp as $$
begin
 perform public.chico_actor();if p_group not in ('helpers','moderators') then raise exception 'قائمة غير موجودة';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('staff_id',id,'display_name',display_name,'rank',rank,'points',points,'position',position,'has_avatar',avatar_path is not null) order by position) from(
 select m.id,m.display_name,p.value->>'rank' rank,m.avatar_path,(p.value->>'total')::numeric points,row_number()over(order by (p.value->>'total')::numeric desc,m.id) position from public.chico_members m cross join lateral(select public.chico_member_points(m.id,p_period) value)p
 where (m.game_status<>'dismissed' or p_period<public.chico_week(now())) and p.value->>'total' is not null and case when p_group='helpers' then p.value->>'rank' in ('helper','senior_helper') else p.value->>'rank'='moderator' end
 order by points desc,m.id limit 3)x),'[]'::jsonb);
end $$;
revoke all on function public.chico_top(date,text) from public,anon;
grant execute on function public.chico_top(date,text) to authenticated;
-- Retain the previous command body as an internal implementation, with a single public authority gate.
alter function public.chico_command(text,jsonb) rename to chico_command_v11;
revoke all on function public.chico_command_v11(text,jsonb) from public,anon,authenticated;
create or replace function public.chico_command(p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path=public,chico_private,pg_temp as $$
declare actor uuid:=public.chico_actor();staff uuid;item uuid;old jsonb;conf jsonb;key text;amount numeric;v_period date;
begin
 perform pg_advisory_xact_lock(15001002);perform public.chico_actor();
 if p_action in ('points_policy','points_adjust','points_void') then
  if not public.chico_manage() then raise exception using errcode='42501',message='النقاط عند صاحب الموقع وResponsible';end if;
  if not public.chico_recent_verification() then raise exception using errcode='42501',message='أعد التحقق من كلمة المرور';end if;
  if p_action='points_policy' then
   conf=p_data->'config';foreach key in array array['tickets','hours','rating','tasks'] loop if conf->>key is null or (conf->>key)::numeric not between 0 and 100 then raise exception 'وزن النقاط من0إلى100';end if;end loop;
   if (conf->>'tickets')::numeric+(conf->>'hours')::numeric+(conf->>'rating')::numeric<=0 or (conf->>'max_points')::numeric not between 1 and 1000 or conf->>'max_points' is null then raise exception 'راجع توزيع النقاط والحد الأعلى';end if;
   select config into old from public.chico_points_policies order by version desc limit 1;
   insert into public.chico_points_policies(config,created_by) values(conf,actor);perform public.chico_log(p_action,'points_policy',old,conf);return jsonb_build_object('ok',true);
  elsif p_action='points_adjust' then
   staff=(p_data->>'staff_id')::uuid;perform public.chico_assert_staff_manage(staff,true);v_period=(p_data->>'period_start')::date;amount=(p_data->>'amount')::numeric;
   if extract(isodow from v_period)<>1 or v_period>public.chico_week(now()) or length(trim(p_data->>'reason'))<3 then raise exception 'راجع الأسبوع والسبب';end if;
   insert into public.chico_point_adjustments(staff_id,period_start,amount,reason,created_by) values(staff,v_period,amount,trim(p_data->>'reason'),actor) returning id into item;
   perform public.chico_log(p_action,staff::text,null,p_data||jsonb_build_object('id',item));return jsonb_build_object('id',item);
  else
   item=(p_data->>'id')::uuid;select to_jsonb(a) into old from public.chico_point_adjustments a where id=item and status='active' for update;
   if old is null or length(trim(p_data->>'reason'))<3 then raise exception 'راجع التعديل وسبب الإلغاء';end if;perform public.chico_assert_staff_manage((old->>'staff_id')::uuid,true);
   update public.chico_point_adjustments set status='voided',void_reason=trim(p_data->>'reason') where id=item;perform public.chico_log(p_action,old->>'staff_id',old,p_data);return jsonb_build_object('id',item);
  end if;
 end if;
 return public.chico_command_v11(p_action,p_data);
end $$;
revoke all on function public.chico_command(text,jsonb) from public,anon;
grant execute on function public.chico_command(text,jsonb) to authenticated;
commit;
