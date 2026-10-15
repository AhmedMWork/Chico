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
 for(const name of ['owner','admin','administrator','moderator','helper','senior','pending']){
  const id=randomUUID(),session=randomUUID(),hash=(await import('node:crypto')).createHash('sha256').update(id).digest('hex');users[name]={id,session,hash};
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('select public.chico_service_register($1,$2,$3)',[id,'test.'+name,id+'@test.invalid']);
  await db.query("select public.chico_service_session_create($1,$2,$3,'test-cipher',now()+interval '1 hour',true,'test-client')",[id,session,hash]);
 }
 await db.query("select public.chico_service_bootstrap($1,'Test Owner')",[users.owner.id]);
 await rootActor('owner');
 for(const [name,rank] of [['admin','responsible'],['administrator','administrator'],['moderator','moderator'],['helper','helper'],['senior','senior_helper']]){
  const result=await command('owner','approve_account',{user_id:users[name].id,display_name:'Test '+name,rank,joined_at:'2025-01-01',decision:'active',approve_accounts:name==='admin'});users[name].staff=String(result.member_id);
 }
 const own=await db.query<{member_id:string}>('select member_id from public.chico_accounts where user_id=$1',[users.owner.id]);users.owner.staff=own.rows[0].member_id;
});
after(async()=>{await db.close();});

