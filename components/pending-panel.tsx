'use client';
import {useEffect,useState} from 'react';
import {Crown,ShieldCheck,Clock3,LogOut,RefreshCw} from 'lucide-react';
import type {Account} from '@/lib/domain/types';
export default function PendingPanel({account}:{account:Account}){
 const [status,setStatus]=useState(account.status);const [error,setError]=useState('');
 async function refresh(){if(document.visibilityState==='hidden')return;try{const r=await fetch('/api/me',{cache:'no-store'});const d=await r.json() as {error?:string;account:Account};if(r.status===401){window.location.assign('/');return;}if(!r.ok)throw new Error(d.error);setError('');setStatus(d.account.status);if(d.account.status==='active')window.location.reload();}catch(e){setError(e instanceof Error?e.message:'تعذر تحديث الحالة');}}
 useEffect(()=>{const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[]);
 async function logout(){try{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}finally{window.location.assign('/');}}
 return <main className="auth-page" id="main"><div className="auth-city" aria-hidden="true"/><header className="auth-top"><a className="auth-brand" href="/"><img src="/assets/chico.png" width="43" height="43" alt="شيكو"/><span dir="ltr"><strong>Chico Admins</strong><small>General Team</small></span></a></header>
 <section className="pending-card auth-card"><div className="auth-card-kicker" dir="ltr"><Crown size={16}/> Chico Admins · ACCOUNT STATUS</div><div className="pending-icon"><Clock3 size={34}/></div><h1>{status==='pending'?'حسابك بانتظار الاعتماد':'تمت مراجعة حسابك'}</h1><p>{status==='pending'?'تم إنشاء حسابك بنجاح. سيُراجع Responsible عضويتك ويحدد صلاحياتك قبل الوصول إلى بيانات الفريق.':'تواصل مع المسؤول لمراجعة حالة الحساب.'}</p><div className="pending-user"><span>اسم الدخول</span><strong dir="ltr">{account.username}</strong><ShieldCheck size={18}/></div>
 <ol className="pending-steps"><li className="done">إنشاء الحساب</li><li className={status==='pending'?'current':''}>مراجعة العضوية والصلاحيات</li><li>تفعيل المساحة</li></ol>{error&&<p className="auth-error" role="alert">{error}</p>}<div className="pending-actions"><button className="button gold" onClick={refresh}><RefreshCw size={16}/> تحديث الحالة</button><button className="button outline" onClick={logout}><LogOut size={16}/> خروج</button></div><small>تتحدث الحالة تلقائيًا؛ لا تحتاج إلى إنشاء حساب جديد.</small></section></main>;
}
