'use client';
import {useEffect,useRef,useState} from 'react';
import type {DataBundle} from '@/lib/domain/types';
import {canManage} from '@/lib/domain/rules';
import AuditPanel from './audit-panel';
export default function MemberHistory({data,preview,onDetail}:{data:DataBundle;preview:boolean;onDetail:(row:DataBundle['audit'][number])=>void}){const[staff,setStaff]=useState(data.account.member!.id),[rows,setRows]=useState<DataBundle['audit']>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[end,setEnd]=useState(false),generation=useRef(0);const manage=canManage(data.account);
 async function load(append=false){const id=++generation.current;setBusy(true);setError('');if(preview){setRows(data.audit.filter(a=>a.target_id===staff));setBusy(false);return;}try{const before=append&&rows.length?Math.min(...rows.map(r=>r.id)):Number.MAX_SAFE_INTEGER;const response=await fetch('/api/history?staff_id='+staff+'&before='+before,{cache:'no-store'}),result=await response.json() as DataBundle['audit']&{error?:string};if(id!==generation.current)return;if(!response.ok)throw new Error(result.error??'ما قدرنا نفتح السجل');setRows(old=>append?[...old,...result]:result);setEnd(result.length<50);}catch(error){if(id===generation.current)setError(error instanceof Error?error.message:'جرّب مرة ثانية');}finally{if(id===generation.current)setBusy(false);}}
 useEffect(()=>{setRows([]);setEnd(false);void load();return()=>{generation.current++;};},[staff]);
 return <>{manage&&<section className="card system-panel"><label className="system-field"><span>سجل العضو</span><select value={staff} onChange={e=>setStaff(e.target.value)}>{data.members.map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label></section>}{error&&<p className="auth-error" role="alert">{error}</p>}<AuditPanel rows={rows} onDetail={onDetail} onMore={preview||end?undefined:()=>void load(true)} loading={busy}/></>;
}
