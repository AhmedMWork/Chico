import type {DataBundle,Member} from '@/lib/domain/types';
import type {LucideIcon} from 'lucide-react';
import type {teamSummary} from '@/lib/domain/view';
export type Section='personal'|'team'|'reports'|'accounts'|'members'|'shifts'|'requests'|'discipline'|'meetings'|'notifications'|'imports'|'settings'|'profile'|'rules'|'audit'|'points'|'history'|'helpers'|'moderators';
export type ViewProps={preview:boolean;data:DataBundle;member:Member;account:DataBundle['account'];archived:boolean;busy:boolean;open:(kind:string,title:string,row?:unknown,wide?:boolean)=>void;navigate:(section:Section)=>void;metric:(label:string,value:React.ReactNode,detail:string,Icon:LucideIcon,kind?:string,action?:()=>void)=>React.ReactNode;sectionHead:(title:string,kicker:string,button?:React.ReactNode)=>React.ReactNode;summary:ReturnType<typeof teamSummary>;rankFilter:string;setRankFilter:(rank:string)=>void;nameOf:(id:string|null|undefined)=>string;approve:boolean};
