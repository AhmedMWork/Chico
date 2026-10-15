'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowUpRight, Bell, CalendarDays, ChartNoAxesColumn, CircleHelp, Clock3, Crown, FileSpreadsheet, Flag, Grid2X2, Leaf, LogOut, Menu, Plus, RefreshCw, Settings, Shield, ShieldCheck, Star, Ticket, UserRound, Users, X, Check, LockKeyhole, History, MessageSquare, ClipboardCheck, Upload, Download, ChevronDown, BookOpen } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AccountRow, DataBundle, Member, Snapshot, Rank } from '@/lib/domain/types';
import { canManage, canPublish, displayNumber, goals, hasCapability, percentage, RANK_LABELS, RANK_LEVEL, saudiDateTime, weekDate, weeklyPeriod } from '@/lib/domain/rules';
import { memberFlags, memberState, performanceFor, effectiveGoals, flagsText, STATUS_LABELS, teamSummary } from '@/lib/domain/view';
import { Badge, DateText, Empty, FormFields, localDateTime, Meter, Modal, Notice, safeUrl, type Field } from './ui';
import dynamic from 'next/dynamic';
import {useDashboardData} from './dashboard/use-dashboard-data';
import CommandBanner from './dashboard/command-banner';
import NotificationCenter from './dashboard/notification-center';
import RankDirectory from './dashboard/rank-directory';
import Leaderboard from './dashboard/leaderboard';
import ProfilePanel from './dashboard/profile-panel';
import RequestsPanel from './dashboard/requests-panel';
import PointsPanel,{DEFAULT_POINTS} from './dashboard/points-panel';
import MemberHistory from './dashboard/member-history';
import PersonalView from './dashboard/personal-view';
import TeamView from './dashboard/team-view';
import AuditPanel,{AuditValues} from './dashboard/audit-panel';
const ImportPanel=dynamic(()=>import('./import-panel'),{loading:()=> <p role="status">جارٍ تجهيز مساحة الاستيراد…</p>});
type Section = 'personal' | 'team' | 'reports' | 'accounts' | 'members' | 'shifts' | 'requests' | 'discipline' | 'meetings' | 'notifications' | 'imports' | 'settings' | 'profile' | 'rules' | 'audit' | 'points' | 'history' | 'helpers' | 'moderators';
type Dialog = {
    kind: string;
    title: string;
    row?: Record<string, unknown>;
    wide?: boolean;
};
type ApiResult = {
    error?: string;
    code?: string;
    result?: unknown;
    token?: string;
    ok?: boolean;
    message?: string;
};
const titles: Record<Section, string> = { personal: 'الرئيسية', team: 'إدارة الفريق', reports: 'التقارير والإحصائيات', accounts: 'إدارة الحسابات', members: 'أعضاء الفريق', shifts: 'المناوبات والتغطية', requests: 'الإجازات والتبريرات', discipline: 'الانضباط والتدريب', meetings: 'اجتماعات الفريق', notifications: 'التنبيهات', imports: 'استيراد البيانات', settings: 'الإعدادات', profile: 'حسابي', rules: 'القوانين والسياسات', points:'نظام النقاط',history:'السجل',helpers:'الهيلبر',moderators:'المودريتور',audit: 'سجل الإدارة' };
function icon(Icon: LucideIcon) { return <Icon className="icon"/>; }
function field(name: string, label: string, type: Field['type'] = 'text', value?: Field['value'], extra: Partial<Field> = {}): Field { return { name, label, type, value, ...extra }; }
function requiredNumber(form: FormData, name: string) { const raw = form.get(name); if (raw === null || raw === '')
    throw new Error('أكمل الحقل المطلوب: ' + name); const value = Number(raw); if (!Number.isFinite(value))
    throw new Error('رقم غير صالح'); return value; }
