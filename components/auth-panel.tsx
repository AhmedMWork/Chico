'use client';
import {useEffect,useRef,useState} from 'react';
import {submitAuth,type AuthMode} from '@/lib/auth/client';
import {ArrowLeft,ArrowUpRight,Check,ChartNoAxesColumn,Clock3,Eye,EyeOff,LoaderCircle,LockKeyhole,ShieldCheck,UserRound,Users} from 'lucide-react';

export default function AuthPanel({configured}:{configured:boolean}){
 const [mode,setMode]=useState<AuthMode>('login');
 const [show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const formRef=useRef<HTMLFormElement>(null),inFlight=useRef(false);
 const [slow,setSlow]=useState(false);
 useEffect(()=>{if(!busy){setSlow(false);return;}const timer=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(timer);},[busy]);
 function switchMode(value:AuthMode){if(inFlight.current)return;setMode(value);setShow(false);setError('');setMessage('');formRef.current?.reset();}
 async function submit(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();if(inFlight.current||!configured)return;
  const submittedMode=mode,form=new FormData(event.currentTarget);
  const body=submittedMode==='recover'?{token:form.get('token'),password:form.get('password'),confirm:form.get('confirm')}:{username:form.get('username'),password:form.get('password'),...(submittedMode==='register'?{confirm:form.get('confirm')}:{remember:form.get('remember')==='on'})};
  inFlight.current=true;setError('');setMessage('');setSlow(false);setBusy(true);
  let navigating=false;
  try{
   const result=await submitAuth(submittedMode,body);
   if(submittedMode==='recover'){
    setMessage(result.message??'تم تغيير الـPassword. تقدر تدخل الآن.');formRef.current?.reset();setMode('login');setShow(false);
   }else{window.location.assign('/app');navigating=true;}
  }catch(e){setError(e instanceof Error?e.message:'تأكد من الاتصال وجرّب مرة ثانية.');}
  finally{if(!navigating){inFlight.current=false;setBusy(false);}}
 }

 return <main id="main" className="auth-page">
  <header className="auth-top"><a href="/" className="auth-brand"><img src="/assets/chico.png" width="44" height="44" alt="Chico"/><span dir="ltr"><strong>CHICO <b>ADMINS</b></strong><small>GENERAL TEAM</small></span></a><span className="auth-top-note" dir="ltr"><ShieldCheck size={16}/> Team portal</span></header>
  <div className="auth-center">
   <section className="auth-story" aria-label="Chico Admins · OneState RP">
    <div className="auth-kicker" dir="ltr"><span/> ONE STATE RP <i/> GENERAL TEAM</div>
    <h1 dir="ltr">CHICO<br/><span>ADMINS<span className="coral-dot">.</span></span></h1>
    <p className="auth-story-copy">فريقك. أداؤك. خطوتك الجاية.</p>
    <div className="auth-orbit" aria-hidden="true"/>
    <img className="auth-game-art" src="/assets/onestate-characters.webp" width="735" height="496" alt="فريق الشرطة من OneState RP" fetchPriority="high"/>
    <div className="auth-scene-caption"><span dir="ltr">BUILT FOR THE TEAM</span><img src="/assets/onestate.jpg" width="34" height="34" alt="OneState"/></div>
    <div className="auth-feature-row"><span><ChartNoAxesColumn size={17}/> Performance</span><span><Users size={17}/> Team</span><span><Clock3 size={17}/> Shifts</span></div>
   </section>
   <section className="auth-form-shell" aria-labelledby="auth-title">
    <div className="auth-card">
     <span className="auth-card-kicker" dir="ltr"><span className="mini-line"/> YOUR TEAM SPACE</span>
     <div className="auth-card-title"><div><h2 id="auth-title" dir="ltr">{mode==='login'?'Welcome back.':mode==='register'?'Join the team.':'Reset password.'}</h2><p>{mode==='login'?'أهلًا بعودتك، سجل دخولك وخلّك على اطلاع.':mode==='register'?'أنشئ حسابك، والتفعيل بعد موافقة Owner أو Responsible.':'خذ رمز الاستعادة من Owner أو Responsible.'}</p></div></div>
     {mode!=='recover'&&<div className="auth-mode-switch" aria-label="نوع الحساب"><button type="button" disabled={busy} aria-pressed={mode==='login'} className={mode==='login'?'selected':''} onClick={()=>switchMode('login')}>Login</button><button type="button" disabled={busy} aria-pressed={mode==='register'} className={mode==='register'?'selected':''} onClick={()=>switchMode('register')}>Create account</button></div>}
     {!configured&&<div className="setup-note"><ShieldCheck size={20}/><div><strong>قريبًا نبدأ</strong><p>التسجيل والدخول بيفتحوا بعد تفعيل الموقع.</p></div></div>}
     <noscript><p className="auth-error">فعّل JavaScript في المتصفح علشان تقدر تسجّل الدخول.</p></noscript>
     <form ref={formRef} method="post" action={"/api/"+mode} onSubmit={submit} className="auth-form" aria-busy={busy}>
      <fieldset className="auth-fields" disabled={busy||!configured}>
      {mode!=='recover'?<label className="auth-field"><span dir="ltr">Username</span><div><UserRound size={18}/><input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" required minLength={mode==='register'?3:1} maxLength={32} placeholder="your.username"/></div></label>:<label className="auth-field"><span dir="ltr">Recovery code</span><div><ShieldCheck size={18}/><input name="token" dir="ltr" required autoComplete="off" placeholder="Paste your code"/></div></label>}
      <label className="auth-field"><span dir="ltr">{mode==='recover'?'New password':'Password'}</span><div><LockKeyhole size={18}/><input name="password" type={show?'text':'password'} dir="ltr" required minLength={mode==='login'?1:6} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'} placeholder="••••••••"/><button type="button" onClick={()=>setShow(v=>!v)} aria-label={show?'إخفاء Password':'إظهار Password'} aria-pressed={show}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
      {mode!=='login'&&<><p className="auth-password-note">6 حروف على الأقل</p><label className="auth-field"><span dir="ltr">Confirm password</span><div><LockKeyhole size={18}/><input name="confirm" type={show?'text':'password'} dir="ltr" required minLength={6} maxLength={128} autoComplete="new-password" placeholder="••••••••"/></div></label></>}
      {mode==='login'&&<div className="auth-options"><label><input name="remember" type="checkbox"/><span dir="ltr">Save login</span></label><button type="button" onClick={()=>switchMode('recover')}>نسيت الـPassword؟</button></div>}
      {mode==='register'&&<div className="auth-registration-note"><Check size={17}/><span>ما نحتاج بريدك أو رقم جوالك.</span></div>}
      </fieldset>
      {busy&&<p className="auth-progress" role="status" aria-live="polite">{slow?'الاتصال أخذ شوية وقت، بننتظر رد الخدمة…':'جاري التحقق…'}</p>}
      {error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="auth-success" role="status">{message}</p>}
      <button className="button gold auth-submit" type="submit" disabled={busy||!configured}>{busy?<><LoaderCircle className="spinning" size={19}/><span>لحظة…</span></>:<><span>{mode==='login'?'دخول · Login':mode==='register'?'إنشاء حساب · Join':'حفظ الـPassword'}</span><ArrowLeft size={19}/></>}</button>
     </form>
     <div className="auth-switch">{mode==='login'?<>جديد مع الفريق؟ <button disabled={busy} onClick={()=>switchMode('register')}>أنشئ حسابك <ArrowUpRight size={15}/></button></>:<button disabled={busy} onClick={()=>switchMode('login')}><ArrowLeft size={15}/> الرجوع إلى Login</button>}</div>
     <div className="auth-card-foot"><LockKeyhole size={14}/><span>حسابك، متابعتك، وكل اللي تحتاجه.</span></div>
    </div>
   </section>
  </div>
  <footer className="auth-footer"><span dir="ltr">CHICO ADMINS <i/> GENERAL TEAM</span><span dir="ltr">ONE STATE · MIDDLE EAST</span></footer>
 </main>;
}
