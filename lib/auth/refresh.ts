import {AppError} from '../db/supabase';
export interface RefreshRow {token_hash:string;tokens_cipher:string;access_expires_at:string;}
export interface TokenPair {access:string;refresh:string;}
export interface RefreshDependencies<T extends RefreshRow> {
 load:(hash:string)=>Promise<T|null>;lock:(hash:string)=>Promise<string|null>;
 save:(hash:string,lease:string,pair:TokenPair,expires:string)=>Promise<boolean>;
 release:(hash:string,lease:string)=>Promise<unknown>;revoke:(hash:string)=>Promise<unknown>;
 decode:(cipher:string)=>Promise<TokenPair>;refresh:(pair:TokenPair)=>Promise<{pair:TokenPair;expires:string}>;
 now:()=>number;pause:(ms:number)=>Promise<void>;
}
export async function refreshTokens<T extends RefreshRow>(stored:T,d:RefreshDependencies<T>):Promise<TokenPair>{
 let current=stored;
 for(let attempt=0;attempt<8;attempt++){
  if(+new Date(current.access_expires_at)>d.now()+60000)return d.decode(current.tokens_cipher);
  const lease=await d.lock(current.token_hash);
  if(lease){
   try{
    // Rotation may have finished after the initial read and before our lease.
    const fresh=await d.load(current.token_hash);if(!fresh)throw new AppError(401,'انتهت جلسة الدخول');
    const pair=await d.decode(fresh.tokens_cipher);
    if(+new Date(fresh.access_expires_at)>d.now()+60000){await d.release(current.token_hash,lease);return pair;}
    const rotated=await d.refresh(pair);
    if(!await d.save(current.token_hash,lease,rotated.pair,rotated.expires))throw new AppError(401,'انتهت جلسة الدخول');
    return rotated.pair;
   }catch(error){
    if(error instanceof AppError&&error.status===401)await d.revoke(current.token_hash);
    else {await d.release(current.token_hash,lease).catch(()=>undefined);throw new AppError(503,'تعذر تجديد الجلسة مؤقتًا. حاول بعد قليل.','SESSION_REFRESH_UNAVAILABLE');}
    throw error;
   }
  }
  await d.pause(120+attempt*80);const next=await d.load(current.token_hash);
  if(!next)throw new AppError(401,'انتهت جلسة الدخول');current=next;
 }
 throw new AppError(503,'جارٍ تجديد الجلسة؛ حاول بعد لحظة.','SESSION_REFRESH_BUSY');
}
