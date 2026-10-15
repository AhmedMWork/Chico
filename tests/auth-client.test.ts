import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuthRequestError,submitAuth} from '../lib/auth/client';
import {AppError,supabase} from '../lib/db/supabase';

test('Login sends Save login as a boolean with same-origin cookies and waits for confirmed success',async()=>{
 for(const remember of [false,true]){
  let calls=0;
  const result=await submitAuth('login',{username:'test.admin',password:'test-only',remember},{fetcher:async(url,options)=>{
   calls++;assert.equal(url,'/api/login');assert.equal(options?.method,'POST');assert.equal(options?.credentials,'same-origin');
   assert.equal(options?.cache,'no-store');assert.equal(options?.redirect,'error');
   assert.deepEqual(JSON.parse(String(options?.body)),{username:'test.admin',password:'test-only',remember});
   assert.ok(options?.signal);return Response.json({ok:true});
  }});
  assert.equal(calls,1);assert.deepEqual(result,{ok:true});
 }
});

test('Wrong credentials, rate limits and service failures remain visible and never retry automatically',async()=>{
 for(const [status,message] of [[401,'راجع Username وPassword'],[429,'محاولات كثيرة'],[503,'الخدمة غير متاحة']] as const){
  let calls=0;
  await assert.rejects(submitAuth('login',{}, {fetcher:async()=>{calls++;return Response.json({error:message},{status});}}),error=>{
   assert.ok(error instanceof AuthRequestError);assert.equal(error.message,message);assert.equal(error.status,status);return true;
  });
  assert.equal(calls,1);
 }
});

test('HTML, empty and malformed successful responses never count as a successful Login',async()=>{
 for(const response of [new Response('<html>Gateway page</html>'),new Response(null,{status:204}),Response.json({}),Response.json({ok:false}),Response.json({ok:'true'}),Response.json(null)]){
  await assert.rejects(submitAuth('login',{}, {fetcher:async()=>response}),error=>error instanceof AuthRequestError&&error.code==='RESPONSE');
 }
});

test('Non-JSON server failures use a readable message without exposing proxy content or parser errors',async()=>{
 await assert.rejects(submitAuth('login',{}, {fetcher:async()=>new Response('<html>private upstream detail</html>',{status:502})}),error=>{
  assert.ok(error instanceof AuthRequestError);assert.match(error.message,/خدمة الدخول/);assert.doesNotMatch(error.message,/private|JSON|Unexpected/);return true;
 });
});

test('A stalled request is bounded, aborted and sent only once',async()=>{
 let calls=0,signal:AbortSignal|null|undefined;
 await assert.rejects(submitAuth('login',{}, {timeoutMs:10,fetcher:async(_url,options)=>{calls++;signal=options?.signal;return await new Promise<Response>(()=>{});}}),error=>error instanceof AuthRequestError&&error.code==='TIMEOUT');
 assert.equal(calls,1);assert.equal(signal?.aborted,true);
});

test('A stalled response body is also bounded',async()=>{
 const response={ok:true,status:200,json:()=>new Promise(()=>{})} as Response;
 await assert.rejects(submitAuth('login',{}, {timeoutMs:10,fetcher:async()=>response}),error=>error instanceof AuthRequestError&&error.code==='TIMEOUT');
});

test('Interrupted registration and recovery explain uncertainty without replaying either mutation',async()=>{
 for(const mode of ['register','recover'] as const){
  let calls=0;
  await assert.rejects(submitAuth(mode,{}, {fetcher:async()=>{calls++;throw new TypeError('Network failed with internal detail');}}),error=>{
   assert.ok(error instanceof AuthRequestError);assert.equal(error.code,'NETWORK');assert.match(error.message,/Login/);assert.doesNotMatch(error.message,/internal detail/);return true;
  });
  assert.equal(calls,1);
 }
 const result=await submitAuth('recover',{}, {fetcher:async()=>Response.json({ok:true,message:'تم تغيير Password'})});
 assert.equal(result.message,'تم تغيير Password');
});

test('Supabase network failure becomes a retryable 503, while bad passwords remain 401',async()=>{
 const prior={...process.env},previousFetch=globalThis.fetch;
 Object.assign(process.env,{SUPABASE_URL:'https://test.invalid',SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'private-test',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,4).toString('base64url'),RATE_LIMIT_HMAC_KEY:'test-key-with-32-or-more-characters'});
 try{
  globalThis.fetch=async()=>{throw new TypeError('Internal network detail');};
  await assert.rejects(supabase('/auth/v1/token?grant_type=password'),error=>error instanceof AppError&&error.status===503&&error.code==='SERVICE_UNAVAILABLE'&&!error.message.includes('Internal'));
  globalThis.fetch=async()=>Response.json({error_code:'invalid_credentials'},{status:400});
  await assert.rejects(supabase('/auth/v1/token?grant_type=password'),error=>error instanceof AppError&&error.status===401);
  globalThis.fetch=async()=>Response.json({error_code:'over_request_rate_limit'},{status:429});
  await assert.rejects(supabase('/auth/v1/token?grant_type=password'),error=>error instanceof AppError&&error.status===429&&/محاولات/.test(error.message));
 }finally{globalThis.fetch=previousFetch;process.env=prior;}
});
