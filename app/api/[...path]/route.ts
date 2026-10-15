import {z} from 'zod';
import {cookies} from 'next/headers';
import {AppError,config,isConfigured,rpc,supabase} from '@/lib/db/supabase';
import {decrypt,encrypt,equalSecret,hash,randomToken,rateHash} from '@/lib/auth/crypto';
import {cookieName,endSession,getSession,startSession,type AuthTokens} from '@/lib/auth/session';
import {recoverPassword} from '@/lib/auth/recovery';
import {rateLimit,readJson,sameOrigin} from '@/lib/auth/security';
import {actionSchemas,rankSchema,commandSchema,loginSchema,password,registerSchema} from '@/lib/validation/schemas';
import {prepareImport} from '@/lib/db/import-review';
import {uploadAvatar,avatarImage} from '@/lib/db/avatars';
import {uploadFile,fileUrl} from '@/lib/db/files';
import {normalizeUsername,weekDate} from '@/lib/domain/rules';
import type {DataBundle} from '@/lib/domain/types';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
async function dispatch(request:Request){
 const url=new URL(request.url);const path=url.pathname.replace(/^\/api\//,'');
 try{
  if(request.method==='GET'){
   if(path==='status')return response({configured:isConfigured(),version:'1.2.0'});
   const session=await getSession(path!=='me');
   if(path==='me')return response({account:session.account});
   if(path==='dashboard'){
    const period=url.searchParams.get('period')??weekDate();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(period))throw new AppError(400,'الفترة غير صالحة');
    return response(await rpc<DataBundle>('chico_dashboard',{p_period:period},session.token));
   }
   if(path.startsWith('avatars/'))return await avatarImage(z.string().uuid().parse(path.slice(8)),z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(url.searchParams.get('period')??weekDate()),session);
   if(path==='history'){const staff=z.string().uuid().parse(url.searchParams.get('staff_id')??session.account.member?.id);const before=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get('before')??Number.MAX_SAFE_INTEGER);return response(await rpc('chico_member_history',{p_staff:staff,p_before:before},session.token));}
   if(path.startsWith('files/'))return response(await fileUrl(z.string().uuid().parse(path.slice(6)),session));
   if(path==='audit'){const before=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).parse(url.searchParams.get('before')??Number.MAX_SAFE_INTEGER);return response(await rpc('chico_audit_page',{p_before:before},session.token));}
   if(path==='sessions')return response(await rpc('chico_my_sessions',{},session.token));
   throw new AppError(404,'الصفحة غير موجودة');
  }
  sameOrigin(request);
  if(path==='avatar')return response(await uploadAvatar(request,await getSession(true)),201);
  if(path==='files')return response(await uploadFile(request,await getSession(true)),201);
  const body=await readJson(request,600000);
  if(path==='register'){
   const input=registerSchema.parse(body);await rateLimit(request,'register',input.username);
   const normalized=normalizeUsername(input.username);
   if(await rpc('chico_service_lookup',{p_username:normalized},undefined,true))throw new AppError(409,'اسم الدخول غير متاح. اختر اسمًا آخر.');
   const alias=crypto.randomUUID()+'@accounts.chico.invalid';let id:string|undefined;
   try{
    const created=await supabase<{id:string}>('/auth/v1/admin/users',{service:true,body:{email:alias,password:input.password,email_confirm:true,user_metadata:{}}});id=created.id;
    await rpc('chico_service_register',{p_user:id,p_username:input.username,p_alias:alias},undefined,true);
   }catch(error){if(id)try{await supabase('/auth/v1/admin/users/'+id,{service:true,method:'DELETE'});}catch{/* Operator can reconcile orphan Auth identities; no associated account means access is denied. */}throw error;}
   const tokens=await supabase<AuthTokens>('/auth/v1/token?grant_type=password',{body:{email:alias,password:input.password}});
   await startSession(tokens,false);return response({ok:true,status:'pending'},201);
  }
  if(path==='login'){
   const input=loginSchema.parse(body);await rateLimit(request,'login',input.username);
   const identifier=await rpc<{user_id:string;auth_alias:string}|null>('chico_service_lookup',{p_username:normalizeUsername(input.username)},undefined,true);
   // Always ask Auth to verify a password, including an unknown Username.
   const email=identifier?.auth_alias??'unknown-account@accounts.chico.invalid';
   const tokens=await supabase<AuthTokens>('/auth/v1/token?grant_type=password',{body:{email,password:input.password}});
   if(!identifier||tokens.user.id!==identifier.user_id)throw new AppError(401,'تعذر التحقق من الحساب أو كلمة المرور.');
   await startSession(tokens,input.remember);return response({ok:true});
  }
  if(path==='recover'){
   const input=z.object({token:z.string().min(30).max(120),password,confirm:z.string()}).refine(v=>v.password===v.confirm,{message:'كلمتا المرور غير متطابقتين'}).parse(body);
   await rateLimit(request,'recover');const digest=await hash(input.token);await recoverPassword(digest,input.password);
   return response({ok:true,message:'تغيرت كلمة المرور. سجل الدخول بالكلمة الجديدة.'});
  }
  const session=await getSession(!['bootstrap','logout','password','verify'].includes(path));
  if(path==='logout'){await endSession(session,body.all===true);return response({ok:true});}
  if(path==='bootstrap'){
   const input=z.object({code:z.string().min(20).max(200),display_name:z.string().trim().min(2).max(60),rank:rankSchema,joined_at:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(body);await rateLimit(request,'bootstrap');
   if(!await equalSecret(input.code,config().bootstrap))throw new AppError(403,'رمز الإعداد غير صالح');
   await rpc('chico_service_bootstrap',{p_user:session.userId,p_display:input.display_name,p_rank:input.rank,p_joined:input.joined_at},undefined,true);return response({ok:true});
  }
  if(path==='verify'){
   const input=z.object({password:z.string().min(1).max(128)}).parse(body);
   await rateLimit(request,'verify',session.account.username);
   const identifier=await rpc<{auth_alias:string}>('chico_service_lookup',{p_username:session.account.username},undefined,true);
   const tokens=await supabase<AuthTokens>('/auth/v1/token?grant_type=password',{body:{email:identifier.auth_alias,password:input.password}});
   if(tokens.user.id!==session.userId)throw new AppError(401,'تعذر التحقق من كلمة المرور');
   try{await supabase('/auth/v1/logout?scope=local',{token:tokens.access_token});}catch{}
   await rpc('chico_service_verify',{p_hash:session.hash},undefined,true);return response({ok:true});
  }
  if(path==='password'){
   const input=z.object({current_password:z.string().min(1).max(128),password,confirm:z.string()}).refine(v=>v.password===v.confirm,{message:'كلمتا المرور غير متطابقتين'}).parse(body);await rateLimit(request,'password');
   const identifier=await rpc<{auth_alias:string}>('chico_service_lookup',{p_username:session.account.username},undefined,true);
   const verified=await supabase<AuthTokens>('/auth/v1/token?grant_type=password',{body:{email:identifier.auth_alias,password:input.current_password}});
   if(verified.user.id!==session.userId)throw new AppError(401,'تعذر التحقق من كلمة المرور الحالية');
   try{
    await rpc('chico_service_verify',{p_hash:session.hash},undefined,true);
    const token=randomToken(),digest=await hash(token);
    await rpc('chico_password_issue',{p_hash:digest},session.token);
    await recoverPassword(digest,input.password);
   }finally{try{await supabase('/auth/v1/logout?scope=local',{token:verified.access_token});}catch{}}
   await endSession(session,true);return response({ok:true,message:'تم تغيير كلمة المرور. سجل الدخول مجددًا.'});
  }
  if(path==='import'||path==='import-review'){
   const input=z.object({type:z.enum(['members','reports']),file_hash:z.string().regex(/^[a-f0-9]{64}$/),file_id:z.string().uuid(),sheet:z.string().max(100).optional(),rows:z.array(z.record(z.unknown())).min(1).max(500),confirmed:z.literal(true)}).parse(body);
   const reviewed=await prepareImport(input,session);
   if(path==='import-review')return response({ok:true,plan:await rpc('chico_import_plan',{p_preview:reviewed.preview},session.token)});
   return response({ok:true,result:await rpc('chico_import',{p_type:input.type,p_hash:input.file_hash,p_file:input.file_id,p_rows:reviewed.rows,p_preview:reviewed.preview,p_confirmed:true},session.token)});
  }
  if(path==='action'){
   const input=commandSchema.parse(body);
   const schema=actionSchemas[input.action];if(!schema)throw new AppError(400,'العملية غير معروفة');input.data=schema.parse(input.data);
   if(input.action==='recovery_issue'){
    const target=z.object({user_id:z.string().uuid()}).parse(input.data);const token=randomToken();
    await rpc('chico_recovery_issue',{p_user:target.user_id,p_hash:await hash(token)},session.token);
    return response({ok:true,token,expires_in:900});
   }
   return response({ok:true,result:await rpc('chico_command',{p_action:input.action,p_data:input.data},session.token)});
  }
  throw new AppError(404,'العملية غير موجودة');
 }catch(error){
  if(error instanceof z.ZodError)return response({error:error.issues.map(x=>x.message).join(' · '),code:'VALIDATION'},400);
  if(error instanceof AppError)return response({error:error.message,code:error.code},error.status);
  console.error('CHICO request failed',{path,type:error instanceof Error?error.name:'unknown'});
  return response({error:'تعذر إتمام الطلب. حاول مرة أخرى.',code:'INTERNAL'},500);
 }
}
export const GET=dispatch;
export const POST=dispatch;