const discord='https://discord.com/channels/123456/234567/345678';
const measured=()=>new Date(Date.now()-60000).toISOString();
async function dashboard(name:string){return (await asUser(name,tx=>tx.query<{v:any}>('select chico_dashboard() v'))).rows[0].v;}
async function score(staff:string,period?:string){return (await db.query<{v:any}>('select chico_member_points($1,coalesce($2::date,chico_week(now()))) v',[staff,period??null])).rows[0].v;}
function report(staff:string,extra={}){return {staff_id:staff,measured_at:measured(),report_type:'daily',ticket_mode:'week_to_date',tickets:120,hours:14,rating:4.8,source:'verified operational source',publish:true,...extra};}
test('v1.2 Owner and Responsible manage; Administrator and stale capability grants cannot manage',async()=>{
 for(const name of ['owner','admin'])assert.equal((await asUser(name,tx=>tx.query<{v:boolean}>('select chico_manage() v'))).rows[0].v,true);
 await db.query("insert into chico_grants(user_id,capability) values($1,'manage_settings'),($1,'approve_accounts')",[users.administrator.id]);
 for(const name of ['administrator','moderator','helper']){
  assert.equal((await asUser(name,tx=>tx.query<{v:boolean}>('select chico_manage() v'))).rows[0].v,false);
  await assert.rejects(command(name,'member_create',{display_name:'Unauthorized alias',rank:'helper',joined_at:'2025-01-01'}));
  await assert.rejects(command(name,'points_adjust',{staff_id:users.helper.staff,period_start:'2026-10-12',amount:2,reason:'not authorized'}),/Responsible/);
 }
 await assert.rejects(command('admin','rename_account',{user_id:users.owner.id,display_name:'Cannot rename owner'}),/محمي/);
 const added=await command('admin','member_create',{display_name:'Responsible can manage',rank:'administrator',joined_at:'2025-01-01'});assert.ok(added.id);
});
test('v1.2 ordinary accounts cannot publish or read peer reports, including reports they formerly created',async()=>{
 const created=await command('owner','report',report(users.helper.staff!));
 await db.query('update chico_reports set created_by=$1 where id=$2',[users.moderator.id,created.id]);
 await assert.rejects(command('moderator','report',report(users.helper.staff!)),/إحصائياتك فقط/);
 for(const name of ['moderator','administrator']){
  assert.equal((await asUser(name,tx=>tx.query('select * from chico_reports where id=$1',[created.id]))).rows.length,0);
  const data=await dashboard(name);assert.equal(data.snapshots.some((r:any)=>r.id===created.id),false);assert.equal(data.member_scores.length,0);
  const peer=data.members.find((m:any)=>m.id===users.helper.staff);assert.ok(peer);assert.deepEqual(Object.keys(peer).sort(),['display_name','has_avatar','id','rank']);
  assert.equal(data.audit.length,0);assert.equal(data.accounts.length,0);
  await assert.rejects(asUser(name,tx=>tx.query('select chico_member_points($1,chico_week(now()))',[users.helper.staff])),/permission denied/);
 }
 assert.ok((await dashboard('admin')).snapshots.some((r:any)=>r.id===created.id));
});
test('v1.2 performance points normalize rank tasks and cap ratios; daily counts and weekly finals retain their meaning',async()=>{
 const helper=await score(users.helper.staff!);assert.equal(helper.base,100);
 await command('moderator','report',report(users.moderator.staff!,{tickets:200,hours:14,rating:4.85,complaints:15,requests_done:20}));
 assert.equal((await score(users.moderator.staff!)).base,100);
 const created=await command('owner','member_create',{display_name:'Daily count alias',rank:'helper',joined_at:'2025-01-01'}),period=(await db.query<{v:string}>('select chico_week(now())::text v')).rows[0].v;
 const day1=period+'T03:01:00Z',day2=period+'T04:01:00Z';
 await command('owner','report',report(String(created.id),{ticket_mode:'daily_count',measured_at:day1,tickets:50}));
 await command('owner','report',report(String(created.id),{ticket_mode:'daily_count',measured_at:day2,tickets:60}));
 const oneDay=await score(String(created.id));assert.equal(oneDay.base,76.47); // latest count of the day, never 50+60
 await command('owner','report',report(String(created.id),{report_type:'weekly',measured_at:period+'T05:01:00Z',tickets:120,ticket_mode:'week_to_date'}));assert.equal((await score(String(created.id))).base,100);
});
test('v1.2 points rules are versioned; adjustments require a reason and voiding preserves history',async()=>{
 const before=await score(users.helper.staff!),period=(await db.query<{v:string}>('select chico_week(now())::text v')).rows[0].v;
 await command('admin','points_policy',{config:{max_points:200,tickets:40,hours:25,rating:20,tasks:15}});
 assert.deepEqual(await score(users.helper.staff!),before);
 const bonus=await command('admin','points_adjust',{staff_id:users.helper.staff,period_start:period,amount:7,reason:'verified additional work'});assert.equal((await score(users.helper.staff!)).total,107);
 await command('admin','points_void',{id:bonus.id,reason:'adjustment reversed after review'});assert.equal((await score(users.helper.staff!)).total,100);
 assert.equal((await db.query<{status:string}>('select status from chico_point_adjustments where id=$1',[bonus.id])).rows[0].status,'voided');
 await assert.rejects(command('admin','points_policy',{config:{max_points:200,tickets:0,hours:0,rating:0,tasks:15}}));
});
test('v1.2 top lists are separate and expose only pseudonym, avatar presence and points',async()=>{
 for(let i=0;i<4;i++){const m=await command('owner','member_create',{display_name:'Top alias '+i,rank:i%2?'senior_helper':'helper',joined_at:'2025-01-01'});await command('owner','report',report(String(m.id),{tickets:120+i,messages:100}));}
 const data=await dashboard('helper');assert.equal(data.leaderboard.helpers.length,3);assert.ok(data.leaderboard.moderators.length);
 for(const entry of data.leaderboard.helpers){assert.ok(['helper','senior_helper'].includes(entry.rank));assert.deepEqual(Object.keys(entry).sort(),['display_name','has_avatar','points','position','rank','staff_id']);}
 assert.ok(data.leaderboard.moderators.every((x:any)=>x.rank==='moderator'));
});
function leave(staff:string,day=20){const month=new Date(Date.now()+3*3600000).toISOString().slice(0,7);return {staff_id:staff,type:'leave',discord_url:discord,starts_at:month+'-'+day+'T00:00:00+03:00',ends_at:month+'-'+(day+1)+'T00:00:00+03:00',notice_at:measured(),source:'Discord',reason:'operational absence',substitute_id:null,substitute_accepted:false};}
test('v1.2 members submit only their own Discord request; approval alone deducts and monthly renewal retains history',async()=>{
 await assert.rejects(command('helper','request_create',{...leave(users.helper.staff!),discord_url:'https://attacker.example/channels/123/234/345'}),/Discord/);
 await assert.rejects(command('helper','request_create',leave(users.moderator.staff!)),/طلبك فقط/);
 const pending=await command('helper','request_create',leave(users.helper.staff!));assert.equal((await dashboard('helper')).balances.leave_available,3);
 await assert.rejects(command('helper','request_decide',{id:pending.id,decision:'approved',reason:'self approval'}));
 await command('admin','request_decide',{id:pending.id,decision:'approved',reason:'verified'});assert.equal((await dashboard('helper')).balances.leave_available,2);
 const month=new Date(Date.now()+3*3600000).toISOString().slice(0,7)+'-01';
 const next=(await db.query<{v:any}>("select chico_balance($1,($2::date+interval '1 month')::date,($2::date+interval '1 month')::date) v",[users.helper.staff,month])).rows[0].v;assert.equal(next.leave_available,3);
 assert.equal((await db.query('select id from chico_requests where id=$1',[pending.id])).rows.length,1);
 const cancelled=await command('helper','request_create',leave(users.helper.staff!,23));await command('helper','request_cancel',{id:cancelled.id});assert.equal((await dashboard('helper')).balances.leave_available,2);
});
test('v1.2 username changes require recent verification, enforce uniqueness and preserve technical Auth identity',async()=>{
 const before=(await db.query<{auth_alias:string}>('select auth_alias from chico_private.login_identifiers where user_id=$1',[users.helper.id])).rows[0];
 await command('helper','self_username',{username:'new.helper'});assert.equal((await dashboard('helper')).account.username,'new.helper');
 await assert.rejects(command('moderator','self_username',{username:'NEW.HELPER'}));
 const after=(await db.query<{auth_alias:string}>('select auth_alias from chico_private.login_identifiers where user_id=$1',[users.helper.id])).rows[0];assert.deepEqual(after,before);
 assert.ok((await db.query<{v:any}>('select chico_service_lookup($1) v',['new.helper'])).rows[0].v);assert.equal((await db.query<{v:any}>('select chico_service_lookup($1) v',['test.helper'])).rows[0].v,null);
 await db.query("update chico_private.sessions set verified_at=now()-interval '1 hour' where token_hash=$1",[users.helper.hash]);await assert.rejects(command('helper','self_username',{username:'another.helper'}),/التحقق/);await db.query('select chico_service_verify($1)',[users.helper.hash]);
});
test('v1.2 own permanent history is readable but peers are denied; profile paths cannot target another account',async()=>{
 const history=(await asUser('helper',tx=>tx.query<{v:any[]}>('select chico_member_history($1) v',[users.helper.staff]))).rows[0].v;assert.ok(history.some(a=>a.action==='self_username'));assert.ok(history.some(a=>a.action==='request_decide'));assert.ok(history.some(a=>a.action==='points_void'));
 await assert.rejects(asUser('helper',tx=>tx.query('select chico_member_history($1)',[users.moderator.staff])),/سجلك فقط/);
 await assert.rejects(asUser('helper',tx=>tx.query('select chico_avatar_set($1)',[users.moderator.id+'/'+randomUUID()+'.png'])),/الصورة/);
 const path=users.helper.id+'/'+randomUUID()+'.png';await db.query("insert into storage.objects(bucket_id,name) values('chico-avatars',$1)",[path]);await asUser('helper',tx=>tx.query('select chico_avatar_set($1)',[path]));
 assert.equal((await asUser('helper',tx=>tx.query<{v:string}>('select chico_avatar_path($1) v',[users.helper.staff]))).rows[0].v,path);
 await assert.rejects(asUser('helper',tx=>tx.query("insert into storage.objects(bucket_id,name) values('chico-avatars',$1)",[users.helper.id+'/'+randomUUID()+'.png'])),/row-level security/);
});