function nullableNumber(form: FormData, name: string) { const raw = form.get(name); return raw === null || raw === '' ? null : requiredNumber(form, name); }
export default function Dashboard({ initial, preview = false, initialSection = 'personal' }: {
    initial: DataBundle;
    preview?: boolean;
    initialSection?: Section;
}) {
    const {data,period,refreshing,refresh,loadError,updatedAt}=useDashboardData(initial,preview);
    const [extraAudit,setExtraAudit]=useState<DataBundle['audit']>([]);
    const [auditLoading,setAuditLoading]=useState(false);
    const [linkedStaff,setLinkedStaff]=useState('');
    const [section, setSection] = useState<Section>(initialSection);
    const [navOpen, setNavOpen] = useState(false);const [compact,setCompact]=useState(false);const sidebarRef=useRef<HTMLElement>(null);
    useEffect(()=>{const media=window.matchMedia('(max-width:960px)');const sync=()=>setCompact(media.matches);sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
    useEffect(()=>{if(!navOpen||!compact)return;const node=sidebarRef.current,previous=document.activeElement as HTMLElement|null;const focusable=()=>Array.from(node?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')??[]).filter(e=>e.offsetParent!==null);focusable()[0]?.focus();const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const elements=focusable(),first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};node?.addEventListener('keydown',trap);return()=>{node?.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus({preventScroll:true});};},[navOpen,compact]);
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [toast, setToast] = useState('');
    const [rankFilter, setRankFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [pendingCommand, setPendingCommand] = useState<{
        action: string;
        payload: Record<string, unknown>;
    } | null>(null);
    const [sessions, setSessions] = useState<Array<{
        id: string;
        created_at: string;
        last_seen_at: string;
        expires_at: string;
        current: boolean;
    }>>([]);
    const [recoveryToken, setRecoveryToken] = useState('');
    const unread=Number(data.unread_notifications??data.notifications.filter(n=>!n.read_at).length);
    const seenNotifications=useRef(new Set(initial.notifications.map(n=>n.id)));
    useEffect(()=>{const fresh=data.notifications.filter(n=>!n.read_at&&!seenNotifications.current.has(n.id));for(const n of data.notifications)seenNotifications.current.add(n.id);if(fresh.length)setToast(fresh[0].title);},[data.notifications]);
    const account = data.account;
    const member = data.members.find(m=>m.id===account.member?.id)??account.member!;
    const manage = canManage(account);
    const publish = canPublish(account);
    const approve = hasCapability(account, 'approve_accounts');
    const imports = account.owner || hasCapability(account, 'manage_imports');
    const settings = hasCapability(account, 'manage_settings');
    const archived = period !== weekDate();
    const summary = useMemo(() => teamSummary(data), [data]);
    const nameOf = (id: string | null | undefined) => data.members.find(m => m.id === id)?.display_name ?? 'عضو غير متاح';
    const [approvalDecision, setApprovalDecision] = useState('active');
    const open = (kind: string, title: string, row?: unknown, wide = false) => { setError(''); setRecoveryToken(''); setApprovalDecision('active');setLinkedStaff(''); setDialog({ kind, title, row: row as Record<string, unknown> | undefined, wide }); };
    const notify = (message: string) => { setToast(message); };
    useEffect(() => { if (!toast)
        return; const timeout = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timeout); }, [toast]);
    useEffect(() => { if (preview || dialog)
        return; const timer = setInterval(() => { if (document.visibilityState === 'visible')
        void refresh(); }, 60000); return () => clearInterval(timer); }, [dialog, preview, refresh]);
    useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape')
        setNavOpen(false); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, []);
    async function command(action: string, payload: Record<string, unknown>, keepOpen = false) {
        if (preview) {
            notify('هذه معاينة للواجهات؛ لا تُحفظ بيانات أو قرارات.');
            return null;
        }
        setBusy(true);
        setError('');
        try {
            const r = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: payload }) });
            const result = await r.json() as ApiResult;
            if (r.status === 401) {
                window.location.assign('/');
                return null;
            }
            if (!r.ok) {
                if (result.code==='REAUTH_REQUIRED') {
                    setPendingCommand({ action, payload });
                    setDialog({ kind: 'verify', title: 'تأكيد هويتك' });
                    return null;
                }
                throw new Error(result.error ?? 'تعذر حفظ العملية');
            }
            if (action === 'session_revoke')
                setSessions(current => current.filter(s => s.id !== payload.id));
            if (result.token) {
                setRecoveryToken(result.token);
                return result;
            }
            if (!keepOpen)
                setDialog(null);
            await refresh();
            notify('تم الحفظ');
            return result;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'تعذر الاتصال');
            return null;
        }
        finally {
            setBusy(false);
        }
    }
    async function downloadSource(id: string) { if (preview)
        return; try {
        const r = await fetch('/api/files/' + id);
        const out = await r.json() as {
            url?: string;
            error?: string;
        };
        if (!r.ok || !out.url)
            throw new Error(out.error ?? 'تعذر فتح الملف');
        const link = document.createElement('a');
        link.href = out.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
    }
    catch (e) {
        notify(e instanceof Error ? e.message : 'تعذر فتح المصدر');
    } }
    async function authAction(endpoint: string, payload: Record<string, unknown>) { if (preview) {
        notify('إجراء حساب حقيقي؛ غير متاح في المعاينة.');
        return;
    } setBusy(true); setError(''); try {
        const r = await fetch('/api/' + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const result = await r.json() as ApiResult;
        if (!r.ok)
            throw new Error(result.error ?? 'تعذر إتمام العملية');
        if (endpoint === 'password' || endpoint === 'logout') {
            window.location.assign('/');
            return;
        }
        if (endpoint === 'verify' && pendingCommand) {
            const pending = pendingCommand;
            setPendingCommand(null);
            await command(pending.action, pending.payload);
        }
        else {
            setDialog(null);
            notify('تم التحقق.');
        }
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر الاتصال');
    }
    finally {
        setBusy(false);
    } }
    function navigate(value: Section) { const url=new URL(window.location.href);url.searchParams.set('view',value);window.history.pushState(null,'',url);setSection(value); setNavOpen(false); setSearch(''); setError(''); window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth' }); if (value === 'profile' && !preview)
        fetch('/api/sessions', { cache: 'no-store' }).then(r => r.json()).then(d => { if (Array.isArray(d))
            setSessions(d); }).catch(() => { }); }
    function changePeriod(value: string) { if (preview) {
        notify('المعاينة تعرض فترة توضيحية واحدة.');
        return;
    } void refresh(value); }
    useEffect(()=>{const sync=()=>{const view=new URL(window.location.href).searchParams.get('view');if(view&&view in titles)setSection(view as Section);};sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
    const memberOptions = data.members.map(m => ({ value: m.id, label: m.display_name + ' · ' + RANK_LABELS[m.rank] }));
    const rankOptions = Object.entries(RANK_LABELS).map(([value, label]) => ({ value, label }));
    const selectMember = (value = member.id) => {if(!manage&&['report','request_create'].includes(dialog?.kind??''))return field('staff_id','العضو','select',member.id,{options:[{value:member.id,label:member.display_name}]});const sensitive=['discipline_add','flag_add','flags_baseline','training_open'].includes(dialog?.kind??'');const options=sensitive&&!preview?memberOptions.filter(o=>data.members.find(m=>m.id===o.value)?.allowed_actions?.includes('discipline_add')):memberOptions;return field('staff_id','عضو الفريق','select',options.some(o=>o.value===value)?value:options[0]?.value,{options});};
    const nav: ({
        section: Section;
        label: string;
        Icon: LucideIcon;
        allowed: boolean;
        count?: number;
    })[] = [
        { section: 'notifications', label:'التنبيهات',Icon:Bell,allowed:true,count:unread},{ section: 'personal', label: 'الرئيسية', Icon: UserRound, allowed: true }, {section:'helpers',label:'الهيلبر',Icon:Users,allowed:true},{section:'moderators',label:'المودريتور',Icon:Shield,allowed:true},{section:'history',label:'سجلي',Icon:History,allowed:true},{section:'points',label:'نظام النقاط',Icon:Star,allowed:manage},{ section: 'team', label: 'إدارة الفريق', Icon: Grid2X2, allowed: manage },
        { section: 'reports', label: 'التقارير والإحصائيات', Icon: ChartNoAxesColumn, allowed: true }, { section: 'shifts', label: 'المناوبات والتغطية', Icon: Clock3, allowed: true }, { section: 'requests', label: 'الإجازات والتبريرات', Icon: Leaf, allowed: true },
        { section: 'members', label: 'أعضاء الفريق', Icon: Users, allowed: manage }, { section: 'accounts', label: 'إدارة الحسابات', Icon: ShieldCheck, allowed: approve, count: data.pending_accounts.length },
        { section: 'discipline', label: 'الانضباط والتدريب', Icon: Flag, allowed: true }, { section: 'meetings', label: 'اجتماعات الفريق', Icon: CalendarDays, allowed: true }, { section: 'imports', label: 'استيراد البيانات', Icon: FileSpreadsheet, allowed: imports },
        { section: 'audit', label: 'سجل التدقيق', Icon: History, allowed: manage }, { section: 'rules', label: 'القوانين والسياسات', Icon: BookOpen, allowed: true }, { section: 'settings', label: 'الإعدادات', Icon: Settings, allowed: settings }
    ];
    function metric(label: string, value: React.ReactNode, detail: string, Icon: LucideIcon, kind = 'gold', action?: () => void) { const accent=Icon===Clock3?'cyan':Icon===Star?'violet':Icon===Flag?'red':Icon===Users?'cyan':Icon===MessageSquare?'violet':'gold';return <section className={'card metric metric-' + kind+' metric-accent-'+accent}><div className="metric-top"><span>{label}</span><span className={'metric-icon ' + kind}>{icon(Icon)}</span></div><div className="metric-value"><span dir="ltr">{value}</span></div><div className={'metric-note ' + kind}>{detail}</div>{action && <button className="metric-detail-link" onClick={action} aria-label={'تفاصيل ' + label}>{icon(ArrowUpRight)}</button>}</section>; }
    function sectionHead(title: string, kicker: string, button?: React.ReactNode) { return <div className="section-heading"><div><div className="eyebrow">{kicker}</div><h2>{title}</h2></div>{button}</div>; }
    const viewProps={preview,data,member,account,archived,busy,open,navigate,metric,sectionHead,summary,rankFilter,setRankFilter,nameOf,approve};
    function personal(){return <PersonalView {...viewProps}/>;}

    function team(){return <TeamView {...viewProps}/>;}

    function reports() { return <section className="card system-panel">{sectionHead('سجل الإحصائيات', 'أداء الأسبوع', publish && (!archived || manage) ? <button className="button gold small" onClick={() => open('report', 'إدخال إحصائيات', undefined, true)}>{icon(Plus)} إدخال إحصائيات</button> : undefined)}<Notice>الساعات إجمالي الأسبوع. التقرير الأسبوعي لا يُضاف إلى اليومي مرة ثانية. Helper وSN.Helper لا يملكان نشر الإحصائيات.</Notice>{data.snapshots.length ? <div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>العضو</th><th>الوقت</th><th>النوع</th><th>التذاكر</th><th>الساعات</th><th>التقييم</th><th>الحالة</th><th>المصدر</th><th /></tr></thead><tbody>{data.snapshots.map(r => <tr key={r.id}><td data-label="العضو">{nameOf(r.staff_id)}</td><td data-label="الوقت"><DateText value={r.measured_at}/></td><td data-label="النوع">{r.report_type === 'weekly' ? 'ملخص أسبوعي' : r.ticket_mode === 'daily_count' ? 'عدد يومي' : 'لقطة إجمالي الأسبوع'}</td><td data-label="التذاكر" dir="ltr">{r.tickets}</td><td data-label="الساعات" dir="ltr">{r.hours}</td><td data-label="التقييم" dir="ltr">{r.rating.toFixed(2)}</td><td data-label="الحالة"><Badge kind={r.status === 'published' ? 'success' : 'gold'}>{STATUS_LABELS[r.status]}</Badge></td><td data-label="المصدر" className="source-cell">{r.source}{manage&&<small>نسخة {r.version}</small>}{r.source_file && manage && <button className="text-button" onClick={() => void downloadSource(r.source_file!)}>فتح المرفق</button>}</td><td data-label="تفاصيل">{publish && (!archived || manage) && (manage || r.status === 'draft') && <button className="text-button" onClick={() => open('report', r.status === 'draft' ? 'تعديل المسودة' : 'تصحيح إحصائيات منشورة', r, true)}>{r.status === 'draft' ? 'تعديل' : 'تصحيح'}</button>}</td></tr>)}</tbody></table></div> : <Empty text="لم تُضف إحصائيات لهذه الفترة." detail="ستظهر السجلات بعد نشرها بواسطة عضو مخول."/>}</section>; }
    function accounts() { return <><section className="card system-panel">{sectionHead('حسابات بانتظار الاعتماد', 'بانتظار الموافقة')}<Notice>راجع عضوية الحساب قبل القبول. الاسم الظاهر يحدده المسؤول.</Notice>{data.pending_accounts.length ? <div className="system-account-list">{data.pending_accounts.map(a => <div className="system-account-row" key={a.user_id}><span className="account-icon">{icon(UserRound)}</span><div><strong dir="ltr">{a.username}</strong><small><DateText value={a.created_at}/></small></div><Badge kind="warning">بانتظار الاعتماد</Badge><button className="button gold small" onClick={() => open('approve_account', 'مراجعة واعتماد الحساب', a)}>مراجعة الحساب</button></div>)}</div> : <Empty text="لا توجد حسابات معلقة."/>}</section><section className="card system-panel">{sectionHead('الحسابات المعتمدة', 'إدارة الوصول والاسم الظاهر')}<div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>الاسم الظاهر</th><th>الرتبة</th><th>الحالة</th><th>الإجراءات</th></tr></thead><tbody>{data.accounts.map(a => <tr key={a.user_id}><td data-label="الاسم الظاهر">{a.display_name ?? 'غير مرتبط'}</td><td data-label="الرتبة" dir="ltr">{a.rank ? RANK_LABELS[a.rank] : '—'}</td><td data-label="الحالة"><Badge kind={a.status === 'active' ? 'success' : 'danger'}>{STATUS_LABELS[a.status]}</Badge></td><td data-label="الإجراءات"><div className="system-row-actions">{(preview||a.allowed_actions?.includes('rename_account'))&&<button className="text-button" onClick={() => open('rename_account', 'تغيير الاسم الظاهر', a)}>الاسم الظاهر</button>}{a.user_id !== account.user_id && (preview||a.allowed_actions?.some(x=>['account_reopen','account_status'].includes(x)))&& <>{a.status==='rejected'?<button className="text-button" onClick={()=>open('account_reopen','إعادة الحساب للمراجعة',a)}>إعادة للمراجعة</button>:<button className="text-button" onClick={() => open('account_status', a.status === 'active' ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب', { ...a, status: a.status === 'active' ? 'disabled' : 'active' })}>{a.status === 'active' ? 'تعطيل' : 'تفعيل'}</button>}{a.status==='active'&&<button className="text-button" onClick={() => open('recovery_issue', 'إصدار رمز استعادة', a)}>استعادة الوصول</button>}</>}</div></td></tr>)}</tbody></table></div></section></>; }
    function members() { const rows = data.members.filter(m => m.display_name.toLowerCase().includes(search.toLowerCase()) && (rankFilter === 'all' || m.rank === rankFilter)); return <section className="card system-panel">{sectionHead('أعضاء الفريق', 'الهوية والرتبة والأداء', <button className="button gold small" onClick={() => open('member_create', 'إضافة عضو فريق')}>{icon(Plus)} إضافة عضو</button>)}<div className="system-filters"><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="تصفية أعضاء هذه القائمة" aria-label="تصفية أسماء الأعضاء"/><select value={rankFilter} onChange={e => setRankFilter(e.target.value)} aria-label="الرتبة"><option value="all">كل الرتب</option>{Object.entries(RANK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>{rows.length ? <div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>العضو</th><th>الرتبة</th><th>الانضمام</th><th>الحالة</th><th>التذاكر</th><th>الفلاجات</th><th /></tr></thead><tbody>{rows.map(m => { const p = performanceFor(data, m.id); const state = memberState(data, m); return <tr key={m.id}><td data-label="العضو">{m.display_name}<small>{'ID · '+m.id.slice(0,8)}</small></td><td data-label="الرتبة" dir="ltr">{RANK_LABELS[m.rank]}</td><td data-label="الانضمام"><DateText value={m.joined_at} time={false}/></td><td data-label="الحالة"><Badge kind={state.kind}>{state.text}</Badge></td><td data-label="التذاكر" dir="ltr">{p?.tickets ?? '—'}</td><td data-label="الفلاجات">{flagsText(data, m)}</td><td data-label="الإجراءات">{(preview||m.allowed_actions?.includes('rank_member'))&&<><button className="text-button" onClick={() => open('rank_member', 'تغيير رتبة العضو', m)}>الرتبة</button><button className="text-button" onClick={() => open('member_edit', 'تعديل ملف العضو', m)}>الملف</button></>}</td></tr>; })}</tbody></table></div> : <Empty text="لا توجد نتائج لهذه التصفية."/>}</section>; }
    function shifts() { return <section className="card system-panel">{sectionHead('جدول المناوبات', 'جميع الأوقات بتوقيت السعودية', manage ? <button className="button gold small" onClick={() => open('shift_create', 'إضافة مناوبة')}>{icon(Plus)} إضافة مناوبة</button> : undefined)}{data.shifts.length ? <div className="system-schedule">{data.shifts.map(s => <div className="system-schedule-row" key={s.id}><span className="task-icon">{icon(Clock3)}</span><div><strong>{nameOf(s.staff_id)}</strong><small><DateText value={s.starts_at}/> — <DateText value={s.ends_at}/></small>{s.substitute_id && <small>البديل: {nameOf(s.substitute_id)}</small>}</div><Badge kind={s.coverage === 'needs_substitute' ? 'warning' : 'success'}>{STATUS_LABELS[s.coverage]}</Badge>{manage && <button className="text-button" onClick={() => open('shift_cover', 'تعيين بديل للمناوبة', s)}>التغطية</button>}</div>)}</div> : <Empty text="لم تُضف مناوبات في الجدول بعد."/>}<Notice>التبرير قبل المناوبة بأكثر من ساعة، مع بديل يقبل التغطية. تداخل المناوبات يُرفض عند الحفظ.</Notice></section>; }
    function requests(){return <RequestsPanel data={data} manage={manage} open={open} onCommand={command}/>;}
    function discipline() {
        return <><section className="card system-panel">{sectionHead('الفلاجات والقرارات', 'تاريخ تراكمي لا يُحذف', manage ? <div className="system-row-actions"><button className="button outline small" onClick={() => open('flags_baseline', 'مراجعة الإجمالي التراكمي')}>مراجعة الإجمالي</button><button className="button outline small" onClick={() => open('flag_add', 'إضافة فلاج موثق')}>{icon(Flag)} فلاج</button><button className="button gold small" onClick={() => open('discipline_add', 'تسجيل قرار انضباط')}>{icon(Plus)} قرار</button></div> : undefined)}<Notice>7–9 فلاجات متابعة مع Moderator؛ 10 فأكثر مسار إيقاف للتدريب. كل تحذيرين يتحولان إلى توبيخ واحد مرة واحدة. الفصل قرار منفصل موثق.</Notice><div className="system-discipline-summary">{data.members.filter(m => manage || m.id === member.id).map(m => <div key={m.id}><strong>{m.display_name}</strong><span>{flagsText(data, m)} فلاجات</span><Badge kind={memberState(data, m).kind}>{memberState(data, m).text}</Badge>{manage && m.game_status === 'active' && <button className="text-button" onClick={() => open('training_open', 'إيقاف للتدريب', { staff_id: m.id })}>مسار التدريب</button>}</div>)}</div>{data.flags.length ? <div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>العضو</th><th>العدد</th><th>الوقت</th><th>السبب والمصدر</th><th>الحالة</th><th /></tr></thead><tbody>{data.flags.map(f => <tr key={f.id}><td data-label="العضو">{nameOf(f.staff_id)}</td><td data-label="العدد">{f.amount}</td><td data-label="الوقت"><DateText value={f.occurred_at}/></td><td data-label="السبب والمصدر">{f.reason}<small>{f.source}</small></td><td data-label="الحالة"><Badge kind={f.status === 'voided' ? 'neutral' : 'warning'}>{f.status === 'voided' ? 'ملغى' : 'مثبت'}</Badge></td><td data-label="تفاصيل">{manage && f.status === 'verified' && <button className="text-button" onClick={() => open('flag_void', 'إلغاء فلاج مع حفظ التاريخ', f)}>إلغاء موثق</button>}</td></tr>)}</tbody></table></div> : <Empty text="لا توجد وقائع فلاجات مسجلة."/>}
  {data.discipline.length > 0 && <div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>العضو</th><th>القرار</th><th>السبب</th><th>الوقت</th><th>الحالة</th><th /></tr></thead><tbody>{data.discipline.map(d => <tr key={d.id}><td data-label="العضو">{nameOf(d.staff_id)}</td><td data-label="القرار">{{ warning: 'تحذير', reprimand: 'توبيخ', dismissal: 'فصل', blacklist: 'فصل مع Blacklist' }[d.kind]}{d.derived_from.length > 0 && <small>تحويل تحذيرين موثقين</small>}</td><td data-label="السبب">{d.reason}</td><td data-label="الوقت"><DateText value={d.occurred_at}/></td><td data-label="الحالة">{d.status === 'voided' ? 'ملغى' : 'مثبت'}</td><td data-label="تفاصيل">{manage && d.status === 'verified' && ['warning', 'reprimand'].includes(d.kind) && <button className="text-button" onClick={() => open('discipline_void', 'إلغاء واقعة موثق', d)}>إلغاء موثق</button>}</td></tr>)}</tbody></table></div>}</section>
  <section className="card system-panel">{sectionHead('التدريب واعتماد العودة', 'حالة الموقع مستقلة عن حالة اللعبة')}{data.training.length ? <div className="system-request-list">{data.training.map(c => <article className="system-request-card" key={c.id}><div><strong>{nameOf(c.staff_id)}</strong><Badge kind={c.stage === 'returned' ? 'success' : 'warning'}>{STATUS_LABELS[c.stage]}</Badge></div><p>{c.reason}</p><p>{c.notes}</p>{manage && c.stage !== 'returned' && <button className="button outline small" onClick={() => open('training_stage', c.stage === 'awaiting_return' ? 'اعتماد العودة' : 'تحديث مسار التدريب', { ...c, stage: c.stage === 'waiting_training' ? 'training' : c.stage === 'training' ? 'awaiting_return' : 'returned' })}>{c.stage === 'waiting_training' ? 'بدء التدريب' : c.stage === 'training' ? 'تسجيل إتمام التدريب' : 'اعتماد العودة'}</button>}</article>)}</div> : <Empty text="لا توجد حالات تدريب مسجلة."/>}</section></>;
    }
    function meetings() { return <section className="card system-panel">{sectionHead('اجتماع الفريق', 'الاثنين 22:00 بتوقيت السعودية', manage ? <button className="button gold small" onClick={() => open('meeting_create', 'تسجيل اجتماع الفريق')}>{icon(Plus)} إضافة موعد</button> : undefined)}<Notice>الحضور مطلوب حتى أثناء الإجازة، إلا بتبرير مقبول. تسجيل الحضور يبدأ بعد وقت الاجتماع.</Notice>{data.meetings.length ? data.meetings.map(m => <article className="system-meeting" key={m.id}><span className="meeting-icon">{icon(CalendarDays)}</span><div><h3>{m.title}</h3><p><DateText value={m.starts_at}/></p>{safeUrl(m.channel_url) && <a className="text-button" href={safeUrl(m.channel_url)!} target="_blank" rel="noopener noreferrer">قناة الاجتماع {icon(ArrowUpRight)}</a>}<p>{data.attendance.filter(a => a.meeting_id === m.id).map(a => <span key={a.staff_id} className="system-attendance-item">{nameOf(a.staff_id)}: {STATUS_LABELS[a.status]}</span>)}</p></div>{manage && <button className="button outline small" disabled={+new Date(m.starts_at) > Date.now()} onClick={() => open('attendance', 'تسجيل الحضور', { meeting_id: m.id })}>تسجيل الحضور</button>}</article>) : <Empty text="لم تُضف مواعيد الاجتماعات بعد."/>}</section>; }
    function notifications(){return <NotificationCenter allowManagement={data.notifications_can_manage??manage} rows={data.notifications} unread={unread} onCommand={command} onNavigate={value=>{if(value in titles)navigate(value as Section);}} preview={preview}/>;}
    function profile(){return <ProfilePanel data={data} preview={preview} open={open} onRefresh={refresh} onLogout={all=>all?open('logout_all','خروج من كل الجلسات'):void authAction('logout',{all:false})} onHistory={()=>navigate('history')}/>;}
    function settingsView() { return <section className="card system-panel">{sectionHead('سياسات الأرصدة وقنوات الفريق', 'ضبط الفريق', <button className="button gold small" onClick={() => open('settings', 'تعديل الإعدادات', undefined, true)}>تعديل الإعدادات</button>)}<Notice>الأرصدة تتجدد شهريًا. قيمة غير محددة تختلف عن صفر؛ لا تُقبل طلبات رتبة لم تضبط سياستها بعد.</Notice><div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>الرتبة</th><th>أيام الإجازة</th><th>التبريرات</th></tr></thead><tbody>{Object.entries(RANK_LABELS).map(([rank, label]) => <tr key={rank}><td data-label="الرتبة" dir="ltr">{label}</td><td data-label="أيام الإجازة">{data.settings.leave[rank as Rank] ?? 'لم تُضبط'}</td><td data-label="التبريرات">{data.settings.excuses[rank as Rank] ?? 'لم تُضبط'}</td></tr>)}</tbody></table></div>{account.owner && <div className="system-owner-transfer"><h3>نقل ملكية الموقع</h3><p>ينقل صلاحيات المالك إلى حساب فعال آخر، مع بقاء رتبة اللعبة مستقلة.</p><button className="button outline" onClick={() => open('transfer_owner', 'نقل ملكية الموقع')}>مراجعة نقل الملكية</button></div>}</section>; }
    function rulesView() { return <section className="card system-panel">{sectionHead('القوانين والسياسات', 'مرجع العمل داخل النظام')}<div className="policy-list"><h3>الفترة والتقييم</h3><p>الأسبوع من الاثنين 03:00 فجرًا إلى الاثنين التالي بتوقيت السعودية. القيادة دون أهداف أداء. الأهداف الحالية أدناه؛ يحتفظ التقرير القديم بأهدافه المسجلة وقت القياس.</p><div className="table-scroll"><table className="performance-table system-table"><thead><tr><th>الرتبة</th><th>التذاكر</th><th>الساعات</th><th>التقييم</th><th>الشكاوى</th><th>الطلبات</th><th>الرسائل</th></tr></thead><tbody>{(['helper', 'senior_helper', 'moderator'] as Rank[]).map(rank => { const g = goals(rank, data.settings)!; return <tr key={rank}><td data-label="الرتبة" dir="ltr">{RANK_LABELS[rank]}</td>{Object.values(g).map((v, i) => <td data-label="التذاكر" dir="ltr" key={i}>{v ?? '—'}</td>)}</tr>; })}</tbody></table></div><h3>الانضباط</h3><p>الفلاجات تراكمية: 7–9 متابعة مع Moderator، ومن 10 مسار إيقاف للتدريب وعودة معتمدة. التحذير والتوبيخ والإيقاف والفصل قرارات مختلفة؛ كل تحذيرين يتحولان إلى توبيخ مرة واحدة، وثلاثة توبيخات تستلزم مراجعة قرار الفصل.</p><h3>الأرصدة والاجتماع</h3><p>الأرصدة وفق سياسة الرتبة الحالية في الإعدادات، وتجدد مع الشهر دون حذف الطلبات. للعضو الجديد يوم إجازة بعد 14 يومًا خلال أول 30 يومًا. الإجازة لا تخفض الأهداف، والتبرير قبل المناوبة بأكثر من ساعة ومع بديل مقبول. اجتماع الاثنين 22:00 يشمل المجاز إلا بتبرير مقبول.</p><h3>الحسابات والخصوصية</h3><p>الحسابات تنتظر الاعتماد. نشر الإحصائيات لرتبة Moderator فما فوق فقط. كل عضو يشوف إحصائياته فقط. إدارة الفريق لصاحب الموقع وResponsible. اسم الإداري مستقل عن اسم الدخول. لا نجمع بيانات اتصال أو هوية خارجية أو معلومات الجهاز.</p><h3>مصدر البيانات</h3><p>العدد اليومي يختلف عن إجمالي الأسبوع. الساعات والتقييم لقطات لا تُجمع. الملخص الأسبوعي لا يُضاف مرة أخرى إلى اليومي. البيانات الناقصة ليست صفرًا. </p></div></section>; }
    async function loadAudit(){setAuditLoading(true);try{const rows=[...data.audit,...extraAudit];const before=Math.min(...rows.map(a=>a.id));const response=await fetch('/api/audit?before='+before,{cache:'no-store'});const result=await response.json() as DataBundle['audit']&{error?:string};if(!response.ok)throw new Error(result.error);setExtraAudit(current=>[...current,...result]);if(!result.length)notify('وصلت لنهاية السجل.');}catch(e){notify(e instanceof Error?e.message:'تعذر تحميل السجل');}finally{setAuditLoading(false);}}
    function audit(){return <AuditPanel rows={[...data.audit,...extraAudit].filter((a,i,all)=>all.findIndex(x=>x.id===a.id)===i)} onDetail={a=>open('audit_detail','تفاصيل العملية',a,true)} onMore={preview?undefined:()=>void loadAudit()} loading={auditLoading}/>;}
    const view: Record<Section, () => React.ReactNode> = {history:()=> <MemberHistory data={data} preview={preview} onDetail={row=>open('audit_detail','تفاصيل السجل',row,true)}/>,helpers:()=> <RankDirectory data={data} group="helpers" preview={preview} open={open}/>,moderators:()=> <RankDirectory data={data} group="moderators" preview={preview} open={open}/>,points:()=> <PointsPanel data={data} manage={manage} open={open}/>, personal, team, reports, accounts, members, shifts, requests, discipline, meetings, notifications, profile, settings: settingsView, rules: rulesView, audit, imports: () => <ImportPanel data={data} preview={preview} onComplete={() => void refresh()} onVerify={() => open('verify', 'تأكيد هويتك')}/> };
    const allowedSection = section === 'profile' || section === 'notifications' || nav.some(n => n.section === section && n.allowed);
    const activeSection = allowedSection ? section : 'personal';
    const row = dialog?.row ?? {};const linkedMember=data.members.find(m=>m.id===linkedStaff);
    let fields: Field[] = [];
    let submitLabel = 'حفظ وتوثيق';
    if (dialog?.kind === 'report') {
        fields = [selectMember(String(row.staff_id ?? member.id)), field('report_type', 'نوع التقرير', 'select', String(row.report_type ?? 'daily'), { options: [{ value: 'daily', label: 'لقطة يومية' }, { value: 'weekly', label: 'ملخص أسبوعي' }] }), field('ticket_mode', 'معنى عدد التذاكر', 'select', String(row.ticket_mode ?? 'week_to_date'), { options: [{ value: 'week_to_date', label: 'إجمالي الأسبوع حتى وقت التقرير' }, { value: 'daily_count', label: 'عدد هذا اليوم فقط' }] }), field('measured_at', 'وقت القياس · السعودية', 'datetime-local', localDateTime(String(row.measured_at ?? (archived ? period + 'T19:00:00Z' : new Date().toISOString())))), field('tickets', 'التذاكر', 'number', row.tickets as number, { min: 0, max: 100000, step: 1 }), field('hours', 'إجمالي ساعات الأسبوع', 'number', row.hours as number, { min: 0, max: 168, step: .01 }), field('rating', 'التقييم / 5', 'number', row.rating as number, { min: 0, max: 5, step: .01 }), field('complaints', 'الشكاوى الأسبوعية', 'number', row.complaints as number, { min: 0, step: 1, required: false }), field('requests_done', 'الطلبات المكتملة', 'number', row.requests_done as number, { min: 0, step: 1, required: false }), field('messages', 'رسائل SN.Helper', 'number', row.messages as number, { min: 0, step: 1, required: false }), field('source', 'مصدر الأرقام', 'text', String(row.source ?? 'إدخال يدوي موثق')), field('publish', 'نشر الإحصائيات بعد الحفظ', 'checkbox', row.status ? row.status === 'published' : true)];
        if (row.status === 'published')
            fields.push(field('correction_reason', 'سبب التصحيح', 'textarea'));
        submitLabel = 'حفظ الإحصائيات';
    }
    else if (dialog?.kind === 'approve_account') {
        fields = [field('decision', 'قرار المراجعة', 'select', approvalDecision, { options: [{ value: 'active', label: 'اعتماد الحساب' }, { value: 'rejected', label: 'عدم الاعتماد' }] }), field('staff_id', 'الربط بسجل عضو موجود', 'select', linkedStaff, { required: false, options: [{ value: '', label: 'إنشاء سجل عضو بعد التحقق' }, ...memberOptions.filter(o=>!data.accounts.some(a=>a.member_id===o.value))] }), field('display_name', 'اسم الإداري', 'text', data.members.find(m=>m.id===linkedStaff)?.display_name??''), field('rank', 'رتبة اللعبة', 'select', data.members.find(m=>m.id===linkedStaff)?.rank??'helper', { options: rankOptions }), field('joined_at', 'تاريخ الانضمام للفريق', 'date', data.members.find(m=>m.id===linkedStaff)?.joined_at??'')];
    }
    else if(dialog?.kind==='period')fields=[field('date','أي يوم داخل الأسبوع المطلوب','date',period)];
    else if(dialog?.kind==='account_reopen'||dialog?.kind==='review_resolve')fields=[field('reason','سبب القرار ونتيجة المراجعة','textarea')];
    else if (dialog?.kind === 'rename_account')
        fields = [field('display_name', 'الاسم الظاهر الجديد', 'text', String(row.display_name ?? ''), { max: 60 })];
    else if (dialog?.kind === 'member_create' || dialog?.kind === 'member_edit') {
        fields = [field('display_name', 'الاسم الظاهر', 'text', String(row.display_name ?? '')), ...(dialog.kind === 'member_create' ? [field('rank', 'رتبة اللعبة', 'select', 'helper', { options: rankOptions })] : []), field('joined_at', 'تاريخ الانضمام الفعلي', 'date', String(row.joined_at ?? ''))];
    }
    else if (dialog?.kind === 'rank_member')
        fields = [field('rank', 'الرتبة الجديدة', 'select', String(row.rank), { options: rankOptions }), field('reason', 'سبب التغيير', 'textarea')];
    else if (dialog?.kind === 'grant')
        fields = [field('capability', 'الصلاحية', 'select', 'approve_accounts', { options: [{ value: 'approve_accounts', label: 'إدارة الحسابات واعتماد الأعضاء' }, { value: 'manage_imports', label: 'استيراد الملفات والبيانات' }, { value: 'manage_settings', label: 'تعديل الإعدادات' }] }), field('enabled', 'تفعيل الصلاحية · إزالة التحديد لسحبها', 'checkbox', true)];
    else if (dialog?.kind === 'transfer_owner')
        fields = [field('user_id', 'المالك الجديد', 'select', '', { options: [{ value: '', label: 'اختر حسابًا فعالًا آخر' }, ...data.accounts.filter(a => a.status === 'active' && a.user_id !== account.user_id).map(a => ({ value: a.user_id, label: a.display_name ?? a.user_id }))] }), field('confirmation', 'اكتب TRANSFER OWNERSHIP لتأكيد النقل', 'text', '', { dir: 'ltr' })];
    else if (dialog?.kind === 'shift_create')
        fields = [selectMember(), field('starts_at', 'بداية المناوبة · السعودية', 'datetime-local', ''), field('ends_at', 'نهاية المناوبة · السعودية', 'datetime-local', ''), field('coverage', 'التغطية', 'select', 'assigned', { options: [{ value: 'assigned', label: 'مناوبة مجدولة' }, { value: 'needs_substitute', label: 'تحتاج بديلًا' }] }), field('notes', 'ملاحظات', 'textarea', '', { required: false })];
    else if (dialog?.kind === 'shift_cover')
        fields = [field('substitute_id', 'البديل', 'select', '', { options: memberOptions.filter(m => m.value !== row.staff_id) }), field('accepted', 'تم التحقق من قبول البديل للتغطية', 'checkbox', false)];
    else if (dialog?.kind === 'request_create')
        fields=[...(manage?[selectMember()]:[]),field('type','نوع الطلب','select','leave',{options:[{value:'leave',label:'إجازة'},{value:'excuse',label:'تبرير'}]}),field('starts_at','من · بتوقيت السعودية','datetime-local',''),field('ends_at','إلى · بتوقيت السعودية','datetime-local',''),field('notice_at','وقت إرسال الطلب في Discord','datetime-local',localDateTime()),field('discord_url','رابط رسالة Discord','text','',{dir:'ltr'}),field('reason','السبب','textarea',''),field('substitute_id','البديل للتبرير','select','',{required:false,options:[{value:'',label:'اختر عند التبرير'},...memberOptions.filter(m=>m.value!==member.id)]}),field('substitute_accepted','البديل وافق على التغطية','checkbox',false)];
    else if (dialog?.kind === 'request_decide')
        fields = [field('reason', row.decision === 'rejected' ? 'سبب الرفض' : 'ملاحظة القرار', 'textarea', '', { required: row.decision === 'rejected' }), ...(row.type === 'excuse' && row.decision === 'approved' ? [field('substitute_accepted', 'ثبت قبول البديل للتغطية', 'checkbox', row.substitute_accepted === true)] : [])];
    else if (dialog?.kind === 'flags_baseline')
        fields = [selectMember(), field('total', 'الإجمالي التراكمي الموثق', 'number', undefined, { min: 0, max: 10000, step: 1 }), field('measured_at', 'وقت القياس · السعودية', 'datetime-local', localDateTime()), field('reason', 'سبب المراجعة', 'textarea'), field('source', 'المصدر المعتمد', 'text')];
    else if (dialog?.kind === 'flag_add' || dialog?.kind === 'discipline_add')
        fields = [selectMember(), ...(dialog.kind === 'flag_add' ? [field('amount', 'عدد الفلاجات المثبتة', 'number', 1, { min: 1, max: 100, step: 1 })] : [field('kind', 'نوع القرار', 'select', 'warning', { options: [{ value: 'warning', label: 'تحذير' }, { value: 'reprimand', label: 'توبيخ مباشر' }, { value: 'dismissal', label: 'فصل بقرار موثق' }, { value: 'blacklist', label: 'فصل مع Blacklist' }] })]), field('occurred_at', 'وقت الواقعة · السعودية', 'datetime-local', localDateTime()), field('reason', 'السبب', 'textarea'), field('source', 'مصدر الواقعة أو القرار', 'text')];
    else if (['flag_void', 'discipline_void', 'training_open'].includes(dialog?.kind ?? ''))
        fields = [...(dialog?.kind === 'training_open' ? [selectMember(String(row.staff_id ?? member.id))] : []), field('reason', 'السبب الموثق', 'textarea')];
    else if (dialog?.kind === 'training_stage')
        fields = [field('notes', 'ملاحظات التدريب والقرار', 'textarea', '', { required: false })];
    else if (dialog?.kind === 'meeting_create')
        fields = [field('starts_at', 'موعد الاجتماع · الاثنين 22:00 السعودية', 'datetime-local', ''), field('title', 'عنوان الاجتماع', 'text', 'اجتماع الفريق الأسبوعي'), field('channel_url', 'رابط القناة', 'text', data.settings.meeting_channel, { required: false })];
    else if (dialog?.kind === 'attendance')
        fields = [selectMember(), field('status', 'الحضور', 'select', 'present', { options: [{ value: 'present', label: 'حاضر' }, { value: 'late', label: 'متأخر' }, { value: 'absent', label: 'غائب' }, { value: 'excused', label: 'بتبرير مقبول' }] }), field('note', 'الملاحظة أو التبرير', 'textarea', '', { required: false })];
    else if (dialog?.kind === 'verify')
        fields = [field('password', 'كلمة المرور الحالية', 'password')];
    else if(dialog?.kind==='self_username')fields=[field('username','اسم المستخدم الجديد','text',account.username,{dir:'ltr',max:32})];
    else if(dialog?.kind==='points_policy'){const config=data.points_config??DEFAULT_POINTS;fields=[field('max_points','الحد الأساسي للنقاط','number',config.max_points,{min:1,max:1000}),field('tickets','وزن التذاكر','number',config.tickets,{min:0,max:100}),field('hours','وزن الساعات','number',config.hours,{min:0,max:100}),field('rating','وزن التقييم','number',config.rating,{min:0,max:100}),field('tasks','وزن المهام','number',config.tasks,{min:0,max:100})];}
    else if(dialog?.kind==='points_adjust')fields=[selectMember(String(row.staff_id??member.id)),field('amount','التعديل · موجب أو سالب','number',undefined,{min:-1000,max:1000,step:.01}),field('reason','السبب','textarea')];
    else if(dialog?.kind==='points_void')fields=[field('reason','سبب الإلغاء','textarea')];
    else if (dialog?.kind === 'password')
        fields = [field('current_password', 'كلمة المرور الحالية', 'password'), field('password', 'كلمة المرور الجديدة · 6 حروف أو أكثر', 'password'), field('confirm', 'تأكيد الكلمة الجديدة', 'password')];
    else if (dialog?.kind === 'settings') {
        fields = Object.entries(RANK_LABELS).flatMap(([rank, label]) => [field('leave_' + rank, 'إجازات ' + label, 'number', data.settings.leave[rank as Rank], { min: 0, max: 31, step: 1, required: false }), field('excuse_' + rank, 'تبريرات ' + label, 'number', data.settings.excuses[rank as Rank], { min: 0, max: 31, step: 1, required: false })]);
        for (const rank of ['helper', 'senior_helper', 'moderator'] as Rank[]) {
            const g = goals(rank, data.settings)!;
            for (const [key, label] of Object.entries({ tickets: 'التذاكر', hours: 'الساعات', rating: 'التقييم', complaints: 'الشكاوى', requests: 'الطلبات', messages: 'الرسائل' })) {
                fields.push(field('goal_' + rank + '_' + key, label + ' · ' + RANK_LABELS[rank], 'number', g[key as keyof typeof g], { min: 0, max: key === 'rating' ? 5 : key === 'hours' ? 168 : 100000, step: key === 'rating' || key === 'hours' ? .01 : 1, required: ['tickets', 'hours', 'rating'].includes(key) }));
            }
        }
        fields.push(field('meeting_channel', 'قناة الاجتماع', 'text', data.settings.meeting_channel, { required: false }), field('leave_channel', 'قناة الإجازات', 'text', data.settings.leave_channel, { required: false }), field('excuse_channel', 'قناة التبريرات', 'text', data.settings.excuse_channel, { required: false }));
    }
    if (dialog?.kind === 'approve_account' && approvalDecision === 'rejected')
        fields = fields.filter(f => f.name === 'decision');
    if(dialog?.kind==='report'&&row.id)fields=fields.map(f=>['staff_id','report_type'].includes(f.name)?{...f,disabled:true}:f);
    if(dialog?.kind==='approve_account'&&linkedMember)fields=fields.map(f=>['display_name','rank','joined_at'].includes(f.name)?{...f,disabled:true}:f);
    async function submitModal(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!dialog || busy)
            return;
        setError('');
        const f = new FormData(event.currentTarget);
        let payload: Record<string, unknown> = Object.fromEntries(f.entries());
        const kind = dialog.kind;if(kind==='period'){changePeriod(weekDate(new Date(String(f.get('date'))+'T12:00:00Z')));setDialog(null);return;}if(kind==='account_reopen')payload.user_id=row.user_id;if(kind==='review_resolve')payload.id=row.id;
        try {
            if (['verify', 'password'].includes(kind)) {
                await authAction(kind, payload);
                return;
            }
            if (kind === 'logout_all') {
                await authAction('logout', { all: true });
                return;
            }
            if (kind === 'report') {
                payload = { ...payload, staff_id: f.get('staff_id')??row.staff_id,report_type:f.get('report_type')??row.report_type, measured_at: saudiDateTime(String(f.get('measured_at'))), tickets: requiredNumber(f, 'tickets'), hours: requiredNumber(f, 'hours'), rating: requiredNumber(f, 'rating'), complaints: nullableNumber(f, 'complaints'), requests_done: nullableNumber(f, 'requests_done'), messages: nullableNumber(f, 'messages'), publish: f.get('publish') === 'on', ...(row.version ? { report_id:row.id,expected_version: row.version } : {}) };
                const attachment = f.get('attachment');
                delete payload.attachment;
                if (!preview && attachment instanceof File && attachment.size) {
                    setBusy(true);
                    const upload = new FormData();
                    upload.set('file', attachment);
                    try {
                        const r = await fetch('/api/files', { method: 'POST', body: upload });
                        const out = await r.json() as {
                            id?: string;
                            error?: string;
                        };
                        if (!r.ok)
                            throw new Error(out.error ?? 'تعذر حفظ المرفق');
                        payload.source_file = out.id;
                    }
                    finally {
                        setBusy(false);
                    }
                }
            }
            if (kind === 'approve_account')
                payload = { ...payload, user_id: row.user_id,display_name:f.get('display_name')??linkedMember?.display_name,rank:f.get('rank')??linkedMember?.rank,joined_at:f.get('joined_at')??linkedMember?.joined_at, staff_id: f.get('staff_id') || null, approve_accounts: f.get('approve_accounts') === 'on' };
            if (['rename_account', 'account_status', 'recovery_issue', 'grant'].includes(kind))
                payload = { ...payload, user_id: row.user_id };
            if (kind === 'account_status')
                payload.status = row.status;
            if(kind==='points_policy')payload={config:{max_points:requiredNumber(f,'max_points'),tickets:requiredNumber(f,'tickets'),hours:requiredNumber(f,'hours'),rating:requiredNumber(f,'rating'),tasks:requiredNumber(f,'tasks')}};
            if(kind==='points_adjust')payload={...payload,period_start:period,amount:requiredNumber(f,'amount')};
            if(kind==='points_void')payload.id=row.id;
            if (kind === 'grant')
                payload.enabled = f.get('enabled') === 'on';
            if (['member_edit', 'rank_member'].includes(kind))
                payload.staff_id = row.id;
            if (['shift_create', 'request_create', 'meeting_create'].includes(kind)) {
                for (const key of ['starts_at', 'ends_at', 'notice_at'])
                    if (f.has(key))
                        payload[key] = saudiDateTime(String(f.get(key)));
            }
            if (kind === 'request_create')
                payload = { ...payload,staff_id:manage?f.get('staff_id'):member.id,source:'Discord', substitute_id: f.get('substitute_id') || null, substitute_accepted: f.get('substitute_accepted') === 'on' };
            if (kind === 'shift_cover')
                payload = { ...payload, id: row.id, accepted: f.get('accepted') === 'on' };
            if (kind === 'request_decide')
                payload = { ...payload, id: row.id, decision: row.decision, substitute_accepted: f.get('substitute_accepted') === 'on' };
            if (kind === 'flags_baseline') {
                payload.measured_at = saudiDateTime(String(f.get('measured_at')));
                payload.total = requiredNumber(f, 'total');
            }
            if (['flag_add', 'discipline_add'].includes(kind)) {
                payload.occurred_at = saudiDateTime(String(f.get('occurred_at')));
                if (kind === 'flag_add')
                    payload.amount = requiredNumber(f, 'amount');
            }
            if (['flag_void', 'discipline_void', 'training_stage'].includes(kind))
                payload.id = row.id;
            if (kind === 'training_stage')
                payload.stage = row.stage;
            if (kind === 'attendance')
                payload.meeting_id = row.meeting_id;
            if (kind === 'confirm_requests')
                payload = { confirmed: row.confirmed,expected_target:row.expected_target, period_start: period };
            if (kind === 'settings') {
                const leave = { ...data.settings.leave }, excuses = { ...data.settings.excuses };
                for (const rank of Object.keys(RANK_LABELS) as Rank[]) {
                    leave[rank] = nullableNumber(f, 'leave_' + rank);
                    excuses[rank] = nullableNumber(f, 'excuse_' + rank);
                }
                const targets = { ...data.settings.goals };
                for (const rank of ['helper', 'senior_helper', 'moderator'] as Rank[]) {
                    const g = { ...goals(rank, data.settings)! };
                    for (const key of Object.keys(g) as (keyof typeof g)[])
                        g[key] = nullableNumber(f, 'goal_' + rank + '_' + key) as never;
                    targets[rank] = g;
                }
                payload = { config: { ...data.settings, goals: targets, leave, excuses, meeting_channel: f.get('meeting_channel'), leave_channel: f.get('leave_channel'), excuse_channel: f.get('excuse_channel') } };
            }
            await command(kind, payload, kind === 'recovery_issue');
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'بيانات غير صالحة');
        }
    }
    return <div className="workspace"><aside ref={sidebarRef} role={compact?'dialog':undefined} aria-label="مساحات العمل" aria-modal={compact&&navOpen?true:undefined} aria-hidden={compact&&!navOpen?true:undefined} inert={compact&&!navOpen} id="sidebar" className={'sidebar' + (navOpen ? ' open' : '')}><button className="sidebar-close icon-button" aria-label="إغلاق القائمة" onClick={() => setNavOpen(false)}>{icon(X)}</button><a className="brand" href="/app"><img src="/assets/chico.png" alt="شيكو" width="47" height="44"/><div><strong dir="ltr">CHICO <span>ADMINS</span></strong><small>General Team</small></div></a><div className="sidebar-section-label">مساحة العمل</div><nav className="side-nav" aria-label="التنقل الرئيسي">{nav.filter(n => n.allowed).map(n => <span className="nav-entry" key={n.section}>{['personal','reports','members'].includes(n.section)&&<span className="nav-group-label">{n.section==='personal'?'مساحتي':n.section==='reports'?'إدارة العمل':'إدارة الفريق والصلاحيات'}</span>}<button key={n.section} className={'nav-item' + (activeSection === n.section ? ' active' : '')} onClick={() => navigate(n.section)} aria-current={activeSection === n.section ? 'page' : undefined}>{icon(n.Icon)}<span>{n.label}</span>{n.count ? <span className="subtle-count">{n.count}</span> : null}{activeSection === n.section && <i className="active-marker"/>}</button></span>)}</nav><div className="sidebar-bottom"><div className="server-mark"><img src="/assets/onestate.jpg" alt="OneState" width="43" height="43"/><div><strong dir="ltr">ONE STATE</strong><small>General Team</small></div><span className="server-dot"/></div><button className="account-button" onClick={() => navigate('profile')}><span className="account-icon">{icon(Shield)}</span><span><strong>{member.display_name}</strong><small>{account.owner ? 'مالك الموقع' : RANK_LABELS[member.rank]}</small></span>{icon(Settings)}</button></div></aside>{navOpen && <button className="nav-scrim" aria-label="إغلاق القائمة" onClick={() => setNavOpen(false)}/>}
  <div className="system-workspace-content"><header id="topbar" className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="فتح القائمة" onClick={() => setNavOpen(true)} aria-expanded={navOpen} aria-controls="sidebar">{icon(Menu)}</button><span dir="ltr">Chico Admins</span><b>/</b><span>{titles[activeSection]}</span></div><div className="top-actions">{preview && <span className="preview-label"><i />معاينة</span>}<button className="icon-button" onClick={() => void refresh()} disabled={refreshing} aria-label="تحديث البيانات">{icon(RefreshCw)}</button><button className={'icon-button notification-button'+(unread?' has-unread':'')} onClick={()=>navigate('notifications')} aria-label={unread?unread+' إشعار غير مقروء':'التنبيهات'}>{icon(Bell)}{unread>0&&<span className="notification-count">{unread>99?'99+':unread}</span>}</button><button className="role-pill" onClick={() => navigate('profile')}>{icon(Shield)}<span dir="ltr">{account.owner ? 'Owner' : RANK_LABELS[member.rank]}</span>{icon(ChevronDown)}</button></div></header>
  <main id="main" className="main" tabIndex={-1}><CommandBanner title={titles[activeSection]} section={activeSection} manage={manage} onNavigate={navigate}/>
  <div className="period-bar"><div className="period-group"><label className="period-picker">{icon(CalendarDays)}<select aria-label="الفترة الأسبوعية" value={preview ? initial.period : period} onChange={e => changePeriod(e.target.value)}>{(+new Date(period)<+new Date(weeklyPeriod().start)-15*7*86400000||period>weekDate())&&<option value={period}>{weeklyPeriod(new Date(period+'T12:00:00Z')).label}</option>}{Array.from({ length: 16 }, (_, i) => { const start = new Date(weeklyPeriod().start); start.setUTCDate(start.getUTCDate() - i * 7); const p = weeklyPeriod(start); return <option key={p.start} value={p.start.slice(0, 10)}>{p.label}</option>; })}</select>{icon(ChevronDown)}</label><button className="icon-button" aria-label="اختيار أسبوع من الأرشيف" onClick={()=>open('period','اختيار فترة من الأرشيف')}>{icon(History)}</button><Badge kind={archived ? 'neutral' : 'success'}>{archived ? 'أسبوع سابق' : 'الأسبوع الحالي'}</Badge><span className="period-note">بتوقيت السعودية · يبدأ الاثنين 03:00</span></div><span className="update-time">{preview ? 'بيانات توضيحية منفصلة عن الإنتاج' : refreshing ? 'جارٍ تحديث البيانات' : 'آخر بيانات محفوظة'}</span></div>
  {archived&&<Notice kind="neutral">الأداء وأهدافه تخص الأسبوع المختار. الأرصدة والفلاجات والمناوبات تعرض حالتها الحالية بوضوح.</Notice>}{loadError&&<Notice kind="warning">{loadError} · البيانات الظاهرة من آخر تحديث ناجح.</Notice>}{refreshing&&<div className="loading-line" role="status" aria-label="جارٍ تحديث البيانات"/>}{error && !dialog && <p className="auth-error" role="alert">{error}</p>}<div key={activeSection} className="view-enter" aria-busy={refreshing}>{view[activeSection]()}</div><footer className="page-footer"><span dir="ltr">Chico Admins · General Team</span><span>{preview ? 'نسخة عرض ببيانات تجريبية' : 'آخر تحديث للعرض · ' + new Intl.DateTimeFormat('ar-EG', { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit' }).format(new Date(updatedAt))}</span></footer></main></div>
  <nav id="mobileNav" className="mobile-nav" aria-label="التنقل على الهاتف"><button className={activeSection === 'personal' ? 'active' : ''} onClick={() => navigate('personal')}>{icon(UserRound)}<span>متابعتي</span></button>{manage && <button className={activeSection === 'team' ? 'active' : ''} onClick={() => navigate('team')}>{icon(Grid2X2)}<span>إدارة الفريق</span></button>}<button className={activeSection === 'reports' ? 'active' : ''} onClick={() => navigate('reports')}>{icon(ChartNoAxesColumn)}<span>التقارير</span></button><button onClick={() => setNavOpen(true)}>{icon(Menu)}<span>المزيد</span></button></nav>
  {toast && <div className="toast" role="status">{icon(toast.startsWith('تم')?Check:CircleHelp)}{toast}</div>}
  {dialog && <Modal title={dialog.title} onClose={() => { setDialog(null); setError(''); }} wide={dialog.wide}>
   {dialog.kind === 'audit_detail' ? <div className="system-audit-detail"><p><DateText value={String(row.created_at)}/></p><h3>قبل التغيير</h3><AuditValues value={row.before_data}/><h3>بعد التغيير</h3><AuditValues value={row.after_data}/></div> : <form onSubmit={submitModal} onChange={e => { const target = e.target; if(target instanceof HTMLSelectElement&&target.name==='staff_id'&&dialog.kind==='approve_account')setLinkedStaff(target.value);if (target instanceof HTMLSelectElement && target.name === 'decision')
                setApprovalDecision(target.value); }}>
    {dialog.kind === 'approve_account' && <Notice>اسم الدخول: <b dir="ltr">{String(row.username ?? '')}</b>. راجع العضوية قبل الاعتماد؛ اسم الدخول يقدر العضو يعدله من حسابه. عند اختيار عضو موجود يُربط الحساب بسجله كما هو؛ تعديل الاسم أو الرتبة عملية منفصلة.</Notice>}
    {dialog.kind === 'report' && <Notice>الساعات والتقييم لقطات للأسبوع؛ لا تُجمع يوميًا. عند اختيار الملخص الأسبوعي تكون التذاكر إجمالي الأسبوع.</Notice>}
    {dialog.kind === 'confirm_requests' && <Notice>{row.confirmed ? 'تؤكد إكمال '+(effectiveGoals(data,member)?.requests??'—')+' طلبًا خلال الفترة المختارة. يحفظ الهدف والسياسة مع هذا الإقرار الذاتي.' : 'سيُلغى الإقرار الذاتي لهذه الفترة مع حفظ أثر العملية.'}</Notice>}
    {dialog.kind === 'account_status' && <Notice>{row.status === 'disabled' ? 'تعطيل الحساب يلغي جلساته ويمنع وصوله إلى البيانات، مع بقاء التاريخ.' : 'إعادة التفعيل تتيح الدخول بالصلاحيات المرتبطة بالحساب.'}</Notice>}
    {dialog.kind === 'rank_member' && <Notice>تتغير الصلاحيات فورًا. التقارير السابقة تحتفظ بالرتبة المسجلة وقت القياس.</Notice>}
    {dialog.kind === 'recovery_issue' && <Notice>تحقق من هوية العضو عبر المسار المعتمد قبل إصدار الرمز. الرمز يعمل مرة واحدة خلال 15 دقيقة، ولا تحتاج لمعرفة كلمة مرور العضو.</Notice>}
    {dialog.kind === 'transfer_owner' && <Notice kind="warning">ستنتقل ملكية الموقع إلى الحساب المختار وتفقد صلاحيات المالك بعد العملية. رتبة اللعبة لا تتغير.</Notice>}
    {dialog.kind === 'logout_all' && <Notice>ستُلغى جلساتك على كل الأجهزة، وستحتاج إلى تسجيل الدخول مرة أخرى.</Notice>}
    <FormFields key={dialog.kind==='approve_account'?linkedStaff:dialog.kind} fields={fields}/>{dialog.kind === 'report'&&manage && <label className="system-field system-full"><span>الملف المصدر · اختياري</span><input name="attachment" type="file" accept=".xlsx,.csv"/><small>جدول عمل حتى 4 ميجابايت؛ تزال الحقول والبيانات الوصفية غير المطلوبة قبل الحفظ.</small></label>}{error && <p className="auth-error" role="alert">{error}</p>}{recoveryToken && <div className="system-recovery-token"><strong>رمز الاستعادة · لمرة واحدة</strong><code dir="ltr">{recoveryToken}</code><p>شارك الرمز مع العضو بعد التحقق من هويته، ولا تحفظه في سجل عام.</p><button className="button outline small" type="button" onClick={() => navigator.clipboard.writeText(recoveryToken).then(() => notify('نُسخ الرمز.')).catch(() => setError('تعذر النسخ؛ يمكنك تحديد الرمز ونسخه يدويًا.'))}>نسخ الرمز</button></div>}
    {!recoveryToken && <div className="form-footer"><span>{preview ? 'معاينة للواجهة؛ لن تحفظ العملية.' : 'راجع البيانات قبل الحفظ.'}</span><button className="button gold" disabled={busy} type="submit">{busy ? 'جارٍ الحفظ…' : dialog.kind === 'verify' ? 'تحقق ومتابعة' : submitLabel}{icon(Check)}</button></div>}
   </form>}
  </Modal>}
 </div>;
}
