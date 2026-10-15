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


async function feed(name:string,before?:string,id?:string){return(await asUser(name,tx=>tx.query<{v:any}>('select chico_notification_feed($1,$2) v',[before??null,id??null]))).rows[0].v;}
async function dto(name:string){return(await asUser(name,tx=>tx.query<{v:any}>('select chico_dashboard() v'))).rows[0].v;}
test('v1.3 names allow canonical internal spaces but public registration cannot claim the Owner name',async()=>{
 const id=randomUUID();await db.query('insert into auth.users(id) values($1)',[id]);
 await assert.rejects(db.query('select chico_service_register($1,$2,$3)',[id,' OWNER   CHICO ',id+'@accounts.chico.invalid']),/غير متاح/);
 await db.query('select chico_service_register($1,$2,$3)',[id,' Regular  Team ',id+'@accounts.chico.invalid']);
 const found=(await db.query<{v:any}>('select chico_service_lookup($1) v',['regular   team'])).rows[0].v;assert.equal(found.user_id,id);
 assert.equal((await db.query('select user_id from chico_grants where user_id=$1',[id])).rows.length,0);
 await command('owner','self_username',{username:'Owner  Chico'});assert.equal((await dto('owner')).account.username,'Owner Chico');
 await assert.rejects(command('helper','self_username',{username:'Owner Chico'}),/غير متاح/);
 assert.equal((await db.query<{v:any}>('select chico_service_lookup($1) v',['owner chico'])).rows[0].v.user_id,users.owner.id);
});
test('v1.3 registration alerts follow current management roles instead of legacy grants',async()=>{
 await db.query("delete from chico_grants where user_id=$1 and capability<>'owner'",[users.admin.id]);
 await db.query("insert into chico_grants(user_id,capability) values($1,'approve_accounts')",[users.helper.id]);
 const id=randomUUID();await db.query('insert into auth.users(id) values($1)',[id]);await db.query('select chico_service_register($1,$2,$3)',[id,'new registration',id+'@accounts.chico.invalid']);
 const rows=(await db.query<{user_id:string;audience:string}>('select user_id,audience from chico_notifications where event_key=$1',['registration:'+id])).rows;
 assert.ok(rows.some(n=>n.user_id===users.owner.id));assert.ok(rows.some(n=>n.user_id===users.admin.id));assert.equal(rows.some(n=>n.user_id===users.helper.id),false);assert.ok(rows.every(n=>n.audience==='management'));
});
test('v1.3 committed operational events notify subjects and managers without exposing report values to peers',async()=>{
 const result=await command('moderator','report',{staff_id:users.moderator.staff,measured_at:new Date(Date.now()-60000).toISOString(),report_type:'daily',ticket_mode:'week_to_date',tickets:34789,hours:13,rating:4.91,source:'private operational evidence',publish:true});
 const own=await feed('moderator');assert.ok(own.rows.some((n:any)=>n.title==='تحديث الإحصائيات'));assert.ok((await feed('admin')).rows.some((n:any)=>n.title==='تحديث الإحصائيات'));
 const peer=await feed('helper');assert.equal(peer.rows.some((n:any)=>n.title==='تحديث الإحصائيات'),false);
 for(const who of ['helper','moderator','admin']){const body=JSON.stringify((await feed(who)).rows);assert.equal(body.includes('34789'),false);assert.equal(body.includes('private operational evidence'),false);}
 const audit=(await db.query<{id:number}>('select id from chico_audit where target_id=$1',[result.id])).rows[0];const notices=(await db.query<{n:number}>('select count(*)::int n from chico_notifications where event_key=$1',['audit:'+audit.id])).rows[0].n;assert.equal(notices,3);
});
test('v1.3 demotion removes old management notices through RLS, feed and dashboard',async()=>{
 assert.ok((await feed('admin')).rows.some((n:any)=>n.audience==='management'));
 await command('owner','rank_member',{staff_id:users.admin.staff,rank:'administrator',reason:'role scope test'});
 assert.equal((await feed('admin')).can_manage,false);assert.equal((await dto('admin')).notifications_can_manage,false);assert.equal((await feed('admin')).rows.some((n:any)=>n.audience==='management'),false);
 assert.equal((await asUser('admin',tx=>tx.query("select id from chico_notifications where audience='management'"))).rows.length,0);
 assert.equal((await dto('admin')).notifications.some((n:any)=>n.audience==='management'),false);
 await command('owner','rank_member',{staff_id:users.admin.staff,rank:'responsible',reason:'restore role'});
});
test('v1.3 read-all is scoped to current recipient and notification pagination has no duplicate cursor rows',async()=>{
 const before=(await feed('owner')).unread_count;assert.ok(before>0);await command('moderator','notification_read_all',{});assert.equal((await feed('moderator')).unread_count,0);assert.equal((await feed('owner')).unread_count,before);
 for(let i=0;i<70;i++)await db.query("insert into chico_notifications(user_id,title,event_key,created_at) values($1,'pagination notice',$2,'2026-12-01T00:00:00Z')",[users.pending.id,'page:'+i]);
 const a=await feed('pending'),last=a.rows[a.rows.length-1],b=await feed('pending',last.created_at,last.id);assert.equal(a.rows.length,50);assert.equal(b.rows.length,21);assert.equal(new Set([...a.rows,...b.rows].map((n:any)=>n.id)).size,71);
});
test('v1.3 notifications roll back with the operation and security notices reveal no recovery secrets',async()=>{
 const before=(await feed('helper')).unread_count;
 await assert.rejects(db.transaction(async tx=>{await tx.query("insert into chico_audit(actor,action,target_id) values($1,'member_edit',$2)",[users.owner.id,users.helper.staff]);throw new Error('rollback operation');}),/rollback/);
 assert.equal((await feed('helper')).unread_count,before);
 const hash='a'.repeat(64),cipher='private-encrypted-test-password';
 await db.query("insert into chico_private.recovery_tokens(user_id,token_hash,issued_by,expires_at,password_cipher,recovery_state) values($1,$2,$3,now()+interval '15 minutes',$4,'auth_applied')",[users.helper.id,hash,users.owner.id,cipher]);
 await db.query("insert into chico_audit(actor,action,target_id,after_data) values($1,'recovery_issued',$2,$3)",[users.owner.id,users.helper.id,JSON.stringify({token_hash:hash,password_cipher:cipher})]);
 await db.query("update chico_private.recovery_tokens set recovery_state='completed',password_cipher=null,consumed_at=now() where token_hash=$1",[hash]);
 await db.query("update chico_private.recovery_tokens set recovery_state='completed' where token_hash=$1",[hash]);
 const session=(await db.query<{id:string}>('select id from chico_private.sessions where auth_session_id=$1',[users.helper.session])).rows[0].id;
 await db.query("insert into chico_audit(actor,action,target_id) values($1,'session_revoke',$2)",[users.helper.id,session]);
 const rows=(await feed('helper')).rows;assert.ok(rows.some((n:any)=>n.title==='تم إصدار رمز استعادة لحسابك'));assert.ok(rows.some((n:any)=>n.title==='تم إنهاء جلسة دخول'));assert.equal(rows.filter((n:any)=>n.title==='تم تغيير كلمة المرور').length,1);
 const all=JSON.stringify((await db.query('select * from chico_notifications')).rows);assert.equal(all.includes(hash),false);assert.equal(all.includes(cipher),false);
});
test('v1.3 visitor tokens cannot provision ownership; service provisioning is atomic and refuses a second Owner',async()=>{
 const id=randomUUID();await db.query('insert into auth.users(id) values($1)',[id]);
 const args=[id,id+'@accounts.chico.invalid','Owner Chico','Owner game name','helper','2025-01-01'];
 await assert.rejects(asUser('helper',tx=>tx.query('select chico_service_provision_owner($1,$2,$3,$4,$5,$6)',args)),/permission denied/);
 await assert.rejects(db.query('select chico_service_provision_owner($1,$2,$3,$4,$5,$6)',args),/المالك بالفعل/);
 await db.query("delete from chico_grants where capability='owner'");
 await db.query("update chico_private.login_identifiers set username='old.owner',username_normalized='old.owner' where user_id=$1",[users.owner.id]);
 const result=(await db.query<{v:any}>('select chico_service_provision_owner($1,$2,$3,$4,$5,$6) v',args)).rows[0].v;assert.equal(result.owner,true);
 assert.equal((await db.query<{rank:string}>('select rank from chico_members where id=$1',[result.member_id])).rows[0].rank,'helper');
 assert.equal((await db.query<{v:any}>('select chico_service_provision_state($1) v',[id])).rows[0].v.owner,true);
 await assert.rejects(db.query('select chico_service_provision_owner($1,$2,$3,$4,$5,$6)',args),/المالك بالفعل/);
 assert.equal((await db.query("select user_id from chico_grants where capability='owner'")).rows.length,1);
});
