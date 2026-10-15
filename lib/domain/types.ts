export type Rank = 'helper' | 'senior_helper' | 'moderator' | 'administrator' | 'responsible';
export type AccountStatus = 'pending' | 'active' | 'rejected' | 'disabled';
export interface Member {
  id: string;avatar_path?:string|null;avatar_updated_at?:string;has_avatar?:boolean;rank_for_period?:Rank;goal_for_period?:GoalSet|null;active_for_period?:boolean;allowed_actions?:string[];display_name: string; rank: Rank; joined_at: string;
  game_status: 'active' | 'training' | 'dismissed'; flags_reviewed?:boolean;flags_reviewed_at?:string|null;
}
export interface Account {
  user_id: string; username: string; status: AccountStatus; member: Member | null;
  owner: boolean; capabilities: string[]; must_change_password: boolean;
}
export interface Period { start: string; end: string; label: string }
export interface Snapshot {
  id: string; staff_id: string; measured_at: string; period_start: string;
  report_type: 'daily' | 'weekly'; ticket_mode: 'week_to_date' | 'daily_count'; tickets: number; hours: number; rating: number;
  complaints: number | null; requests_done: number | null; messages: number | null;
  status: 'draft' | 'published' | 'superseded'; source: string; created_by: string; version: number;
  rank_at_measurement: Rank; policy_version:number;target_snapshot?:GoalSet|null;source_file?:string|null;
}
export interface FlagEvent {id:string;staff_id:string;occurred_at:string;source:string;reason:string;amount:number;status:'verified'|'voided';void_reason?:string;}
export interface DisciplineEvent {id:string;staff_id:string;kind:'warning'|'reprimand'|'dismissal'|'blacklist';status:'verified'|'voided';reason:string;source:string;occurred_at:string;derived_from:string[];consumed_by:string|null;}
export interface TrainingCase {id:string;staff_id:string;stage:'waiting_training'|'training'|'awaiting_return'|'returned';reason:string;notes:string;opened_at:string;returned_at:string|null;}
export interface Shift {id:string;staff_id:string;starts_at:string;ends_at:string;substitute_id:string|null;coverage:'assigned'|'needs_substitute'|'covered';notes:string;}
export interface TeamRequest {policy_snapshot?:{version:number;rank:Rank;balance:Balance}|null;id:string;staff_id:string;type:'leave'|'excuse';starts_at:string;ends_at:string;notice_at:string;units:number;reason:string;source:string;substitute_id:string|null;substitute_accepted:boolean;discord_url?:string|null;status:'pending'|'approved'|'rejected'|'cancelled';decision_reason:string|null;created_at:string;}
export interface Meeting {id:string;starts_at:string;title:string;channel_url:string;}
export interface Attendance {meeting_id:string;staff_id:string;status:'present'|'late'|'absent'|'excused';note:string;}
export interface Notification {kind?:'info'|'success'|'warning'|'danger';audience?:'self'|'management';id:string;title:string;body:string;link:string;read_at:string|null;created_at:string;}
export interface AccountRow {allowed_actions?:string[];user_id:string;member_id?:string;username?:string;display_name?:string;rank?:Rank;status:AccountStatus;created_at:string;}
export interface Balance {month:string;leave_quota:number|null;leave_used:number;leave_held:number;leave_available:number|null;excuse_quota:number|null;excuse_used:number;excuse_held:number;excuse_available:number|null;}
export interface GoalSet {tickets:number;hours:number;rating:number;complaints:number|null;requests:number|null;messages:number|null;}
export interface Settings {goals?:Partial<Record<Rank,GoalSet>>;leave:Record<Rank,number|null>;excuses:Record<Rank,number|null>;meeting_channel:string;excuse_channel:string;leave_channel:string;}
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface PointScore{base:number|null;total:number|null;adjustment:number;max:number;policy_version?:number;rank?:Rank;}
export interface LeaderboardEntry{staff_id:string;display_name:string;rank:Rank;points:number;position:number;has_avatar:boolean;}
export interface PointConfig{max_points:number;tickets:number;hours:number;rating:number;tasks:number;}
export interface DataBundle {
 points?:PointScore;leaderboard?:{helpers:LeaderboardEntry[];moderators:LeaderboardEntry[]};points_config?:PointConfig|null;member_scores?:Array<{staff_id:string;score:PointScore}>;point_adjustments?:Array<{id:string;staff_id:string;period_start:string;amount:number;reason:string;status:'active'|'voided';created_at:string}>;
  unread_notifications?:number;notifications_can_manage?:boolean;fetched_at?:string;review_tasks?:Array<{id:string;staff_id:string;kind:string;source_ids:string[];status:string;created_at:string}>;
  account: Account; period: string; members: Member[]; snapshots: Snapshot[];
  flags:FlagEvent[];discipline:DisciplineEvent[];training:TrainingCase[];
  shifts:Shift[];requests:TeamRequest[];meetings:Meeting[];attendance:Attendance[];
  notifications:Notification[];pending_accounts:AccountRow[];accounts:AccountRow[];
  audit:Array<{id:number;actor:string;actor_name?:string;target_name?:string;action:string;target_id:string;before_data:unknown;after_data:unknown;created_at:string}>;balances:Balance;
  settings:Settings;grants:Array<{user_id:string;capability:string}>;
  confirmations:Array<{staff_id:string;period_start:string;confirmed:boolean;target_snapshot?:number;policy_version?:number}>;
  import_jobs:Array<{id:string;file_hash:string;type:string;status:string;summary:unknown;created_at:string}>;
}
