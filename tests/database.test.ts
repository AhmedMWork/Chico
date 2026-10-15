import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const users:Record<string,{id:string;session:string;hash:string;staff?:string}>={};
async function rootActor(name:string){const u=users[name];await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:u.id,session_id:u.session,role:'authenticated'})]);}
async function asUser<T>(name:string,fn:(tx:Pick<PGlite,'query'|'exec'>)=>Promise<T>):Promise<T>{return db.transaction(async tx=>{const u=users[name];await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:u.id,session_id:u.session,role:'authenticated'})]);return fn(tx);});}
async function command(name:string,action:string,data:unknown){return asUser(name,async tx=>(await tx.query<{result:Record<string,unknown>}>('select public.chico_command($1,$2::jsonb) result',[action,JSON.stringify(data)])).rows[0].result);}
before(async()=>{
 await db.waitReady;
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;create function storage.foldername(text) returns text[] language sql immutable as 'select string_to_array($1,''/'')';
 create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claims'',true)::jsonb->>''sub'','''')::uuid';
 create function auth.jwt() returns jsonb language sql stable as 'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';`);
 for(const f of (await readdir('supabase/migrations')).sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 for(const name of ['owner','admin','moderator','helper','senior','pending']){
  const id=randomUUID(),session=randomUUID(),hash=(await import('node:crypto')).createHash('sha256').update(id).digest('hex');users[name]={id,session,hash};
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('select public.chico_service_register($1,$2,$3)',[id,'test.'+name,id+'@test.invalid']);
  await db.query("select public.chico_service_session_create($1,$2,$3,'test-cipher',now()+interval '1 hour',true,'test-client')",[id,session,hash]);
 }
 await db.query("select public.chico_service_bootstrap($1,'Test Owner')",[users.owner.id]);
 await rootActor('owner');
 for(const [name,rank] of [['admin','responsible'],['moderator','moderator'],['helper','helper'],['senior','senior_helper']]){
  const result=await command('owner','approve_account',{user_id:users[name].id,display_name:'Test '+name,rank,joined_at:'2025-01-01',decision:'active',approve_accounts:name==='admin'});users[name].staff=String(result.member_id);
 }
 const own=await db.query<{member_id:string}>('select member_id from public.chico_accounts where user_id=$1',[users.owner.id]);users.owner.staff=own.rows[0].member_id;
});
after(async()=>{await db.close();});
test('All migrations execute against PostgreSQL, and pending accounts cannot read members or dashboard',async()=>{
 const rows=await asUser('pending',tx=>tx.query('select * from public.chico_members'));assert.equal(rows.rows.length,0);
 await assert.rejects(asUser('pending',tx=>tx.query('select public.chico_dashboard()')),/الحساب غير معتمد/);
 const me=await asUser('pending',tx=>tx.query<{result:{status:string}}> ('select public.chico_me() result'));assert.equal(me.rows[0].result.status,'pending');
});
test('Helper and SN.Helper cannot publish, including through direct SQL RPC',async()=>{
 const body={staff_id:users.helper.staff,measured_at:new Date(Date.now()-60000).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:10,hours:2,rating:4.9,source:'test source',publish:true};
 for(const name of ['helper','senior'])await assert.rejects(command(name,'report',{...body,staff_id:users[name].staff}),/Moderator/);
 await assert.rejects(asUser('helper',tx=>tx.query("insert into public.chico_reports(staff_id) values($1)",[users.helper.staff])),/permission denied/);
});
test('Moderator publishes once; repeated identical reports do not duplicate, and correction needs leadership',async()=>{
 const body={staff_id:users.moderator.staff,measured_at:new Date(Date.now()-120000).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:25,hours:3,rating:4.9,source:'test snapshot',publish:true};
 const first=await command('moderator','report',body);const again=await command('moderator','report',body);assert.equal(first.id,again.id);assert.equal(again.unchanged,true);
 await assert.rejects(command('moderator','report',{...body,report_id:first.id,tickets:27,expected_version:1}),/القيادة/);
 const corrected=await command('admin','report',{...body,report_id:first.id,tickets:27,expected_version:1,correction_reason:'verified correction'});assert.equal(corrected.version,2);
 await assert.rejects(command('admin','report',{...body,report_id:first.id,tickets:28,expected_version:1,correction_reason:'stale correction'}),/تغير السجل/);
});
test('RLS isolates another member, sessions table and account approval from Helper',async()=>{
 const members=await asUser('helper',tx=>tx.query<{id:string}>('select id from public.chico_members'));assert.deepEqual(members.rows.map(r=>r.id),[users.helper.staff]);
 await assert.rejects(asUser('helper',tx=>tx.query('select * from chico_private.sessions')),/permission denied/);
 await assert.rejects(command('moderator','approve_account',{user_id:users.pending.id,display_name:'Bad Grant',rank:'moderator',joined_at:'2025-01-01',decision:'active'}),/إدارة الحسابات|صاحب الموقع|Responsible/);
 await assert.rejects(command('admin','rename_account',{user_id:users.owner.id,display_name:'Protected owner'}),/تعديل هذا الحساب|محمي/);
});
test('Admin approves a pending account; display name changes without changing login identity',async()=>{
 const approved=await command('admin','approve_account',{user_id:users.pending.id,display_name:'New Member',rank:'helper',joined_at:'2025-01-01',decision:'active'});users.pending.staff=String(approved.member_id);
 await command('admin','rename_account',{user_id:users.pending.id,display_name:'Changed Display'});
 const me=await asUser('pending',tx=>tx.query<{result:{username:string;member:{display_name:string}}}>('select public.chico_me() result'));
 assert.equal(me.rows[0].result.username,'test.pending');assert.equal(me.rows[0].result.member.display_name,'Changed Display');
 await assert.rejects(command('admin','rename_account',{user_id:users.owner.id,display_name:'Tampered Owner'}),/تعديل هذا الحساب|محمي/);
});
test('Revocation and current database rank immediately override an unexpired JWT',async()=>{
 await command('owner','rank_member',{staff_id:users.moderator.staff,rank:'helper',reason:'Test demotion'});
 const allowed=await asUser('moderator',tx=>tx.query<{allowed:boolean}>('select public.chico_publish() allowed'));assert.equal(allowed.rows[0].allowed,false);
 await command('owner','rank_member',{staff_id:users.moderator.staff,rank:'moderator',reason:'Test restore'});
 await db.query('select public.chico_service_revoke($1,false)',[users.senior.hash]);
 await assert.rejects(asUser('senior',tx=>tx.query('select public.chico_me()')),/جلسة الدخول/);
});
test('Pending leave never deducts balance; approval deducts once and rejection preserves balance',async()=>{
 const month=new Date(Date.now()+3*3600000).toISOString().slice(0,7),body={staff_id:users.helper.staff,type:'leave',discord_url:'https://discord.com/channels/123456/234567/345678',starts_at:month+'-20T00:00:00+03:00',ends_at:month+'-23T00:00:00+03:00',notice_at:new Date(Date.now()-60000).toISOString(),reason:'test leave',source:'Discord'};
 const first=await command('admin','request_create',body);
 const second=await command('admin','request_create',{...body,starts_at:month+'-25T00:00:00+03:00',ends_at:month+'-26T00:00:00+03:00'});
 const balance=async()=> (await asUser('helper',tx=>tx.query<{result:{balances:{leave_available:number}}}>('select chico_dashboard() result'))).rows[0].result.balances.leave_available;
 assert.equal(await balance(),3);
 await command('admin','request_decide',{id:first.id,decision:'approved',reason:'approved verified leave'});assert.equal(await balance(),0);
 await assert.rejects(command('admin','request_decide',{id:second.id,decision:'approved',reason:'quota spent'}),/الرصيد/);
 await command('admin','request_decide',{id:second.id,decision:'rejected',reason:'quota spent'});assert.equal(await balance(),0);
 await assert.rejects(command('admin','request_decide',{id:first.id,decision:'approved',reason:'duplicate'}),/بالفعل/);
});
test('Excuse must be more than an hour before shift and requires accepted substitute',async()=>{
 const starts=new Date(Date.now()+30*60000),ends=new Date(+starts+3600000);
 const body={staff_id:users.helper.staff,type:'excuse',discord_url:'https://discord.com/channels/123456/234567/345678',starts_at:starts.toISOString(),ends_at:ends.toISOString(),notice_at:new Date(+starts-3600000).toISOString(),substitute_id:users.moderator.staff,reason:'test excuse',source:'excuse source'};
 await assert.rejects(command('admin','request_create',body),/أكثر من ساعة/);
 const request=await command('admin','request_create',{...body,notice_at:new Date(+starts-3601000).toISOString()});
 await assert.rejects(command('admin','request_decide',{id:request.id,decision:'approved'}),/قبول البديل/);
 await command('admin','request_decide',{id:request.id,decision:'approved',substitute_accepted:true});
});
test('Cumulative flags survive weekly boundaries and training requires the correct progression',async()=>{
 const flag=await command('admin','flag_add',{staff_id:users.helper.staff,amount:10,occurred_at:'2025-01-01T10:00:00Z',reason:'verified event',source:'flag source'});
 const training=await command('admin','training_open',{staff_id:users.helper.staff,reason:'training after verified flags'});
 await assert.rejects(command('admin','training_stage',{id:training.id,stage:'returned'}),/انتقال غير صالح/);
 await command('admin','training_stage',{id:training.id,stage:'training'});await command('admin','training_stage',{id:training.id,stage:'awaiting_return'});await command('admin','training_stage',{id:training.id,stage:'returned'});
 const data=await asUser('helper',tx=>tx.query<{result:{flags:Array<{id:string;amount:number}>}}> ('select public.chico_dashboard() result'));assert.equal(data.rows[0].result.flags.find(f=>f.id===flag.id)?.amount,10);
});
test('Two warnings convert once, and cancelling a source warning cancels its derived reprimand',async()=>{
 const first=await command('admin','discipline_add',{staff_id:users.helper.staff,kind:'warning',occurred_at:'2025-02-01T10:00:00Z',reason:'first verified warning',source:'warning 1'});
 const second=await command('admin','discipline_add',{staff_id:users.helper.staff,kind:'warning',occurred_at:'2025-02-02T10:00:00Z',reason:'second verified warning',source:'warning 2'});assert.ok(second.derived_reprimand);
 await command('admin','discipline_void',{id:first.id,reason:'appeal accepted'});
 const derived=await db.query<{status:string}>('select status from public.chico_discipline where id=$1',[second.derived_reprimand]);assert.equal(derived.rows[0].status,'voided');
});
test('Session expiry and recovery tokens fail closed and can be consumed only once',async()=>{
 const h=(await import('node:crypto')).createHash('sha256').update('test-recovery-token').digest('hex');await asUser('owner',tx=>tx.query('select public.chico_recovery_issue($1,$2)',[users.pending.id,h]));
 const claim=randomUUID();const first=await db.query<{result:unknown}>('select public.chico_service_recovery_claim($1,$2) result',[h,claim]);assert.ok(first.rows[0].result);
 const second=await db.query<{result:unknown}>('select public.chico_service_recovery_claim($1,$2) result',[h,randomUUID()]);assert.equal(second.rows[0].result,null);
 await db.query('select public.chico_service_recovery_finish($1,$2)',[h,claim]);
 const third=await db.query<{result:unknown}>('select public.chico_service_recovery_claim($1,$2) result',[h,randomUUID()]);assert.equal(third.rows[0].result,null);
 await assert.rejects(asUser('pending',tx=>tx.query('select public.chico_me()')),/جلسة الدخول/);
});
test('Stored stale grants cannot give a Helper account approval authority',async()=>{
 await db.query("insert into public.chico_grants(user_id,capability) values($1,'approve_accounts')",[users.helper.id]);
 const cap=await asUser('helper',tx=>tx.query<{allowed:boolean}>("select public.chico_cap('approve_accounts') allowed"));assert.equal(cap.rows[0].allowed,false);
 await assert.rejects(command('helper','rename_account',{user_id:users.moderator.id,display_name:'unauthorized'}),/إدارة الحسابات|صاحب الموقع|Responsible/);
 await db.query("delete from public.chico_grants where user_id=$1 and capability='approve_accounts'",[users.helper.id]);
});
test('Counting modes cannot mix in a member/week, even at different timestamps',async()=>{
 await assert.rejects(command('moderator','report',{staff_id:users.moderator.staff,measured_at:new Date(Date.now()-180000).toISOString(),report_type:'daily',ticket_mode:'daily_count',tickets:5,hours:2,rating:4.8,source:'opposite mode',publish:true}),/لا تخلط/);
});
test('Flags baseline records only the difference and rejects older cumulative snapshots',async()=>{
 const measured=new Date(Date.now()-120000).toISOString();const input={staff_id:users.moderator.staff,total:8,measured_at:measured,reason:'review cumulative opening total',source:'verified source'};
 const first=await command('admin','flags_baseline',input);assert.equal(first.difference,8);
 const again=await command('admin','flags_baseline',input);assert.equal(again.difference,0);
 const rows=await db.query<{total:number}>('select sum(amount)::int total from public.chico_flags where staff_id=$1 and status=\'verified\'',[users.moderator.staff]);assert.equal(rows.rows[0].total,8);
 await assert.rejects(command('admin','flags_baseline',{...input,measured_at:new Date(Date.now()-3600000).toISOString()}),/أقدم/);
 await command('owner','flags_baseline',{staff_id:users.owner.staff,total:0,measured_at:measured,reason:'review verified zero opening',source:'verified zero'});
 const zero=await db.query<{flags_reviewed:boolean}>('select flags_reviewed from public.chico_members where id=$1',[users.owner.staff]);assert.equal(zero.rows[0].flags_reviewed,true);
});
async function importSource(){
 const path=users.owner.id+'/'+randomUUID()+'.csv';await db.query("insert into storage.objects(bucket_id,name) values('chico-files',$1)",[path]);
 const hash='a'.repeat(64);const registered=await db.query<{id:string}>("select public.chico_service_file_register($1,$2,'source.csv','text/csv',120,$3) id",[users.owner.id,path,hash]);return {id:registered.rows[0].id,hash};
}
async function reviewedImport(file:{id:string;hash:string},rows:unknown[]){const p=await db.query<{id:string}>('select public.chico_service_import_prepare($1,\'reports\',$2,$3,$4::jsonb) id',[users.owner.id,file.hash,file.id,JSON.stringify(rows)]);return p.rows[0].id;}
async function importRows(file:{id:string;hash:string},rows:unknown[],preview:string){return asUser('owner',async tx=>(await tx.query<{result:{already_applied?:boolean;applied:number;unchanged:number}}>('select public.chico_import(\'reports\',$1,$2,$3::jsonb,$4,true) result',[file.hash,file.id,JSON.stringify(rows),preview])).rows[0].result);}
test('Import requires a server-approved immutable selection and matching source hash; repeated subsets do not double data',async()=>{
 const file=await importSource();const make=(n:number)=>({_source_row:n,staff_id:users.owner.staff,measured_at:new Date(Date.now()-(10+n)*60000).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:20+n,hours:3,rating:4.9,flags_total:null});
 const first=[make(1)],second=[make(2)];await assert.rejects(importRows(file,first,randomUUID()),/راجع الملف/);
 const preview=await reviewedImport(file,first);await assert.rejects(importRows(file,[{...first[0],tickets:999}],preview),/راجع الملف/);
 const applied=await importRows(file,first,preview);assert.equal(applied.applied,1);const repeated=await importRows(file,first,preview);assert.equal(repeated.already_applied,true);
 const next=await importRows(file,second,await reviewedImport(file,second));assert.equal(next.applied,1);
 await assert.rejects(asUser('helper',tx=>tx.query('select * from chico_private.import_previews')),/permission denied/);
 await assert.rejects(asUser('helper',tx=>tx.query('select public.chico_file_path($1)',[file.id])),/الملف غير متاح|صاحب الموقع|Responsible|للإدارة فقط/);
});
test('Import transaction rolls back every row if one selected member fails',async()=>{
 const file=await importSource();const time=new Date(Date.now()-25*60000).toISOString();const rows=[{_source_row:1,staff_id:users.owner.staff,measured_at:time,report_type:'daily',ticket_mode:'week_to_date',tickets:45,hours:4,rating:4.9},{_source_row:2,staff_id:randomUUID(),measured_at:time,report_type:'daily',ticket_mode:'week_to_date',tickets:30,hours:3,rating:4.9}];
 await assert.rejects(importRows(file,rows,await reviewedImport(file,rows)),/السجل 2/);const report=await db.query('select id from public.chico_reports where staff_id=$1 and measured_at=$2',[users.owner.staff,time]);assert.equal(report.rows.length,0);
});
test('Policy edits create versions while saved report goals remain unchanged',async()=>{
 await command('owner','report',{staff_id:users.helper.staff,measured_at:new Date(Date.now()-600000).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:25,hours:3,rating:4.9,source:'historical helper source',publish:true});
 const before=await db.query<{target_snapshot:{tickets:number};policy_version:number}>("select target_snapshot,policy_version from public.chico_reports where staff_id=$1 limit 1",[users.helper.staff]);assert.equal(before.rows[0].target_snapshot.tickets,120);
 const conf=await db.query<{config:Record<string,any>}>('select config from public.chico_settings where id');conf.rows[0].config.goals.helper.tickets=125;await command('owner','settings',{config:conf.rows[0].config});
 const report=await command('owner','report',{staff_id:users.helper.staff,measured_at:new Date(Date.now()+1000).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:35,hours:4,rating:4.9,source:'new policy test'});
 const saved=await db.query<{target_snapshot:{tickets:number};policy_version:number}>('select target_snapshot,policy_version from public.chico_reports where id=$1',[report.id]);assert.equal(saved.rows[0].target_snapshot.tickets,125);assert.equal(saved.rows[0].policy_version,2);
 const old=await db.query<{target_snapshot:{tickets:number}}>("select target_snapshot from public.chico_reports where staff_id=$1 and id<>$2 limit 1",[users.helper.staff,report.id]);assert.equal(old.rows[0].target_snapshot.tickets,120);
});
test('Ownership transfers keep one Owner and the previous Owner loses authority; Helper Owner still cannot publish',async()=>{
 await command('owner','transfer_owner',{user_id:users.helper.id,confirmation:'TRANSFER OWNERSHIP'});
 await assert.rejects(command('owner','transfer_owner',{user_id:users.admin.id,confirmation:'TRANSFER OWNERSHIP'}),/نقل الملكية/);
 await assert.rejects(command('helper','report',{staff_id:users.helper.staff,measured_at:new Date().toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:0,hours:0,rating:0,source:'owner bypass test'}),/Moderator/);
 await assert.rejects(db.query("insert into public.chico_grants(user_id,capability) values($1,'owner')",[users.admin.id]),/unique/);
 await command('helper','transfer_owner',{user_id:users.owner.id,confirmation:'TRANSFER OWNERSHIP'});
 const owners=await db.query<{user_id:string}>('select user_id from public.chico_grants where capability=\'owner\'');assert.equal(owners.rows.length,1);assert.equal(owners.rows[0].user_id,users.owner.id);
});
