export type AuthMode = 'login' | 'register' | 'recover';
type AuthResult = {ok:true; message?:string};
type TransportOptions = {fetcher?:typeof fetch; timeoutMs?:number};

export class AuthRequestError extends Error {
 constructor(message:string, public code:'TIMEOUT'|'NETWORK'|'RESPONSE'|'REQUEST_FAILED', public status?:number){super(message);this.name='AuthRequestError';}
}

function uncertainMessage(mode:AuthMode, timedOut:boolean){
 const reason=timedOut?'الطلب أخذ وقت أطول من المتوقع.':'الاتصال انقطع قبل تأكيد النتيجة.';
 if(mode==='register')return reason+' جرّب Login بنفس البيانات للتأكد إن الحساب اتسجل.';
 if(mode==='recover')return reason+' جرّب Login بالـPassword الجديد قبل استخدام الرمز مرة ثانية.';
 return reason+' تأكد من اتصالك وحاول مرة ثانية.';
}

/** One attempt only. An interrupted signup or reset must never be replayed automatically. */
export async function submitAuth(mode:AuthMode,body:Record<string,unknown>,{fetcher=fetch,timeoutMs=45000}:TransportOptions={}):Promise<AuthResult>{
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
  reject(new AuthRequestError(uncertainMessage(mode,true),'TIMEOUT'));
  controller.abort();
 },timeoutMs);});
 const request=(async()=>{
  let response:Response;
  try{response=await fetcher('/api/'+mode,{
   method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
   body:JSON.stringify(body),credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
  });}catch{throw new AuthRequestError(uncertainMessage(mode,false),'NETWORK');}
  let result:unknown;
  try{result=await response.json();}catch{/* A proxy or interrupted response may return HTML or no body. */}
  const payload=result&&typeof result==='object'&&!Array.isArray(result)?result as Record<string,unknown>:null;
  if(!response.ok){
   const fallback=response.status===429?'محاولات كثيرة. انتظر قليلًا قبل المحاولة مرة ثانية.':response.status>=500?'خدمة الدخول مش متاحة حاليًا. حاول بعد قليل.':'ما قدرنا نكمل الطلب. راجع بياناتك وحاول مرة ثانية.';
   const message=typeof payload?.error==='string'&&payload.error.trim()&&payload.error.length<=500?payload.error:fallback;
   throw new AuthRequestError(message,'REQUEST_FAILED',response.status);
  }
  if(payload?.ok!==true)throw new AuthRequestError(uncertainMessage(mode,false),'RESPONSE',response.status);
  return {ok:true as const,...(typeof payload.message==='string'?{message:payload.message}:{})};
 })();
 try{return await Promise.race([request,deadline]);}finally{clearTimeout(timer);}
}
