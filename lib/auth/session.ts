import {cookies} from 'next/headers';
import {AppError,config,rpc,supabase} from '../db/supabase';
import {decrypt,encrypt,hash,jwtSessionId,randomToken} from './crypto';
import {refreshTokens} from './refresh';
import type {Account} from '../domain/types';
export interface AuthTokens {access_token:string;refresh_token:string;expires_at?:number;expires_in:number;user:{id:string};}
export interface StoredSession {token_hash:string;user_id:string;auth_session_id:string;tokens_cipher:string;access_expires_at:string;expires_at:string;verified_at:string;}
export interface Session {hash:string;token:string;refresh:string;userId:string;account:Account;}
export function cookieName(){return process.env.NODE_ENV==='production'?'__Host-chico-session':'chico-session';}
export async function startSession(tokens:AuthTokens,remember:boolean){
 const raw=randomToken();const digest=await hash(raw);const expiry=tokens.expires_at??Math.floor(Date.now()/1000)+tokens.expires_in;
 await rpc('chico_service_session_create',{p_user:tokens.user.id,p_auth_session:jwtSessionId(tokens.access_token),p_hash:digest,p_cipher:await encrypt({access:tokens.access_token,refresh:tokens.refresh_token}),p_access_expires:new Date(expiry*1000).toISOString(),p_remember:remember,p_agent:''},undefined,true);
 (await cookies()).set(cookieName(),raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',...(remember?{maxAge:30*86400}:{})});
}
async function refreshed(stored:StoredSession){
 return refreshTokens(stored,{
  load:digest=>rpc<StoredSession|null>('chico_service_session_get',{p_hash:digest},undefined,true),
  lock:digest=>rpc<string|null>('chico_service_refresh_lock',{p_hash:digest},undefined,true),
  save:async(digest,lease,pair,expires)=>rpc<boolean>('chico_service_refresh_save',{p_hash:digest,p_lease:lease,p_cipher:await encrypt(pair),p_access_expires:expires},undefined,true),
  release:(digest,lease)=>rpc('chico_service_refresh_release',{p_hash:digest,p_lease:lease},undefined,true),
  revoke:digest=>rpc('chico_service_revoke',{p_hash:digest,p_all:false},undefined,true),
  decode:decrypt,now:Date.now,pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  refresh:async pair=>{const tokens=await supabase<AuthTokens>('/auth/v1/token?grant_type=refresh_token',{body:{refresh_token:pair.refresh}});return {pair:{access:tokens.access_token,refresh:tokens.refresh_token},expires:new Date((tokens.expires_at??Math.floor(Date.now()/1000)+tokens.expires_in)*1000).toISOString()};}
 });
}
export async function getSession(requireActive=false):Promise<Session>{
 config();const raw=(await cookies()).get(cookieName())?.value;
 if(!raw||!/^[a-zA-Z0-9_-]{40,100}$/.test(raw))throw new AppError(401,'سجل الدخول أولًا');
 const digest=await hash(raw);const stored=await rpc<StoredSession|null>('chico_service_session_get',{p_hash:digest},undefined,true);
 if(!stored)throw new AppError(401,'انتهت جلسة الدخول. سجل الدخول مرة أخرى.');
 const pair=await refreshed(stored);const verified=await supabase<{id:string}>('/auth/v1/user',{method:'GET',token:pair.access});if(verified.id!==stored.user_id)throw new AppError(401,'جلسة الدخول غير صالحة');const account=await rpc<Account>('chico_me',{},pair.access);
 if(requireActive&&account.status!=='active')throw new AppError(403,'حسابك بانتظار الاعتماد أو غير متاح.');
 return {hash:digest,token:pair.access,refresh:pair.refresh,userId:stored.user_id,account};
}
export async function endSession(session:Session,all=false){
 await rpc('chico_service_revoke',{p_hash:session.hash,p_all:all},undefined,true);
 try{await supabase('/auth/v1/logout?scope='+(all?'global':'local'),{token:session.token});}catch{/* Application revocation already denies data, even if provider logout is unavailable. */}
 (await cookies()).set(cookieName(),'',{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:0});
}
