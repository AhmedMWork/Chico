'use client';
import type {DataBundle} from '@/lib/domain/types';
import {RANK_LABELS,canManage} from '@/lib/domain/rules';
import {Empty} from '../ui';
import Leaderboard,{Avatar} from './leaderboard';
export default function RankDirectory({data,group,preview,open}:{data:DataBundle;group:'helpers'|'moderators';preview:boolean;open:(kind:string,title:string,row?:unknown)=>void}){
 const rows=data.members.filter(m=>group==='helpers'?['helper','senior_helper'].includes(m.rank):m.rank==='moderator'),manage=canManage(data.account);
 return <><Leaderboard data={data} group={group} preview={preview}/><section className="card system-panel rank-directory"><div className="section-heading"><h2>{group==='helpers'?'الهيلبر':'المودريتور'}</h2><span className="eyebrow">{rows.length} عضو</span></div>{rows.length?<div className="rank-directory-list">{rows.map(m=><article key={m.id}><Avatar member={manage?m:{...m,has_avatar:false,avatar_path:null}} period={data.period} preview={preview}/><div><strong>{m.display_name}</strong><small dir="ltr">{RANK_LABELS[m.rank]}</small></div>{manage&&(preview||m.allowed_actions?.includes('rank_member'))&&<button className="button outline small" onClick={()=>open('rank_member','تغيير الرتبة',m)}>الرتبة</button>}</article>)}</div>:<Empty text="ما فيه أعضاء في القائمة"/>}</section></>;
}
