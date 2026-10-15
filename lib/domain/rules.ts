import type { Account, Rank, Snapshot, GoalSet, Settings } from './types';
export const RANK_LABELS: Record<Rank, string> = { helper:'Helper', senior_helper:'SN.Helper', moderator:'Moderator', administrator:'Administrator · Level 3', responsible:'Responsible' };
export const RANK_LEVEL: Record<Rank, number> = {helper:1,senior_helper:1,moderator:2,administrator:3,responsible:4};
export function canPublish(account: Account): boolean { return account.status==='active' && !!account.member && account.member.game_status==='active' && RANK_LEVEL[account.member.rank]>=2; }
export function canManage(account: Account): boolean { return account.status==='active' && (account.owner || (!!account.member && account.member.rank==='responsible')); }
export function hasCapability(account:Account,name:string):boolean{return account.status==='active'&&(name==='owner'?account.owner:account.owner||account.member?.rank==='responsible');}
export function goals(rank:Rank,policy?:Settings):GoalSet|null { if(RANK_LEVEL[rank]>=3)return null;if(policy?.goals?.[rank])return policy.goals[rank]!;return {tickets:rank==='moderator'?200:120,hours:14,rating:rank==='moderator'?4.85:4.8,complaints:rank==='moderator'?15:null,requests:rank==='moderator'?20:null,messages:rank==='senior_helper'?70:null}; }
export function percentage(value:number|null|undefined,target:number|null|undefined):number|null { return value==null||target==null||target<=0?null:Math.round(value/target*100); }
export function flagState(flags:number) {return flags>=10?{kind:'danger',text:'إيقاف للتدريب'}:flags>=7?{kind:'warning',text:'متابعة مع Moderator'}:{kind:'success',text:'ضمن الحد'};}
export function weeklyPeriod(time:Date|string|number=new Date()) {
  const d=new Date(time);if(!Number.isFinite(+d))throw new Error('تاريخ غير صالح');
  // Monday 03:00 in Saudi Arabia is Monday 00:00 UTC.
  const shifted=new Date(d);
  const day=(shifted.getUTCDay()+6)%7;shifted.setUTCDate(shifted.getUTCDate()-day);shifted.setUTCHours(0,0,0,0);
  const end=new Date(+shifted+7*86400000);
  return {start:shifted.toISOString(),end:end.toISOString(),label:new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'long',timeZone:'Asia/Riyadh'}).format(shifted)+' – '+new Intl.DateTimeFormat('ar-EG',{day:'numeric',month:'long',timeZone:'Asia/Riyadh'}).format(end)};
}
export function weekDate(time:Date|string|number=new Date()):string { return weeklyPeriod(time).start.slice(0,10); }
export function isInPeriod(time:string,start:string):boolean {const t=+new Date(time),s=+new Date(start+'T00:00:00Z');return Number.isFinite(t)&&t>=s&&t<s+7*86400000;}
export function saudiDateTime(local:string):string {if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw new Error('التاريخ والوقت غير صالحين');return new Date(local+':00+03:00').toISOString();}
export function latestPerformance(rows:Snapshot[]):Snapshot|null { const published=rows.filter(r=>r.status==='published');const weekly=published.filter(r=>r.report_type==='weekly');const ordered=[...(weekly.length?weekly:published)].sort((a,b)=>+new Date(b.measured_at)-+new Date(a.measured_at)||b.version-a.version);const latest=ordered[0];if(!latest)return null;if(weekly.length||latest.ticket_mode!=='daily_count')return latest;const days=new Map<string,Snapshot>();for(const row of ordered){const day=new Date(+new Date(row.measured_at)+3*3600000).toISOString().slice(0,10);if(!days.has(day))days.set(day,row);}return {...latest,tickets:[...days.values()].reduce((sum,r)=>sum+r.tickets,0)}; }
export function normalizeUsername(username:string):string {return username.trim().toLowerCase();}
export function displayNumber(value:unknown):string {return value==null?'لم تُضف':new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(Number(value));}