test('v1.2 probation allowance is independent of approval order within the monthly quota',async()=>{
 const m=await command('owner','member_create',{display_name:'Probation order alias',rank:'helper',joined_at:'2025-01-01'});
 const base={...leave(String(m.id)),starts_at:'2025-01-31T00:00:00+03:00',ends_at:'2025-02-01T00:00:00+03:00'};
 const regular=await command('owner','request_create',base),early=await command('owner','request_create',{...base,starts_at:'2025-01-20T00:00:00+03:00',ends_at:'2025-01-21T00:00:00+03:00'});
 await command('owner','request_decide',{id:regular.id,decision:'approved',reason:'after probation'});
 await command('owner','request_decide',{id:early.id,decision:'approved',reason:'one probation day'});
 const usage=(await db.query<{v:any}>("select chico_balance($1,'2025-01-01','2025-01-31') v",[m.id])).rows[0].v;assert.equal(usage.leave_used,2);assert.equal(usage.leave_available,1);
});
test('v1.2 historic top preserves the measured rank after a promotion',async()=>{
 const period=(await db.query<{v:string}>('select chico_week(now())::text v')).rows[0].v;
 await command('owner','points_adjust',{staff_id:users.helper.staff,period_start:period,amount:500,reason:'test rank snapshot bonus'});
 await command('owner','rank_member',{staff_id:users.helper.staff,rank:'moderator',reason:'verified promotion'});
 const top=(await dashboard('moderator')).leaderboard.helpers;assert.equal(top.find((x:any)=>x.staff_id===users.helper.staff)?.rank,'helper');
 await command('owner','rank_member',{staff_id:users.helper.staff,rank:'helper',reason:'restore fixture rank'});
});
