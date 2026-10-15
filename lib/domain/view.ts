import type {DataBundle,Member} from './types';
import {flagState,goals,latestPerformance,RANK_LEVEL} from './rules';
export function memberFlags(data:DataBundle,id:string){return data.flags.filter(f=>f.staff_id===id&&f.status==='verified').reduce((sum,f)=>sum+f.amount,0);}
export function memberState(data:DataBundle,member:Member){
 if(member.game_status==='dismissed')return {kind:'danger',text:'قرار فصل مسجل'};
 if(member.game_status==='training')return {kind:'danger',text:'موقوف للتدريب'};
 const returned=data.training.filter(c=>c.staff_id===member.id&&c.stage==='returned').sort((a,b)=>+new Date(b.opened_at)-+new Date(a.opened_at))[0];
 const flags=data.flags.filter(f=>f.staff_id===member.id&&f.status==='verified');
 if(returned&&!flags.some(f=>+new Date(f.occurred_at)>+new Date(returned.returned_at??returned.opened_at)))return {kind:'success',text:'نشط بعد اعتماد العودة'};
 const count=memberFlags(data,member.id);if(!member.flags_reviewed&&count<7)return {kind:'neutral',text:'الفلاجات لم تُراجع بالكامل'};return flagState(count);
}
export function performanceFor(data:DataBundle,id:string){return latestPerformance(data.snapshots.filter(r=>r.staff_id===id));}
export function effectiveGoals(data:DataBundle,member:Member,perf=performanceFor(data,member.id)){return perf?(perf.target_snapshot??goals(perf.rank_at_measurement)):'goal_for_period' in member?member.goal_for_period??null:goals(member.rank_for_period??member.rank,data.settings);}
export function flagsText(data:DataBundle,member:Member){const count=memberFlags(data,member.id);return member.flags_reviewed?String(count):count?'≥ '+count:'لم تُراجع';}
export function teamSummary(data:DataBundle){const members=data.members.filter(m=>effectiveGoals(data,m)!=null&&(!!performanceFor(data,m.id)||(m.active_for_period??m.game_status!=='dismissed')&&m.joined_at<=new Date(new Date(data.period).getTime()+6*86400000).toISOString().slice(0,10)));const active=members.map(m=>({m,p:performanceFor(data,m.id),rank:performanceFor(data,m.id)?.rank_at_measurement??m.rank_for_period??m.rank,goal:effectiveGoals(data,m)}));return {count:members.length,updated:active.filter(r=>!!r.p).length,tickets:active.reduce((sum,r)=>sum+(r.p?.tickets??0),0),target:active.reduce((sum,r)=>sum+(r.goal?.tickets??0),0),missing:active.filter(r=>!r.p).length,rows:active};}
export const STATUS_LABELS:Record<string,string>={active:'نشط',training:'موقوف للتدريب',dismissed:'فصل مسجل',cancelled:'ملغي',pending:'بانتظار الموافقة',approved:'معتمد',rejected:'مرفوض',disabled:'معطل',verified:'مثبت',voided:'ملغى',assigned:'مجدولة',needs_substitute:'تحتاج بديلًا',covered:'مغطاة',waiting_training:'بانتظار التدريب',awaiting_return:'بانتظار اعتماد العودة',returned:'عاد بعد الاعتماد',present:'حاضر',late:'متأخر',absent:'غائب',excused:'بتبرير مقبول',published:'منشور',draft:'مسودة'};
