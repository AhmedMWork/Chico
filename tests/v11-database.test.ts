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

test('v1.1 disables and reactivates accounts without losing operational history',async()=>{
 await command('owner','account_status',{user_id:users.moderator.id,status:'disabled'});
 assert.equal((await db.query<{status:string}>('select status from chico_accounts where user_id=$1',[users.moderator.id])).rows[0].status,'disabled');
 await assert.rejects(asUser('moderator',tx=>tx.query('select chico_dashboard()')),/جلسة|معتمد/);
 await command('owner','account_status',{user_id:users.moderator.id,status:'active'});
 assert.equal((await db.query<{status:string}>('select status from chico_accounts where user_id=$1',[users.moderator.id])).rows[0].status,'active');
 assert.ok((await db.query('select id from chico_members where id=$1',[users.moderator.staff])).rows.length);
});
test('v1.1 rejected accounts return to pending review before approval',async()=>{
 await command('owner','approve_account',{user_id:users.pending.id,decision:'rejected'});
 await assert.rejects(command('owner','account_status',{user_id:users.pending.id,status:'active'}));
 await command('owner','account_reopen',{user_id:users.pending.id,reason:'correct membership review'});
 await command('owner','approve_account',{user_id:users.pending.id,display_name:'Review alias',rank:'helper',joined_at:'2025-01-01',decision:'active'});
});
test('v1.1 report time corrections preserve identity and version and reject missing IDs',async()=>{
 for(const kind of ['daily','weekly']){
 const input={staff_id:users.owner.staff,measured_at:new Date(Date.now()-600000).toISOString(),report_type:kind,ticket_mode:kind==='weekly'?'week_to_date':'daily_count',tickets:10,hours:2,rating:4.9,source:'verified source',publish:true};
 const first=await command('owner','report',input);const next={...input,measured_at:new Date(Date.now()-540000).toISOString(),report_id:first.id,expected_version:1,correction_reason:'verified measurement correction'};
 const saved=await command('owner','report',next);assert.equal(saved.id,first.id);assert.equal(saved.version,2);assert.equal(saved.unchanged,false);
 await assert.rejects(command('owner','report',{...next,report_id:undefined}),/معرف التقرير/);
 await assert.rejects(command('owner','report',next),/تغير السجل/);
 const records=await db.query<{n:number}>('select count(*)::int n from chico_reports where staff_id=$1 and report_type=$2',[users.owner.staff,kind]);assert.equal(records.rows[0].n,1);
 }
});
test('v1.1 overlapping leave blocks duplicate reservation and stores policy snapshot',async()=>{
 const dates=await db.query<{a:string;b:string}>("select (((now() at time zone 'Asia/Riyadh')::date+1)::timestamp at time zone 'Asia/Riyadh')::text a,(((now() at time zone 'Asia/Riyadh')::date+2)::timestamp at time zone 'Asia/Riyadh')::text b");
 const body={staff_id:users.helper.staff,type:'leave',discord_url:'https://discord.com/channels/123456/234567/345678',starts_at:dates.rows[0].a,ends_at:dates.rows[0].b,notice_at:new Date(Date.now()-60000).toISOString(),reason:'operational request',source:'reference one'};
 const first=await command('owner','request_create',body);await assert.rejects(command('owner','request_create',{...body,source:'different reference'}),/يتداخل/);
 const row=await db.query<{policy_snapshot:{version:number}}> ('select policy_snapshot from chico_requests where id=$1',[first.id]);assert.equal(row.rows[0].policy_snapshot.version,1);
});
test('v1.1 three reprimands create one review task; voiding source withdraws it without automatic dismissal',async()=>{
 const member=await command('owner','member_create',{display_name:'Review pseudonym',rank:'helper',joined_at:'2025-01-01'});let source:unknown;
 for(let i=0;i<3;i++){const result=await command('owner','discipline_add',{staff_id:member.id,kind:'reprimand',occurred_at:new Date(Date.now()-60000-i).toISOString(),reason:'verified disciplinary event',source:'reference '+i});source=result.id;}
 const tasks=await db.query<{source_ids:string[]}>("select * from chico_review_tasks where staff_id=$1 and status='open'",[member.id]);assert.equal(tasks.rows.length,1);assert.equal(tasks.rows[0].source_ids.length,3);
 assert.equal((await db.query<{game_status:string}>('select game_status from chico_members where id=$1',[member.id])).rows[0].game_status,'active');
 await command('owner','discipline_void',{id:source,reason:'source appeal accepted'});
 assert.equal((await db.query("select id from chico_review_tasks where staff_id=$1 and status='open'",[member.id])).rows.length,0);
});
test('v1.1 sensitive discipline and training require recent verification',async()=>{
 await db.query("update chico_private.sessions set verified_at=now()-interval '1 hour' where token_hash=$1",[users.admin.hash]);
 for(const action of ['discipline_add','training_open'])await assert.rejects(command('admin',action,{staff_id:users.helper.staff,kind:'dismissal',occurred_at:new Date().toISOString(),reason:'verified decision',source:'reference'}),/التحقق/);
 await db.query('select chico_service_verify($1)',[users.admin.hash]);
});
test('v1.1 linking an existing member preserves its rank, display alias and joining date',async()=>{
 const id=randomUUID(),session=randomUUID(),digest='8'.repeat(64);await db.query('insert into auth.users(id) values($1)',[id]);await db.query('select chico_service_register($1,$2,$3)',[id,'link.account',id+'@test.invalid']);
 const member=await command('owner','member_create',{display_name:'Existing alias',rank:'moderator',joined_at:'2025-02-03'});
 await command('owner','approve_account',{user_id:id,staff_id:member.id,decision:'active',display_name:'Wrong alias',rank:'helper',joined_at:'2026-01-01'});
 const row=(await db.query<{rank:string;display_name:string;joined_at:string}>('select rank,display_name,joined_at::text from chico_members where id=$1',[member.id])).rows[0];assert.equal(row.rank,'moderator');assert.equal(row.display_name,'Existing alias');assert.equal(row.joined_at,'2025-02-03');
});
test('v1.1 recovery fences sessions and token replacement, resumes completion after expiry and erases temporary secret',async()=>{
 const token='7'.repeat(64);await asUser('owner',tx=>tx.query('select chico_recovery_issue($1,$2)',[users.helper.id,token]));
 const result=(await db.query<{result:{claim:string;cipher:string}}> ('select chico_service_recovery_begin($1,$2) result',[token,'temporary-encrypted-secret'])).rows[0].result;assert.ok(result.claim);
 await assert.rejects(asUser('owner',tx=>tx.query('select chico_recovery_issue($1,$2)',[users.helper.id,'6'.repeat(64)])),/قيد التنفيذ/);
 await assert.rejects(db.query("select chico_service_session_create($1,$2,$3,'cipher',now()+interval '1 hour',true,'ignored device')",[users.helper.id,randomUUID(),'5'.repeat(64)]),/قيد التنفيذ/);
 await db.query("select chico_service_recovery_step($1,$2,'applying')",[token,result.claim]);
 await assert.rejects(db.query('select chico_service_recovery_begin($1,$2)',[token,'another-secret']),/RECOVERY_PENDING/);
 await db.query("select chico_service_recovery_step($1,$2,'auth_applied')",[token,result.claim]);await db.query("update chico_private.recovery_tokens set expires_at=now()-interval '1 hour' where token_hash=$1",[token]);
 await db.query('select chico_service_recovery_finish($1,$2)',[token,result.claim]);await db.query('select chico_service_recovery_finish($1,$2)',[token,result.claim]);
 const row=(await db.query<{password_cipher:string|null;recovery_state:string}>('select password_cipher,recovery_state from chico_private.recovery_tokens where token_hash=$1',[token])).rows[0];assert.equal(row.password_cipher,null);assert.equal(row.recovery_state,'completed');
});
test('v1.1 backend session records omit device information and external identity is prohibited',async()=>{
 assert.equal((await db.query<{n:number}>("select count(*)::int n from chico_private.sessions where user_agent<>''")).rows[0].n,0);
 await assert.rejects(command('owner','member_create',{display_name:'Alias only',rank:'helper',joined_at:'2025-01-01',external_ref:'external-id'}),/غير مسموحة/);
 const rows=await asUser('owner',tx=>tx.query<{result:unknown[]}>('select chico_my_sessions() result'));assert.equal(JSON.stringify(rows.rows[0].result).includes('user_agent'),false);
});

