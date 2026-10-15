'use client';
import {useEffect,useState} from 'react';
import {Trophy,ArrowLeft} from 'lucide-react';
import type {DataBundle,LeaderboardEntry,Member,Rank} from '@/lib/domain/types';
import {RANK_LABELS} from '@/lib/domain/rules';
import {Empty} from '../ui';
function rankImage(rank:Rank){return '/assets/ranks/'+(rank==='moderator'?'moderator':['administrator','responsible'].includes(rank)?'responsible':'helper')+'.svg';}
export function Avatar({member,period,preview=false,size=48}:{member:{id:string;rank:Rank;display_name:string;avatar_path?:string|null;has_avatar?:boolean;avatar_updated_at?:string};period:string;preview?:boolean;size?:number}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[member.id,member.avatar_updated_at]);const actual=!preview&&!failed&&(member.has_avatar||member.avatar_path);
 return <img className="member-avatar" src={actual?'/api/avatars/'+member.id+'?period='+period+'&v='+(member.avatar_updated_at??'1'):rankImage(member.rank)} width={size} height={size} alt={'صورة '+member.display_name} loading="lazy" onError={()=>setFailed(true)}/>;
}
export default function Leaderboard({data,group,preview=false,compact=false,onOpen}:{data:DataBundle;group:'helpers'|'moderators';preview?:boolean;compact?:boolean;onOpen?:()=>void}){
 const entries=data.leaderboard?.[group]??[];return <section className={'card leaderboard-panel'+(compact?' compact':'')}><header><div><span className="eyebrow">GENERAL TEAM</span><h2>{group==='helpers'?'توب الهيلبر':'توب المودريتور'}</h2></div><span className="leaderboard-trophy"><Trophy size={23}/></span></header>{entries.length?<ol className="podium-list">{entries.map(entry=><li key={entry.staff_id} className={'podium-place place-'+entry.position}><span className="podium-position">{entry.position===1?<Trophy size={19}/>:entry.position}</span><Avatar member={{id:entry.staff_id,rank:entry.rank,display_name:entry.display_name,has_avatar:entry.has_avatar}} period={data.period} preview={preview}/><div><strong>{entry.display_name}</strong><small dir="ltr">{RANK_LABELS[entry.rank]}</small></div><b>{Number(entry.points).toLocaleString('en-US',{maximumFractionDigits:1})}<small>نقطة</small></b></li>)}</ol>:<Empty text="التوب يظهر بعد اعتماد الإحصائيات"/>}{onOpen&&<button className="text-button" onClick={onOpen}>عرض التوب <ArrowLeft size={16}/></button>}</section>;
}
