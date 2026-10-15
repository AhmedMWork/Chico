'use client';
import {Grid2X2,UserRound} from 'lucide-react';
const descriptions:Record<string,string>={personal:'أسبوعك في نظرة واحدة.',team:'كل اللي يحتاج متابعتك.',reports:'إحصائياتك وتحديثات أدائك.',helpers:'فريق Helpers · كل اسم له دور.',moderators:'فريق Moderators · متابعة وقيادة.',requests:'إجازة أو تبرير، تابع طلبك هنا.',shifts:'مواعيدك وتغطية الفريق.',notifications:'كل جديد يخصك.',profile:'ملفك وإعدادات حسابك.',history:'كل تحديث محفوظ في سجلك.',points:'الأداء والنقاط، بشكل واضح.',accounts:'راجع الحسابات الجديدة وإدارة الوصول.',members:'أسماء الفريق ورتبهم.',discipline:'Flags، قرارات، ومتابعة التدريب.',meetings:'مواعيد الفريق والحضور.',imports:'أضف بيانات الفريق من ملفاتك.',settings:'إعدادات وسياسات الفريق.',rules:'كل اللي تحتاج تعرفه.',audit:'سجل تغييرات الإدارة.'};
export default function CommandBanner({title,section,manage,onNavigate}:{title:string;section:string;manage:boolean;onNavigate:(section:'personal'|'team')=>void}){
 return <section className="command-banner">
  <div className="banner-title"><span className="eyebrow" dir="ltr">WORKSPACE / {section==='team'?'TEAM MANAGEMENT':'CHICO ADMINS'}</span><h1 dir="auto">{title}</h1><p>{descriptions[section]??'فريقك، في مكان واحد.'}</p></div>
  {manage&&<div className="view-switch" aria-label="اختيار مساحة العمل"><button className={section==='personal'?'selected':''} onClick={()=>onNavigate('personal')} aria-pressed={section==='personal'}><UserRound size={17}/> متابعتي</button><button className={section==='team'?'selected':''} onClick={()=>onNavigate('team')} aria-pressed={section==='team'}><Grid2X2 size={17}/> Team Hub</button></div>}
 </section>;
}
