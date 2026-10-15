'use client';
import {useRef,useState} from 'react';
import {Crown,ShieldCheck,Eye,EyeOff,ArrowLeft,LockKeyhole,UserRound,Check,LoaderCircle} from 'lucide-react';
type Mode='login'|'register'|'recover';
export default function AuthPanel({configured}:{configured:boolean}){
 const [mode,setMode]=useState<Mode>('login');const [show,setShow]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const formRef=useRef<HTMLFormElement>(null);

 function switchMode(value:Mode){setMode(value);setError('');setMessage('');formRef.current?.reset();}
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;setError('');setMessage('');setBusy(true);const form=new FormData(event.currentTarget);
  const body=mode==='recover'?{token:form.get('token'),password:form.get('password'),confirm:form.get('confirm')}:{username:form.get('username'),password:form.get('password'),...(mode==='register'?{confirm:form.get('confirm')}:{remember:form.get('remember')==='on'})};
  try{const response=await fetch('/api/'+mode,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json() as {error?:string;message?:string};if(!response.ok)throw new Error(result.error??'تعذر إتمام الطلب');if(mode==='recover'){setMessage(result.message??'تغيرت كلمة المرور.');formRef.current?.reset();setMode('login');}else window.location.assign('/app');}
  catch(e){setError(e instanceof Error?e.message:'تعذر الاتصال. حاول مرة أخرى.');}finally{setBusy(false);}
 }
 return <main id="main" className="auth-page"><div className="auth-city" aria-hidden="true"/><div className="auth-grain" aria-hidden="true"/>
  <header className="auth-top"><a href="/" className="auth-brand"><img src="/assets/chico.png" width="45" height="45" alt="شعار شيكو"/><span dir="ltr"><strong>Chico <b>Admins</b></strong><small>General Team</small></span></a><span className="auth-top-note"><ShieldCheck size={15}/> فريق الإدارة</span></header>
  <div className="auth-center"><section className="auth-story"><div className="auth-kicker" dir="ltr"><Crown size={21}/> GENERAL TEAM</div><h1>Chico Admins<br/><span>General Team</span></h1><p>أداءك، نقاطك، وطلباتك.<br/>كلها في مكان واحد.</p><div className="auth-story-rule"/><div className="auth-story-meta"><img src="/assets/onestate.jpg" width="36" height="36" alt="OneState"/><span dir="ltr"><strong>ONE STATE RP</strong><small>CHICO · MIDDLE EAST</small></span></div></section>
   <section className="auth-card" aria-labelledby="auth-title"><div className="auth-card-kicker" dir="ltr">GENERAL TEAM</div>
    <div className="auth-card-title"><span className="auth-shield"><ShieldCheck size={25}/></span><div><h2 id="auth-title">{mode==='login'?'أهلًا بعودتك':mode==='register'?'حساب جديد':'استعادة الوصول'}</h2><p>{mode==='login'?'سجل الدخول لمتابعة أسبوعك.':mode==='register'?'أنشئ حسابك، ثم انتظر اعتماد المسؤول.':'اختر كلمة مرور جديدة باستخدام رمز المسؤول.'}</p></div></div>
    {!configured&&<div className="setup-note"><ShieldCheck size={19}/><div><strong>تهيئة التشغيل قيد الإعداد</strong><p>ستتاح الحسابات بعد استكمال الربط الآمن بقاعدة البيانات.</p><a href="/preview">استعراض واجهات النظام <ArrowLeft size={14}/></a></div></div>}
    <form ref={formRef} onSubmit={submit} className="auth-form">
     {mode!=='recover'?<label className="auth-field"><span>اسم الدخول <small dir="ltr">Username</small></span><div><UserRound size={17}/><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" required minLength={mode==='register'?3:1} maxLength={32} placeholder="your.username"/></div></label>:<label className="auth-field"><span>رمز الاستعادة</span><div><ShieldCheck size={17}/><input name="token" dir="ltr" required autoComplete="off" placeholder="الرمز الذي حصلت عليه من المسؤول"/></div></label>}
     <label className="auth-field"><span>{mode==='login'?'كلمة المرور':'كلمة المرور الجديدة'} <small dir="ltr">Password</small></span><div><LockKeyhole size={17}/><input name="password" type={show?'text':'password'} dir="ltr" required minLength={mode==='login'?1:6} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} placeholder="••••••"/><button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'إخفاء كلمة المرور':'إظهار كلمة المرور'}>{show?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
     {mode!=='login'&&<><p className="auth-password-note">6 حروف على الأقل</p><label className="auth-field"><span>تأكيد كلمة المرور</span><div><LockKeyhole size={17}/><input name="confirm" type={show?'text':'password'} dir="ltr" required minLength={6} maxLength={128} autoComplete="new-password" placeholder="••••••"/></div></label></>}
     {mode==='login'&&<div className="auth-options"><label><input name="remember" type="checkbox"/><span>تذكر دخولي <small dir="ltr">Save login</small></span></label><button type="button" onClick={()=>switchMode('recover')}>نسيت كلمة المرور؟</button></div>}
     {mode==='register'&&<><div className="auth-registration-note"><Check size={17}/><span>الحساب يحتاج موافقة صاحب الموقع أو Responsible.</span></div></>}
     {error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="auth-success" role="status">{message}</p>}
     <button className="button gold auth-submit" type="submit" disabled={busy||!configured}>{busy?<LoaderCircle className="spinning" size={19}/>:<>{mode==='login'?'دخول':mode==='register'?'إنشاء الحساب':'تغيير كلمة المرور'}<ArrowLeft size={18}/></>}</button>
    </form><div className="auth-switch">{mode==='login'?<>ما عندك حساب؟ <button onClick={()=>switchMode('register')}>أنشئ حسابك</button></>:<button onClick={()=>switchMode('login')}>العودة إلى تسجيل الدخول</button>}</div>
    <div className="auth-card-foot"><LockKeyhole size={13}/><span>حساب خاص بالفريق</span></div>
   </section></div><footer className="auth-footer"><span dir="ltr">Chico Admins · General Team</span><span></span></footer>
 </main>;
}