test('v1.1 import plan distinguishes create, unchanged and update without mutating data',async()=>{
 const key='4'.repeat(64),path=users.owner.id+'/plan.csv';await db.query("insert into storage.objects(bucket_id,name) values('chico-files',$1)",[path]);
 const file=(await db.query<{id:string}>("select chico_service_file_register($1,$2,'source.csv','text/csv',40,$3) id",[users.owner.id,path,key])).rows[0].id;
 const row={_source_row:2,staff_id:users.owner.staff,measured_at:new Date(Date.now()-30000).toISOString(),report_type:'daily',ticket_mode:'daily_count',tickets:55,hours:7,rating:4.9,flags_total:null};
 async function plan(value:typeof row){const preview=(await db.query<{id:string}>('select chico_service_import_prepare($1,$2,$3,$4,$5::jsonb) id',[users.owner.id,'reports',key,file,JSON.stringify([value])])).rows[0].id;return (await asUser('owner',tx=>tx.query<{plan:Array<{operation:string;after:{report_id:string;expected_version:number}}>}>('select chico_import_plan($1) plan',[preview]))).rows[0].plan;}
 assert.equal((await plan(row))[0].operation,'create');
 const report=await command('owner','report',{...row,source:'ملف معتمد · بصمة '+key.slice(0,16),source_file:file,publish:true});
 assert.equal((await plan(row))[0].operation,'unchanged');const changed=await plan({...row,tickets:56});assert.equal(changed[0].operation,'update');assert.equal(changed[0].after.report_id,report.id);assert.equal(changed[0].after.expected_version,1);
});
test('v1.1 credential changes share recovery fencing and ambiguous outcomes require explicit operator resolution',async()=>{
 const digest='3'.repeat(64);await asUser('owner',tx=>tx.query('select chico_password_issue($1)',[digest]));
 const op=(await db.query<{v:{claim:string}}>('select chico_service_recovery_begin($1,$2) v',[digest,'encrypted-password'])).rows[0].v;
 await db.query("select chico_service_recovery_step($1,$2,'applying')",[digest,op.claim]);await db.query("select chico_service_recovery_step($1,$2,'ambiguous')",[digest,op.claim]);
 await assert.rejects(db.query('select chico_service_recovery_begin($1,$2)',[digest,'another-secret']),/RECOVERY_PENDING/);
 await assert.rejects(asUser('admin',tx=>tx.query('select chico_service_recovery_reconcile($1,$2,$3)',[op.claim,'confirmed_applied','verified provider response'])),/permission denied/);
 await db.query('select chico_service_recovery_reconcile($1,$2,$3)',[op.claim,'confirmed_applied','verified provider response and completed transport']);await db.query('select chico_service_recovery_finish($1,$2)',[digest,op.claim]);
 assert.equal((await db.query<{v:boolean}>('select chico_recovery_blocked($1) v',[users.owner.id])).rows[0].v,false);
});
