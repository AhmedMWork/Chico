'use client';
import { useEffect,useState } from 'react';
import { Upload, Download, FileSpreadsheet, Check, AlertTriangle } from 'lucide-react';
import { parseImportFile, suggestMember, csvCell, type ImportRow, type ParsedImport } from '@/lib/domain/imports';
import { RANK_LABELS, saudiDateTime, canPublish } from '@/lib/domain/rules';
import type { DataBundle, Rank } from '@/lib/domain/types';
import { Badge, Empty, Notice, localDateTime } from './ui';
type ImportPlanRow={index:number;operation:'create'|'update'|'unchanged'|'rejected';before:Record<string,unknown>|null;after:Record<string,unknown>};
export default function ImportPanel({ data, preview, onComplete, onVerify }: {
    data: DataBundle;
    preview: boolean;
    onComplete: () => void;
    onVerify: () => void;
}) {
    const [type, setType] = useState<'members' | 'reports'>(canPublish(data.account) ? 'reports' : 'members');
    const [file, setFile] = useState<File | null>(null);
    const [parsed, setParsed] = useState<ParsedImport | null>(null);
    const [rows, setRows] = useState<ImportRow[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [date, setDate] = useState('');
    const [mode, setMode] = useState('');
    const [defaultRank, setDefaultRank] = useState<Rank>('helper');
    const [joined, setJoined] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    const [flagsConfirmed, setFlagsConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState('');
    const [reportType,setReportType]=useState<'daily'|'weekly'>('daily');
    const [onlyErrors,setOnlyErrors]=useState(false);
    const [page,setPage]=useState(0);
    const [savedSource,setSavedSource]=useState<{id:string;hash:string}|null>(null);
    const [reviewPlan,setReviewPlan]=useState<ImportPlanRow[]|null>(null);
    const [correctionReason,setCorrectionReason]=useState('');
    useEffect(()=>{setReviewPlan(null);setConfirmed(false);},[rows,selected,date,mode,reportType,type,defaultRank,joined,flagsConfirmed]);
    async function choose(f: File,sheet?:string) { setBusy(true); setError(''); setResult(''); setConfirmed(false); setFlagsConfirmed(false);setCorrectionReason('');setFile(null);setParsed(null);setRows([]);setSelected(new Set());setDate('');setMode('');setJoined('');setSavedSource(null);setPage(0);setOnlyErrors(false); try {
        const p = await parseImportFile(f,sheet);
        setFile(f);
        setParsed(p);
        setRows(p.rows.map(row => ({ ...row, staff_id: suggestMember(row, data.members)?.id ?? row.staff_id })));
        setSelected(new Set(p.rows.filter(r => !r.warnings.some(w => w.startsWith('قيم صفرية'))).map(r => r.index)));
        if (p.sourceDate && +new Date(p.sourceDate) <= Date.now())
            setDate(localDateTime(p.sourceDate));
        else
            setDate('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'تعذر قراءة الملف');
        setParsed(null);
    }
    finally {
        setBusy(false);
    } }
    function update(index: number, id: string) { setRows(current => current.map(row => row.index === index ? { ...row, staff_id: id } : row)); }
    function downloadTemplate() { const headers = type === 'members' ? ['staff_id','display_name','rank','joined_at'] : ['staff_id', 'display_name', 'measured_at', 'tickets', 'hours', 'rating','complaints','requests_done','messages','flags_total']; const blob = new Blob(['\uFEFF' + headers.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'chico-' + type + '-template.csv'; a.click(); URL.revokeObjectURL(url); }
    async function apply() {
        if (preview) {
            setError('الاستيراد الحقيقي غير متاح في معاينة التصميم.');
            return;
        }
        if (!file || !confirmed)
            return;
        setBusy(true);
        setError('');
        setResult('');
        try {
            const chosen = rows.filter(row => selected.has(row.index));
            if (!chosen.length)
                throw new Error('اختر سجلًا واحدًا على الأقل');
            if (type === 'reports' && (!date || !mode))
                throw new Error('حدد وقت القياس ومعنى عدد التذاكر صراحةً');
            if (type === 'members' && !joined && chosen.some(r => !r.joined_at))
                throw new Error('أكمل تاريخ الانضمام للسجلات الناقصة');
            const prepared = chosen.map(row => { if (row.errors.length)
                throw new Error('أخطاء في الصف ' + row.index + ': ' + row.errors.join(' · ')); if (type === 'members')
                return { _source_row: row.index, staff_id: row.staff_id || null, display_name: row.display_name, rank: row.rank || defaultRank, joined_at: row.joined_at || joined }; if (!row.staff_id)
                throw new Error('لم يربط العضو في الصف ' + row.index); if (row.tickets == null || row.hours == null || row.rating == null)
                throw new Error('قيم ناقصة في الصف ' + row.index); return { _source_row: row.index, staff_id: row.staff_id, measured_at: row.measured_at ? new Date(row.measured_at).toISOString() : saudiDateTime(date), tickets: row.tickets, hours: row.hours, rating: row.rating, ticket_mode: reportType==='weekly'?'week_to_date':mode, report_type: reportType,complaints:row.complaints??null,requests_done:row.requests_done??null,messages:row.messages??null, flags_total: flagsConfirmed ? row.flags_total : null, source: 'استيراد مصدر تشغيلي' }; });
            let source=savedSource;
            if(!source){const upload=new FormData();upload.set('file',file);if(parsed?.sheet)upload.set('sheet',parsed.sheet);const response=await fetch('/api/files',{method:'POST',body:upload});const result=await response.json() as {error?:string;id:string;hash:string};if(!response.ok)throw new Error(result.error??'تعذر حفظ المصدر');source={id:result.id,hash:result.hash};setSavedSource(source);}
            if(!reviewPlan){const response=await fetch('/api/import-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,file_hash:source.hash,file_id:source.id,sheet:'CSV',rows:prepared,confirmed:true})});const review=await response.json() as {error?:string;plan:ImportPlanRow[]};if(!response.ok)throw new Error(review.error??'تعذر تجهيز مراجعة التغييرات');setReviewPlan(review.plan);setConfirmed(false);return;}
            if(reviewPlan.some(r=>r.operation==='rejected'))throw new Error('توجد سجلات تتجاوز صلاحية التصحيح؛ استبعدها وأعد المراجعة.');
            if(type==='reports'&&reviewPlan.some(r=>r.operation==='update')&&correctionReason.trim().length<3)throw new Error('أضف سبب تصحيح التقارير المنشورة قبل الاعتماد.');
            const reviewedRows=prepared.map(row=>{const plan=reviewPlan.find(r=>r.index===row._source_row);return type==='reports'&&plan?.after.report_id?{...row,report_id:plan.after.report_id,expected_version:plan.after.expected_version,correction_reason:correctionReason.trim()}:row;});
            const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, file_hash: source.hash, file_id: source.id,sheet: 'CSV', rows: reviewedRows, confirmed: true }) });
            const out = await r.json() as {
                error?: string;code?:string;
                result?: {
                    applied: number;
                    unchanged: number;
                    already_applied?: boolean;
                };
            };
            if (!r.ok) {
                if(out.code==='REAUTH_REQUIRED')
                    onVerify();
                throw new Error(out.error ?? 'تعذر اعتماد الدفعة');
            }
            setResult(out.result?.already_applied ? 'هذه الدفعة معتمدة سابقًا؛ لم تضاعف البيانات.' : 'تم اعتماد ' + out.result?.applied + ' سجلات؛ ' + out.result?.unchanged + ' دون تغيير.');
            onComplete();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'تعذر الاستيراد');
        }
        finally {
            setBusy(false);
        }
    }
    return <section className="card system-panel"><div className="section-heading"><div><div className="eyebrow">مراجعة قبل الاعتماد</div><h2>استيراد البيانات</h2></div><button className="button outline small" onClick={downloadTemplate}><Download className="icon"/> تنزيل القالب</button></div><Notice>لا تتضاعف الأرقام عند إعادة رفع الدفعة نفسها. يعرض الاستيراد الهوية والتاريخ ومعنى القيم للمراجعة، ويعتمد السجلات المختارة في عملية واحدة.</Notice>
 <div className="system-import-controls"><label>نوع البيانات<select value={type} onChange={e => { setType(e.target.value as 'members' | 'reports'); setConfirmed(false); setResult(''); }}><option value="reports" disabled={!canPublish(data.account)}>إحصائيات أعضاء</option><option value="members">قائمة أعضاء الفريق</option></select></label><label className="system-upload"><Upload size={24}/><strong>{file?.name ?? 'اختر ملف Excel أو CSV'}</strong><small>حتى 4 ميجابايت · 500 سجل في الدفعة</small><input type="file" accept=".xlsx,.csv" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f)
        void choose(f); }}/></label>
 {type === 'reports' ? <><label>نوع التقرير<select value={reportType} onChange={e=>{setReportType(e.target.value as 'daily'|'weekly');setConfirmed(false);}}><option value="daily">لقطة يومية</option><option value="weekly">ملخص أسبوعي نهائي</option></select></label><label>وقت القياس المقصود · السعودية<input type="datetime-local" value={date} onChange={e => setDate(e.target.value)}/></label><label>معنى عدد التذاكر<select value={mode} onChange={e => setMode(e.target.value)}><option value="">حدد معنى الرقم في المصدر</option><option value="week_to_date">إجمالي الأسبوع حتى وقت القياس</option><option value="daily_count">عدد كل يوم فقط</option></select></label></> : <><label>رتبة السجلات التي لا تحتوي رتبة<select value={defaultRank} onChange={e => setDefaultRank(e.target.value as Rank)}>{Object.entries(RANK_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>تاريخ الانضمام للسجلات الناقصة<input type="date" value={joined} onChange={e => setJoined(e.target.value)}/></label></>}</div>
 {parsed?.sheets&&parsed.sheets.length>1&&<label className="system-field"><span>ورقة العمل</span><select value={parsed.sheet} disabled={busy} onChange={e=>{if(file)void choose(file,e.target.value);}}>{parsed.sheets.map(name=><option key={name}>{name}</option>)}</select></label>}
 {parsed?.sourceDate && <Notice kind={+new Date(parsed.sourceDate) > Date.now() ? 'warning' : 'neutral'}>التاريخ المخزن في المصدر: <b dir="ltr">{parsed.sourceDate.slice(0, 10)}</b>. {+new Date(parsed.sourceDate) > Date.now() ? 'التاريخ مستقبلي؛ راجع احتمال عكس اليوم والشهر وحدد الوقت الصحيح.' : 'راجع الوقت المقصود قبل الاعتماد.'}</Notice>}
 {error && <p className="auth-error" role="alert">{error}</p>}{result && <p className="auth-success" role="status">{result}</p>}
 {rows.length ? <><ol className="import-steps"><li className="done">1 · قراءة المصدر</li><li className="current">2 · مراجعة الربط والأرقام</li><li>3 · اعتماد موثق</li></ol><div className="import-review-summary"><span>سينشأ: {rows.filter(r=>selected.has(r.index)&&!r.staff_id&&type==='members'&&!r.errors.length).length}</span><span>للمراجعة: {rows.filter(r=>selected.has(r.index)&&r.staff_id&&!r.errors.length).length}</span><span>مرفوض: {rows.filter(r=>r.errors.length).length}</span><small>تطابق التقرير أو تغييره يحسمه الخادم؛ التصحيح يحتاج معرف التقرير ونسخته وسببًا موثقًا.</small></div><div className="system-row-actions"><button className="button outline small" onClick={()=>{setOnlyErrors(v=>!v);setPage(0);}}>{onlyErrors?'عرض الكل':'الأخطاء والتحذيرات فقط'}</button><button className="button outline small" onClick={()=>{setSelected(new Set(rows.filter(r=>!r.errors.length&&!r.warnings.length).map(r=>r.index)));setConfirmed(false);}}>اختيار السليم فقط</button><button className="button outline small" onClick={()=>{const text='\uFEFF'+['source_row','display_name','errors','warnings'].join(',')+'\r\n'+rows.map(r=>[r.index,r.display_name,r.errors.join(' · '),r.warnings.join(' · ')].map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='chico-import-review.csv';a.click();URL.revokeObjectURL(url);}}>تنزيل تقرير المراجعة</button></div><div className="system-import-count"><span>{rows.length} سجلات مقروءة من {parsed?.sheet}</span><Badge kind="gold">{selected.size} مختارة</Badge></div><div className="table-scroll system-import-table"><table className="performance-table system-table"><thead><tr><th>اعتماد</th><th>الصف</th><th>الاسم في المصدر</th><th>عضو الفريق المرتبط</th><th>التذاكر</th><th>الساعات</th><th>التقييم</th><th>الفلاجات التراكمية</th><th>المهام</th><th>الأرقام الأصلية</th>{type === 'members' && <th>تاريخ الانضمام</th>}<th>مراجعة</th></tr></thead><tbody>{rows.filter(row=>!onlyErrors||row.errors.length||row.warnings.length).slice(page*25,(page+1)*25).map(row => <tr key={row.index}><td data-label="اعتماد"><input type="checkbox" checked={selected.has(row.index)} aria-label={'اختيار صف ' + row.index} onChange={e => { const next = new Set(selected); if (e.target.checked)
        next.add(row.index);
    else
        next.delete(row.index); setSelected(next); setConfirmed(false); }}/></td><td data-label="الصف">{row.index}</td><td data-label="الاسم في المصدر">{row.display_name}</td><td data-label="عضو الفريق المرتبط"><select value={row.staff_id} onChange={e => { update(row.index, e.target.value); setConfirmed(false); }} aria-label={'عضو الصف ' + row.index}><option value="">{type === 'members' ? 'إنشاء عضو جديد بعد مراجعة الهوية' : 'راجع الربط بالعضو'}</option>{data.members.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>{type === 'members' && <small>{'اسم عرض مستعار فقط'} · {row.rank ? RANK_LABELS[row.rank as Rank] : 'الرتبة المحددة أعلاه'}</small>}</td><td data-label="التذاكر" dir="ltr">{row.tickets ?? '—'}</td><td data-label="الساعات" dir="ltr">{row.hours ?? '—'}</td><td data-label="التقييم" dir="ltr">{row.rating ?? '—'}</td><td data-label="الفلاجات التراكمية" dir="ltr">{row.flags_total ?? '—'}</td><td data-label="المهام">شكاوى {row.complaints??'—'} · طلبات {row.requests_done??'—'} · رسائل {row.messages??'—'}</td><td data-label="الأرقام الأصلية"><details><summary>عرض المصدر</summary>{Object.entries(row.raw_numbers??{}).map(([k,v])=><small dir="ltr" key={k}>{k}: {v}</small>)}</details></td>{type === 'members' && <td data-label="تاريخ الانضمام"><input type="date" aria-label={'تاريخ انضمام صف ' + row.index} value={row.joined_at} readOnly={!!parsed?.rows.find(r => r.index === row.index)?.joined_at} onChange={e => { setRows(current => current.map(r => r.index === row.index ? { ...r, joined_at: e.target.value } : r)); setConfirmed(false); }}/></td>}<td data-label="مراجعة" className="source-cell">{row.errors.map(w => <small className="danger" key={w}>{w}</small>)}{row.warnings.map(w => <small key={w}>{w}</small>)}{!row.warnings.length && <Check size={16}/>}</td></tr>)}</tbody></table></div><div className="form-footer"><button className="button outline small" disabled={!page} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {page+1} · 25 سجلًا في الصفحة</span><button className="button outline small" disabled={(page+1)*25>=rows.filter(r=>!onlyErrors||r.errors.length||r.warnings.length).length} onClick={()=>setPage(p=>p+1)}>التالي</button></div>{type === 'reports' && rows.some(r => r.flags_total != null) && <label className="checkbox-row"><input type="checkbox" checked={flagsConfirmed} onChange={e => setFlagsConfirmed(e.target.checked)}/>أؤكد أن الفلاجات في هذا الملف إجماليات تراكمية موثقة؛ لا تُضاف الإجمالية كواقعة جديدة.</label>}{reviewPlan&&<section className="import-final-review"><h3>التغييرات التي ستعتمد</h3><div className="import-review-summary">{(['create','update','unchanged','rejected'] as const).map(kind=><span key={kind}>{{create:'سينشأ',update:'سيتحدث',unchanged:'دون تغيير',rejected:'مرفوض'}[kind]}: {reviewPlan.filter(r=>r.operation===kind).length}</span>)}</div>{reviewPlan.filter(r=>r.operation==='update').map(r=><details key={r.index}><summary>الصف {r.index} · عرض قبل / بعد</summary><dl className="audit-values">{Object.keys(r.before??{}).filter(k=>!['report_id','expected_version'].includes(k)).map(k=><div key={k}><dt>{{display_name:'الاسم الظاهر',rank:'الرتبة',joined_at:'الانضمام',tickets:'التذاكر',hours:'الساعات',rating:'التقييم',complaints:'الشكاوى',requests_done:'الطلبات',messages:'الرسائل',measured_at:'وقت القياس'}[k as 'tickets']??k}</dt><dd>{String(r.before?.[k]??'—')} ← {String(r.after[k]??'—')}</dd></div>)}</dl></details>)}{type==='reports'&&reviewPlan.some(r=>r.operation==='update')&&<label className="system-field"><span>سبب التصحيح الموثق</span><textarea value={correctionReason} maxLength={1000} onChange={e=>setCorrectionReason(e.target.value)}/></label>}</section>}<label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>راجعت ربط الأعضاء والتاريخ ومعنى الأرقام والسجلات الصفرية المختارة.</label><div className="form-footer"><span>السجلات غير المختارة لا تستورد.</span><button className="button gold" disabled={busy || !confirmed || preview} onClick={() => void apply()}>{busy ? 'جارٍ التحقق…' : reviewPlan?'اعتماد التغييرات المعروضة':'مراجعة التغييرات على الخادم'}<Check className="icon"/></button></div></> : <Empty text="اختر ملفًا لعرض معاينة البيانات قبل الاعتماد." detail="ملفاتك وبياناتها لا تُرفع بمجرد اختيار الملف؛ الرفع يتم عند اعتماد الدفعة."/>}
 </section>;
}
