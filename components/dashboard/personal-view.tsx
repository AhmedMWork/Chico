'use client';
import {ArrowLeft,ArrowUpLeft,CalendarDays,ChartNoAxesColumn,ClipboardCheck,Clock3,Flag,Leaf,Plus,Shield,Star,Ticket,Trophy} from 'lucide-react';
import type {Snapshot} from '@/lib/domain/types';
import {canPublish,percentage,RANK_LABELS} from '@/lib/domain/rules';
import {flagsText,memberState,performanceFor,effectiveGoals,STATUS_LABELS} from '@/lib/domain/view';
import Leaderboard,{Avatar} from './leaderboard';
import {Badge,DateText,Empty,Meter,localDateTime} from '../ui';
import type {ViewProps} from './view-types';

export default function PersonalView({preview,data,member,account,archived,busy,open,navigate,metric,sectionHead}:ViewProps){
 const perf=performanceFor(data,member.id),goal=effectiveGoals(data,member,perf);
 const flags=flagsText(data,member),state=memberState(data,member),pct=percentage(perf?.tickets,goal?.tickets);
 const nextShift=data.shifts.filter(s=>+new Date(s.ends_at)>Date.now()&&(s.staff_id===member.id||s.substitute_id===member.id)).sort((a,b)=>+new Date(a.starts_at)-+new Date(b.starts_at))[0];
 const meeting=data.meetings.filter(m=>+new Date(m.starts_at)>Date.now()).sort((a,b)=>+new Date(a.starts_at)-+new Date(b.starts_at))[0];
 const confirmed=data.confirmations.some(c=>c.staff_id===member.id&&c.confirmed&&c.target_snapshot===goal?.requests);
 const daily=data.snapshots.filter(r=>r.staff_id===member.id&&r.status==='published'&&r.report_type==='daily').sort((a,b)=>+new Date(a.measured_at)-+new Date(b.measured_at));
 const dayRows=new Map<string,Snapshot>();daily.forEach(r=>dayRows.set(localDateTime(r.measured_at).slice(0,10),r));
 const bars=[...dayRows.values()],max=Math.max(1,...bars.map(b=>b.tickets));
 const time=(value:string)=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'}).format(new Date(value));
 return <>
  <div className="overview-grid">
   <section className="welcome-card">
    <div className="welcome-art" aria-hidden="true"><span className="welcome-orbit"/><img src="/assets/onestate-characters.webp" alt="" width="735" height="496"/></div>
    <div className="welcome-content">
     <div className="welcome-identity"><Avatar member={member} period={data.period} preview={preview} size={44}/><span className="rank-tag" dir="ltr">{RANK_LABELS[member.rank]}</span>{account.owner&&<span className="owner-tag" dir="ltr">Owner</span>}</div>
     <p className="welcome-greeting">أهلًا بعودتك،</p><h2 dir="auto">{member.display_name}<span className="coral-dot">.</span></h2>
     <p className="welcome-description">{goal?(perf?'هذا ملخص أدائك للأسبوع. خلّك على المسار.':'جاهز تبدأ؟ إحصائياتك تظهر بعد اعتماد أول Report.'):'تابع طلباتك، مواعيدك، وكل جديد.'}</p>
     <div className="welcome-actions"><button className="button gold" onClick={()=>navigate('reports')}><ChartNoAxesColumn size={17}/> إحصائياتي <ArrowLeft size={17}/></button><button className="text-button" onClick={()=>navigate('history')}>My history <ArrowUpLeft size={17}/></button></div>
    </div>
    <div className="welcome-bottom"><span><Shield size={15}/> GENERAL TEAM</span><span>{goal?(perf?'تم تحديث أدائك':'بانتظار أول Report'):'كل تحديث في مكانه'}</span></div>
   </section>
   <div className="overview-side">
    <section className="points-spotlight"><div className="points-spotlight-copy"><span className="eyebrow" dir="ltr">WEEKLY POINTS</span><div className="points-total"><strong>{data.points?.total==null?'—':Number(data.points.total).toLocaleString('en-US',{maximumFractionDigits:1})}</strong><span>نقطة</span></div><small>{data.points?.total==null?'تظهر بعد اعتماد الأداء':'نقاطك للأسبوع المختار'}</small></div><span className="points-orb"><Trophy size={32}/></span></section>
    <section className="shift-card"><header><span><Clock3 size={18}/> Next shift</span><button className="icon-button" aria-label="فتح جدول Shifts" onClick={()=>navigate('shifts')}><ArrowUpLeft size={19}/></button></header>{nextShift?<><strong className="shift-clock" dir="ltr">{time(nextShift.starts_at)} <span>— {time(nextShift.ends_at)}</span></strong><p><DateText value={nextShift.starts_at} time={false}/> · السعودية</p><Badge kind={nextShift.coverage==='needs_substitute'?'warning':'success'}>{STATUS_LABELS[nextShift.coverage]}</Badge></>:<><strong className="shift-empty-title">جدولك هادي حاليًا</strong><p>ما عندك مناوبة قادمة.</p><button className="text-button" onClick={()=>navigate('shifts')}>عرض الجدول <ArrowLeft size={15}/></button></>}</section>
   </div>
  </div>
  <div className="overview-section-label"><h2>أداؤك هذا الأسبوع</h2><span dir="ltr">YOUR PERFORMANCE</span></div>
  <div className="metrics-grid metrics-strip personal-metrics">
   {metric('Tickets',perf?.tickets??'—',goal?'الهدف '+goal.tickets+' تذكرة':'حسب تكليفك',Ticket,pct!=null&&pct>=100?'success':'blue',()=>navigate('reports'))}
   {metric('Hours',perf?.hours??'—',goal?'الهدف '+goal.hours+' ساعة':'حسب تكليفك',Clock3,perf&&goal&&perf.hours>=goal.hours?'success':'blue')}
   {metric('Rating',perf?perf.rating.toFixed(2):'—',goal?'المطلوب '+goal.rating.toFixed(2)+' / 5':'تقييم الجودة',Star,perf&&goal?(perf.rating<goal.rating?'warning':'success'):'gold')}
   {metric('Flags',flags==='لم تُراجع'?'—':flags,flags==='لم تُراجع'?'Flags لم تُراجع بعد':state.text,Flag,state.kind,()=>navigate('discipline'))}
  </div>
  <div className="quick-actions" aria-label="إجراءات سريعة">
   {canPublish(account)&&<button disabled={archived||busy} onClick={()=>open('report','Report جديد')}><span className="quick-icon blue"><Plus size={20}/></span><span><strong>Report جديد</strong><small>أضف إحصائياتك</small></span><ArrowUpLeft size={19}/></button>}
   <button disabled={member.game_status==='dismissed'} onClick={()=>open('request_create','طلب جديد')}><span className="quick-icon coral"><Leaf size={20}/></span><span><strong>طلب إجازة أو تبرير</strong><small>أرفق رسالة Discord</small></span><ArrowUpLeft size={19}/></button>
   <button onClick={()=>navigate('profile')}><span className="quick-icon violet"><Shield size={20}/></span><span><strong>My profile</strong><small>صورتك وإعدادات حسابك</small></span><ArrowUpLeft size={19}/></button>
  </div>
  <div className="personal-bottom-grid">
   <section className="card activity-panel">{sectionHead('نشاطك الأسبوعي','ACTIVITY',<button className="text-button" onClick={()=>navigate('reports')}>كل Reports <ArrowLeft size={16}/></button>)}
    {goal&&<div className="activity-target"><div><span>هدف Tickets</span><strong dir="ltr">{perf?.tickets??'—'} <small>/ {goal.tickets}</small></strong></div><Meter value={perf?.tickets??null} target={goal.tickets}/><small>{pct==null?'الهدف جاهز، بانتظار بياناتك.':pct+'% من هدف الأسبوع'}</small></div>}
    <div className="system-bars">{bars.length?bars.map(r=><div className="system-bar-slot" key={r.id}><span dir="ltr">{r.tickets}</span><div className="bar" style={{height:Math.max(3,r.tickets/max*120)+'px'}}/><small><DateText value={r.measured_at} time={false}/></small></div>):<Empty text="أول Report يصنع البداية" detail="بعد اعتماد إحصائياتك، تقدر تتابع نشاطك هنا."/>}</div>
    {bars.length>0&&<div className="panel-bottom"><span>{bars.some(r=>r.ticket_mode==='daily_count')?'Tickets يومية حسب Reports المسجلة.':'إجمالي Tickets للأسبوع وقت كل Report.'}</span></div>}
   </section>
   <section className="card tasks-panel">{sectionHead('رصيدك ومهامك','MY PLANNER')}
    <div className="system-balances"><div><span><Leaf size={17}/> إجازات الشهر</span><strong>{data.balances.leave_available??'—'}<small> / {data.balances.leave_quota??'—'} أيام</small></strong><small>{data.balances.leave_held?data.balances.leave_held+' أيام بانتظار الموافقة':'الخصم بعد الموافقة'}</small></div><div><span><ClipboardCheck size={17}/> التبريرات</span><strong>{data.balances.excuse_available??'—'}<small> / {data.balances.excuse_quota??'—'}</small></strong><small>تتجدد أول كل شهر</small></div></div>
    <div className="system-task"><span className="task-icon"><ClipboardCheck size={21}/></span><div><strong>{goal?.requests?'هدفك '+goal.requests+' طلب':goal?.messages?'هدفك '+goal.messages+' رسالة':'مهام الفريق'}</strong><small>{goal?.requests?'أكد إكمال طلبات الأسبوع.':goal?.messages?'متابعة رسائل SN.Helper.':'حسب تكليف Owner أو Responsible.'}</small></div>{goal?.requests?<button className="button outline small" disabled={archived||busy||member.rank!=='moderator'} onClick={()=>open('confirm_requests',confirmed?'إلغاء التأكيد':'تأكيد إكمال الطلبات',{confirmed:!confirmed,expected_target:goal.requests})}>{confirmed?'مكتمل':'تأكيد'}</button>:null}</div>
    <button className="planner-link text-button" onClick={()=>navigate('requests')}>متابعة طلباتي <ArrowLeft size={16}/></button>
   </section>
  </div>
  <div className="overview-section-label"><h2>صدارة الفريق</h2><span dir="ltr">TEAM LEADERBOARD</span></div>
  <div className="leaderboard-grid"><Leaderboard data={data} group="helpers" compact preview={preview} onOpen={()=>navigate('helpers')}/><Leaderboard data={data} group="moderators" compact preview={preview} onOpen={()=>navigate('moderators')}/></div>
  <section className="meeting-strip"><span className="meeting-icon"><CalendarDays size={22}/></span><div><h3>Team meeting</h3><p>{meeting?<DateText value={meeting.starts_at}/>:<>الاثنين 10 مساءً · السعودية. بانتظار تسجيل الموعد.</>}</p></div><button className="text-button" onClick={()=>navigate('meetings')}>التفاصيل <ArrowLeft size={16}/></button></section>
 </>;
}
