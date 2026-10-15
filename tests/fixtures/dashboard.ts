import type {DataBundle,Member,Snapshot} from '../../lib/domain/types';
import {goals,weekDate} from '../../lib/domain/rules';
// Synthetic test fixture only. Never import this module from application source.
export function previewData():DataBundle{
 const period=weekDate();const now=Date.now();const iso=(offset:number)=>new Date(now+offset*3600000).toISOString();
 const members:Member[]=[
  {id:'demo-01',display_name:'قائد المتابعة',rank:'moderator',joined_at:'2025-06-01',game_status:'active',flags_reviewed:true},
  {id:'demo-02',display_name:'عضو ألف',rank:'helper',joined_at:'2026-08-14',game_status:'active',flags_reviewed:true},
  {id:'demo-03',display_name:'عضو باء',rank:'senior_helper',joined_at:'2026-05-19',game_status:'active',flags_reviewed:true},
  {id:'demo-04',display_name:'عضو جيم',rank:'moderator',joined_at:'2026-02-10',game_status:'active',flags_reviewed:true},
  {id:'demo-05',display_name:'عضو دال',rank:'helper',joined_at:'2026-07-23',game_status:'training',flags_reviewed:true},
  {id:'demo-06',display_name:'عضو هاء',rank:'helper',joined_at:'2026-09-03',game_status:'active'},
  {id:'demo-07',display_name:'مسؤول الفريق',rank:'responsible',joined_at:'2025-01-01',game_status:'active',flags_reviewed:true}
 ];
 const snapshots:Snapshot[]=[];
 const numbers=[[178,12.6,4.91],[103,11.4,4.87],[126,14.2,4.92],[164,13.1,4.89],[72,8.5,4.79]];
 members.slice(0,5).forEach((m,i)=>{const [tickets,hours,rating]=numbers[i];for(let d=0;d<3;d++){const measured=+new Date(period+'T00:00:00Z')+(d*24+18)*3600000;if(measured>now)continue;snapshots.push({id:'demo-report-'+i+'-'+d,staff_id:m.id,period_start:period,measured_at:new Date(measured).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:Math.round(tickets*(d+1)/3),hours:Math.round(hours*(d+1)/3*100)/100,rating,complaints:m.rank==='moderator'?13:null,requests_done:m.rank==='moderator'?20:null,messages:m.rank==='senior_helper'?74:null,status:'published',source:'قيم توضيحية لمراجعة الواجهة',created_by:'demo-account',version:1,rank_at_measurement:m.rank,policy_version:1,target_snapshot:goals(m.rank)});}});
 return {
  points:{base:92.4,total:97.4,adjustment:5,max:100},points_config:{max_points:100,tickets:40,hours:25,rating:20,tasks:15},member_scores:members.map((m,i)=>({staff_id:m.id,score:{base:92.4-i*3,total:97.4-i*3,adjustment:5,max:100}})),point_adjustments:[{id:'demo-adjust',staff_id:'demo-01',period_start:period,amount:5,reason:'تغطية مناوبة إضافية',status:'active',created_at:iso(-3)}],leaderboard:{helpers:[members[2],members[1],members[4]].map((m,i)=>({staff_id:m.id,display_name:m.display_name,rank:m.rank,points:96.8-i*5,position:i+1,has_avatar:false})),moderators:[members[0],members[3]].map((m,i)=>({staff_id:m.id,display_name:m.display_name,rank:m.rank,points:97.4-i*4,position:i+1,has_avatar:false}))},
  account:{user_id:'demo-account',username:'design.preview',status:'active',member:members[0],owner:true,capabilities:[],must_change_password:false},period,members,snapshots,
  flags:[{id:'demo-flag-1',staff_id:'demo-04',occurred_at:iso(-60),source:'سجل توضيحي',reason:'مراجعة إجرائية',amount:8,status:'verified'},{id:'demo-flag-2',staff_id:'demo-05',occurred_at:iso(-55),source:'سجل توضيحي',reason:'تدريب على إجراءات الفريق',amount:10,status:'verified'},{id:'demo-flag-3',staff_id:'demo-01',occurred_at:iso(-75),source:'سجل توضيحي',reason:'ملاحظة متابعة',amount:2,status:'verified'}],discipline:[],
  training:[{id:'demo-training',staff_id:'demo-05',stage:'awaiting_return',reason:'اكتمل التدريب وبانتظار اعتماد العودة.',notes:'مراجعة المسؤول قبل استئناف العمل.',opened_at:iso(-50),returned_at:null}],
  shifts:[{id:'demo-shift-1',staff_id:'demo-01',starts_at:iso(14),ends_at:iso(18),substitute_id:null,coverage:'assigned',notes:'الفترة المسائية'},{id:'demo-shift-2',staff_id:'demo-02',starts_at:iso(19),ends_at:iso(23),substitute_id:null,coverage:'needs_substitute',notes:'بانتظار تغطية بديل'}],
  requests:[{id:'demo-request',staff_id:'demo-03',type:'leave',starts_at:iso(48),ends_at:iso(72),notice_at:iso(-3),units:1,reason:'طلب إجازة للمراجعة',source:'طلب توضيحي',substitute_id:null,substitute_accepted:false,discord_url:'https://discord.com/channels/123456/234567/345678',status:'pending',decision_reason:null,created_at:iso(-3)}],meetings:[],attendance:[],
  notifications:[{id:'demo-notification',title:'نسخة مراجعة التصميم',body:'جميع الأسماء والأرقام هنا توضيحية. إعداد حسابات الإنتاج يتم بعد ربط قاعدة البيانات.',link:'/preview',read_at:null,created_at:iso(-1)}],
  pending_accounts:[{user_id:'demo-pending',username:'new.member',status:'pending',created_at:iso(-2)}],accounts:[{user_id:'demo-account',member_id:'demo-01',username:'design.preview',display_name:members[0].display_name,rank:'moderator',status:'active',created_at:iso(-100)},{user_id:'demo-pending',username:'new.member',status:'pending',created_at:iso(-2)}],audit:[],
  balances:{month:period.slice(0,7)+'-01',leave_quota:4,leave_used:1,leave_held:0,leave_available:3,excuse_quota:4,excuse_used:1,excuse_held:1,excuse_available:3},
  settings:{goals:{helper:goals('helper')!,senior_helper:goals('senior_helper')!,moderator:goals('moderator')!},leave:{helper:3,senior_helper:3,moderator:4,administrator:null,responsible:null},excuses:{helper:4,senior_helper:4,moderator:4,administrator:null,responsible:null},meeting_channel:'',excuse_channel:'',leave_channel:''},grants:[],confirmations:[{staff_id:'demo-01',period_start:period,confirmed:true}],import_jobs:[]
 };
}
