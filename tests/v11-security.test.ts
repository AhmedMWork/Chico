import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rateLimit} from '../lib/auth/security';
import {recoverPassword} from '../lib/auth/recovery';
const env={SUPABASE_URL:'https://service.invalid',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'private-test',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url'),RATE_LIMIT_HMAC_KEY:'test-key-for-username-only-hash-1234567'};
test('v1.1 abuse limiting never reads IP or device headers and buckets contain no client identifier',async()=>{
 const previous=globalThis.fetch,prior={...process.env};Object.assign(process.env,env);const buckets:string[]=[];
 globalThis.fetch=async(_url,options)=>{buckets.push(JSON.parse(String(options?.body)).p_bucket);return Response.json(true);};
 try{await rateLimit({headers:{get(){throw new Error('Client header was read');}}} as unknown as Request,'login','alias.user');assert.equal(buckets[0],'login:global');assert.ok(buckets[1].startsWith('login:user:'));assert.equal(buckets.join().includes('alias.user'),false);assert.equal(buckets.join().includes(':ip:'),false);}
 finally{globalThis.fetch=previous;process.env=prior;}
});
test('v1.1 recovery retries completion without repeating Auth and blocks a timed-out mutation',async()=>{
 const previous=globalThis.fetch,prior={...process.env};Object.assign(process.env,env);let state='reserved',cipher='',authWrites=0,failFinish=true,timeout=false;
 globalThis.fetch=async(url,options)=>{const path=String(url),body=JSON.parse(String(options?.body??'{}'));
  if(path.includes('recovery_begin')){if(['applying','ambiguous'].includes(state))return Response.json({code:'P0001',message:'RECOVERY_PENDING'},{status:400});if(state==='completed')return Response.json({completed:true});cipher||=body.p_cipher;return Response.json({user_id:'00000000-0000-4000-8000-000000000001',claim:'00000000-0000-4000-8000-000000000002',cipher,state});}
  if(path.includes('recovery_step')){state=body.p_step;return Response.json(null);}
  if(path.includes('/auth/v1/admin/users/')){authWrites++;if(timeout)throw new Error('timeout');return Response.json({ok:true});}
  if(path.includes('recovery_finish')){if(failFinish){failFinish=false;return Response.json({code:'temporary'},{status:503});}state='completed';return Response.json(null);}
  throw new Error('Unexpected network request');};
 try{await assert.rejects(recoverPassword('a'.repeat(64),'a long password chosen for testing'));assert.equal(state,'auth_applied');await recoverPassword('a'.repeat(64),'a long password chosen for testing');assert.equal(authWrites,1);assert.equal(state,'completed');
  state='reserved';cipher='';timeout=true;await assert.rejects(recoverPassword('b'.repeat(64),'another long password for testing'),/غير مؤكدة/);assert.equal(state,'ambiguous');const count=authWrites;await assert.rejects(recoverPassword('b'.repeat(64),'another long password for testing'),/RECOVERY_PENDING/);assert.equal(authWrites,count);
 }finally{globalThis.fetch=previous;process.env=prior;}
});
