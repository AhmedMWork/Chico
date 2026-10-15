export class AppError extends Error { constructor(public status:number, message:string, public code='APP_ERROR'){super(message);} }
export interface RuntimeConfig {url:string;publishable:string;secret:string;encryption:string;rateKey:string;origin:string;}
export function config():RuntimeConfig {
 const url=process.env.SUPABASE_URL?.replace(/\/$/,'')??'';
 const publishable=process.env.SUPABASE_PUBLISHABLE_KEY??'';const secret=process.env.SUPABASE_SECRET_KEY??'';
 const encryption=process.env.SESSION_ENCRYPTION_KEY??'';const rateKey=process.env.RATE_LIMIT_HMAC_KEY??'';
 if(!url||!publishable||!secret||!/^[A-Za-z0-9_-]{43}$/.test(encryption)||Buffer.from(encryption,'base64url').length!==32||rateKey.length<32)throw new AppError(503,'لم يكتمل ربط قاعدة البيانات بعد. راجع إعدادات التشغيل.','NOT_CONFIGURED');
 const parsed=new URL(url);if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname))throw new AppError(503,'إعداد قاعدة البيانات غير صالح');
 return {url,publishable,secret,encryption,rateKey,origin:process.env.APP_ORIGIN??''};
}
export function isConfigured():boolean {try{config();return true;}catch{return false;}}
export async function supabase<T>(path:string,{method='POST',body,token,service=false}:{method?:string;body?:unknown;token?:string;service?:boolean}={}):Promise<T>{
 const c=config();const headers:Record<string,string>={'Content-Type':'application/json',apikey:service?c.secret:c.publishable};
 if(token)headers.Authorization='Bearer '+token;
 else if(service&&c.secret.startsWith('eyJ'))headers.Authorization='Bearer '+c.secret;
 let response:Response;
 try{response=await fetch(c.url+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(20000)});}
 catch{throw new AppError(503,'الاتصال بالخدمة متأخر أو غير متاح. حاول بعد قليل.','SERVICE_UNAVAILABLE');}
 let data:Record<string,unknown>|T|null=null;try{data=await response.json();}catch{}
 if(!response.ok){const error=data as Record<string,unknown>|null;const code=String(error?.code??error?.error_code??response.status);
  if(code==='42501'&&/التحقق/.test(String(error?.message??'')))throw new AppError(403,String(error?.message),'REAUTH_REQUIRED');
  if(code==='42501')throw new AppError(403,String(error?.message??'العملية غير مسموحة'),code);
  if(code==='23505')throw new AppError(409,'هذا السجل موجود بالفعل. راجع البيانات قبل إعادة الإرسال.',code);
  if(code==='P0001'||code==='22023'||code==='23514')throw new AppError(400,String(error?.message??'البيانات غير صالحة'),code);
  if(path.startsWith('/auth/'))throw new AppError(response.status>=500?503:response.status===429?429:401,response.status>=500?'خدمة الدخول غير متاحة مؤقتًا. حاول بعد قليل.':response.status===429?'محاولات كثيرة. انتظر قليلًا ثم حاول من جديد.':'تعذر التحقق من الحساب أو كلمة المرور.','AUTH_FAILED');
  throw new AppError(502,'تعذر إتمام العملية. حاول مرة أخرى، أو راجع سجل التشغيل.',code);
 }
 return data as T;
}
export function rpc<T>(name:string,body:Record<string,unknown>,token?:string,service=false):Promise<T>{return supabase<T>('/rest/v1/rpc/'+name,{body,token,service});}
