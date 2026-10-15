import {createInterface} from 'node:readline/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
export function validateOwnerInput(input){
 const name=input.username?.trim().replace(/ +/g,' '),normalized=name?.toLowerCase();
 if(!name||name.length<3||name.length>32||!(/^[a-zA-Z0-9][a-zA-Z0-9._ -]*$/).test(name))throw new Error('راجع اسم المستخدم');
 if(!input.password||input.password.length<6||input.password.length>128)throw new Error('كلمة المرور من 6 إلى 128 حرفًا');
 if(!['helper','senior_helper','moderator','administrator','responsible'].includes(input.rank))throw new Error('اختر رتبتك الفعلية');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.joinedAt)||!Number.isFinite(Date.parse(input.joinedAt))||new Date(input.joinedAt).toISOString().slice(0,10)!==input.joinedAt||input.joinedAt>new Date(Date.now()+10800000).toISOString().slice(0,10))throw new Error('راجع تاريخ الانضمام الفعلي');
 const display=input.displayName?.trim();if(!display||display.length<2||display.length>60)throw new Error('راجع اسم الإداري');
 return {...input,username:name,normalized,displayName:display};
}
export async function provisionInitialOwner(input,transport,options={}){
 const v=validateOwnerInput(input);
 const operation=options.operation??{id:randomUUID(),alias:randomUUID()+'@accounts.chico.invalid',stage:'new'};
 const save=async()=>{if(options.save)await options.save(operation);};
 if(!/^[a-f0-9-]{36}$/.test(operation.id)||!(/^[a-f0-9-]{36}@accounts\.chico\.invalid$/).test(operation.alias))throw new Error('ملف العملية غير صالح');
 if(operation.userId){const state=await transport('/rest/v1/rpc/chico_service_provision_state',{p_user:operation.userId});if(state.owner){operation.stage='completed';await save();return {user_id:operation.userId,owner:true,reconciled:true};}if(state.account_exists)throw new Error('الهوية مرتبطة بحساب قائم؛ راجع المشغل.');}
 const owners=await transport('/rest/v1/chico_grants?capability=eq.owner&select=user_id&limit=1',undefined,'GET');
 if(owners.length)throw new Error('الموقع له Owner بالفعل. لا يتم استبداله أو تغيير كلمته من هذه الأداة.');
 const existing=await transport('/rest/v1/rpc/chico_service_lookup',{p_username:v.normalized});
 if(existing)throw new Error('اسم المستخدم مرتبط بحساب قائم. لا يتم منحه ملكية تلقائيًا.');
 await transport('/rest/v1/rpc/chico_service_provision_state',{p_user:randomUUID()});
 if(operation.stage==='auth_pending'&&!operation.userId){
  // Recover only the exact technical alias saved before creation; never select by a human username.
  for(let page=1;page<=1000;page++){const data=await transport('/auth/v1/admin/users?page='+page+'&per_page=1000',undefined,'GET');if(!Array.isArray(data?.users))throw new Error('تعذر التحقق من هوية العملية السابقة');const found=data.users.find(u=>u.email===operation.alias);if(found){operation.userId=found.id;operation.stage='auth_created';await save();break;}if(data.users.length<1000)break;}
  if(!operation.userId)throw new Error('إنشاء الهوية السابقة غير مؤكد. احتفظ بملف العملية وراجع المشغل؛ لا تنشئ عملية جديدة.');
 }
 if(!operation.userId){
  operation.stage='auth_pending';await save();
  try{const created=await transport('/auth/v1/admin/users',{email:operation.alias,password:v.password,email_confirm:true,user_metadata:{}});if(!created?.id)throw new Error('incomplete response');operation.userId=created.id;operation.stage='auth_created';await save();}
  catch{throw new Error('تعذر تأكيد إنشاء الهوية. العملية محفوظة: '+operation.id+'؛ شغّل الأداة مع --resume لمراجعة نفس الهوية.');}
 }
 const createdId=operation.userId;
 try{const result=await transport('/rest/v1/rpc/chico_service_provision_owner',{p_user:createdId,p_alias:operation.alias,p_username:v.username,p_display:v.displayName,p_rank:v.rank,p_joined:v.joinedAt});operation.stage='completed';await save();return result;}
 catch(error){let state;try{state=await transport('/rest/v1/rpc/chico_service_provision_state',{p_user:createdId});}catch{}
  if(state?.owner){operation.stage='completed';await save();return {user_id:createdId,owner:true,reconciled:true};}
  if(error.uncertain!==false||!state||state.account_exists){const pending=new Error('نتيجة التجهيز غير مؤكدة. احتفظ بملف العملية واستخدم --resume. معرف الحساب: '+createdId);pending.userId=createdId;throw pending;}
  try{await transport('/auth/v1/admin/users/'+createdId,undefined,'DELETE');operation.stage='cleaned';await save();}catch{}
  throw new Error('لم يكتمل تجهيز المالك. راجع تطبيق ملفات SQL وصلاحية مفتاح الخادم.');
 }
}
function hiddenPassword(prompt){return new Promise((resolve,reject)=>{if(!process.stdin.isTTY||!process.stdin.setRawMode){reject(new Error('افتح Terminal تفاعلي لإدخال كلمة المرور بدون عرضها.'));return;}process.stdout.write(prompt);let value='';const input=process.stdin;input.setRawMode(true);input.resume();input.setEncoding('utf8');const finish=()=>{input.off('data',onData);input.setRawMode(false);input.pause();process.stdout.write('\n');};function onData(data){for(const char of data){if(char==='\u0003'){finish();reject(new Error('تم الإلغاء'));return;}if(char==='\r'||char==='\n'){finish();resolve(value);return;}if(char==='\u007f'||char==='\b'){if(value){value=value.slice(0,-1);process.stdout.write('\b \b');}}else if(char>=' '){value+=char;process.stdout.write('*');}}}input.on('data',onData);});}
async function main(){
 const url=process.env.SUPABASE_URL?.replace(/\/$/,''),secret=process.env.SUPABASE_SECRET_KEY;if(!url||!secret)throw new Error('أكمل SUPABASE_URL وSUPABASE_SECRET_KEY في ملف البيئة المحلي. لا ترسلهما في الشات.');if(new URL(url).protocol!=='https:')throw new Error('عنوان Supabase يجب أن يستخدم HTTPS');
 const transport=async(path,body,method=body===undefined?'GET':'POST')=>{let r;try{r=await fetch(url+path,{method,headers:{apikey:secret,'Content-Type':'application/json',...(secret.startsWith('eyJ')?{Authorization:'Bearer '+secret}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});}catch{const error=new Error('تعذر تأكيد نتيجة خدمة الحسابات');error.uncertain=true;throw error;}if(!r.ok){const error=new Error('خدمة الحسابات رفضت العملية ('+r.status+')');error.uncertain=r.status>=500||r.status===408;throw error;}if(r.status===204)return null;try{return await r.json();}catch{const error=new Error('استجابة غير مكتملة من خدمة الحسابات');error.uncertain=true;throw error;}};
 if(process.argv[2]==='--check'){const id=process.argv[3];if(!/^[a-f0-9-]{36}$/.test(id??''))throw new Error('أدخل معرف العملية الصحيح');console.log(JSON.stringify(await transport('/rest/v1/rpc/chico_service_provision_state',{p_user:id})));return;}
 const journal=resolve('.owner-provision.json');let saved;
 try{saved=JSON.parse(await readFile(journal,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('راجع ملف العملية المحفوظ قبل المتابعة');}
 if(saved&&process.argv[2]!=='--resume')throw new Error('توجد عملية محفوظة. استخدم --resume بدل إنشاء عملية أخرى.');
 if(process.argv[2]==='--resume'&&!saved)throw new Error('لا يوجد ملف عملية محفوظ في هذا المجلد');
 if(saved&&saved.projectUrl!==url)throw new Error('ملف العملية يخص مشروعًا آخر');
 if(saved?.operation?.stage==='completed'){const state=await transport('/rest/v1/rpc/chico_service_provision_state',{p_user:saved.operation.userId});if(state.owner){console.log('المالك مجهز بالفعل. ادخل بحسابك.');return;}throw new Error('تم تغيير ملكية العملية السابقة؛ لا تعاد تهيئتها.');}
 if(saved?.operation?.stage==='cleaned')throw new Error('تم تنظيف الهوية بعد رفض سابق. راجع السبب قبل أرشفة ملف العملية وبدء محاولة جديدة.');
 const rl=createInterface({input:process.stdin,output:process.stdout});let username,displayName,rank,joinedAt;
 try{if(saved){({username,displayName,rank,joinedAt}=saved.input);}else{username=(await rl.question('Username [Owner Chico]: '))||'Owner Chico';displayName=(await rl.question('اسم الإداري داخل اللعبة: '));rank=(await rl.question('رتبتك: helper / senior_helper / moderator / administrator / responsible: '));joinedAt=await rl.question('تاريخ الانضمام الفعلي YYYY-MM-DD: ');}}finally{rl.close();}
 const password=await hiddenPassword('كلمة المرور: '),confirm=await hiddenPassword('تأكيد كلمة المرور: ');if(password!==confirm)throw new Error('كلمتا المرور غير متطابقتين');
 const safeInput={username,displayName,rank,joinedAt};
 const result=await provisionInitialOwner({...safeInput,password},transport,{operation:saved?.operation,save:async operation=>{await writeFile(journal,JSON.stringify({projectUrl:url,input:safeInput,operation},null,2)+'\n',{mode:0o600});}});console.log('تم تجهيز المالك. ادخل باسم المستخدم: '+username);console.log('معرف الحساب: '+result.user_id);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await main();}catch(error){console.error(error.message);process.exitCode=1;}}
