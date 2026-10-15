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
 for(const f of (await readdir('supabase/migrations')).filter(f=>f<'202610150005').sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 for(const name of ['owner','admin','moderator','helper','senior','pending']){
  const id=randomUUID(),session=randomUUID(),hash=(await import('node:crypto')).createHash('sha256').update(id).digest('hex');users[name]={id,session,hash};
  await db.query('insert into auth.users(id) values($1)',[id]);
  await db.query('select public.chico_service_register($1,$2,$3)',[id,'test.'+name,id+'@test.invalid']);
  await db.query("select public.chico_service_session_create($1,$2,$3,'test-cipher',now()+interval '1 hour',true,'test-client')",[id,session,hash]);
 }
 await db.query("select public.chico_service_bootstrap($1,'Test Owner')",[users.owner.id]);
 await rootActor('owner');
 for(const [name,rank] of [['admin','administrator'],['moderator','moderator'],['helper','helper'],['senior','senior_helper']]){
  const result=await command('owner','approve_account',{user_id:users[name].id,display_name:'Test '+name,rank,joined_at:'2025-01-01',decision:'active',approve_accounts:name==='admin'});users[name].staff=String(result.member_id);
 }
 const own=await db.query<{member_id:string}>('select member_id from public.chico_accounts where user_id=$1',[users.owner.id]);users.owner.staff=own.rows[0].member_id;
});
after(async()=>{await db.close();});

test('v1.1 upgrades an existing v1 database, removes client identifiers and quarantines old sources',async()=>{
 await db.query("update chico_members set external_ref='external-identity-to-remove' where id=$1",[users.helper.staff]);
 await db.query("insert into chico_private.rate_limits(bucket) values('login:ip:old-derived-identifier')");
 const path=users.owner.id+'/legacy.csv';await db.query("insert into storage.objects(bucket_id,name) values('chico-files',$1)",[path]);
 const file=(await db.query<{id:string}>("select chico_service_file_register($1,$2,'private-file-name.csv','text/csv',40,$3) id",[users.owner.id,path,'9'.repeat(64)])).rows[0].id;
 for(const f of (await readdir('supabase/migrations')).filter(f=>f>='202610150005').sort())await db.exec(await readFile('supabase/migrations/'+f,'utf8'));
 assert.equal((await db.query<{n:number}>("select count(*)::int n from chico_private.rate_limits where bucket like '%:ip:%'")).rows[0].n,0);
 assert.equal((await db.query<{n:number}>("select count(*)::int n from chico_private.sessions where user_agent<>''")).rows[0].n,0);
 assert.equal((await db.query<{external_ref:null}>('select external_ref from chico_members where id=$1',[users.helper.staff])).rows[0].external_ref,null);
 const source=(await db.query<{original_name:string;lifecycle:string}>('select original_name,lifecycle from chico_files where id=$1',[file])).rows[0];assert.equal(source.lifecycle,'quarantined');assert.equal(source.original_name.includes('private-file-name'),false);
 await assert.rejects(asUser('owner',tx=>tx.query('select chico_file_path($1)',[file])),/غير متاح/);
 await assert.rejects(db.query('select chico_service_import_prepare($1,$2,$3,$4,$5::jsonb)',[users.owner.id,'reports','9'.repeat(64),file,'[]']),/غير متاح/);
 const dto=(await asUser('owner',tx=>tx.query<{v:unknown}>('select chico_dashboard() v'))).rows[0].v;assert.equal(JSON.stringify(dto).includes('external-identity-to-remove'),false);assert.equal(JSON.stringify(dto).includes('user_agent'),false);
});
