import {AppError,rpc,supabase} from '../db/supabase';
import {decrypt,encrypt,equalSecret} from './crypto';
// Both user-initiated password changes and admin-assisted recovery use the same durable fence.
export async function recoverPassword(digest:string,password:string){
 const operation=await rpc<{user_id:string;claim:string;cipher:string;state:string;completed?:boolean}|null>('chico_service_recovery_begin',{p_hash:digest,p_cipher:await encrypt({password})},undefined,true);
 if(!operation)throw new AppError(400,'رمز الاستعادة غير صالح أو انتهت مدته.');if(operation.completed)return;
 const credential=await decrypt<{password:string}>(operation.cipher);
 if(!await equalSecret(password,credential.password))throw new AppError(409,'بدأت عملية بهذا الرمز؛ أعد المحاولة بنفس كلمة المرور المختارة.');
 if(operation.state!=='auth_applied'){
  await rpc('chico_service_recovery_step',{p_hash:digest,p_claim:operation.claim,p_step:'applying'},undefined,true);
  try{await supabase('/auth/v1/admin/users/'+operation.user_id,{service:true,method:'PUT',body:{password:credential.password}});}
  catch{try{await rpc('chico_service_recovery_step',{p_hash:digest,p_claim:operation.claim,p_step:'ambiguous'},undefined,true);}catch{}throw new AppError(503,'نتيجة تغيير كلمة المرور غير مؤكدة. حُجبت الجلسات لحين مراجعة مسؤول التشغيل.','RECOVERY_PENDING');}
  // A failed acknowledgement leaves the fence in place; never start a second Auth mutation.
  await rpc('chico_service_recovery_step',{p_hash:digest,p_claim:operation.claim,p_step:'auth_applied'},undefined,true);
 }
 await rpc('chico_service_recovery_finish',{p_hash:digest,p_claim:operation.claim},undefined,true);
}
