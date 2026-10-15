import {AppError,config,rpc} from '../db/supabase';
import {rateHash} from './crypto';
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');const actual=new URL(request.url).origin;const expected=config().origin||actual;
 if(!origin||origin!==expected||request.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'مصدر الطلب غير مسموح');
}
export async function rateLimit(request:Request,operation:string,username=''){
 const limits:[string,number,number][]=[[operation+':global',operation==='register'?120:1000,900]];
 if(username)limits.push([operation+':user:'+await rateHash(username.toLowerCase()),operation==='login'?12:5,900]);
 for(const [bucket,limit,window] of limits)if(!await rpc<boolean>('chico_service_rate',{p_bucket:bucket,p_limit:limit,p_window:window},undefined,true))throw new AppError(429,'محاولات كثيرة. انتظر قليلًا ثم حاول من جديد.');
}
export async function readJson(request:Request,maxBytes=150000){
 if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError(415,'نوع الطلب غير مدعوم');
 const length=Number(request.headers.get('content-length')??0);if(length>maxBytes)throw new AppError(413,'حجم البيانات أكبر من المسموح');
 const reader=request.body?.getReader();if(!reader)throw new AppError(400,'بيانات الطلب مطلوبة');let text='';let size=0;const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new AppError(413,'حجم البيانات أكبر من المسموح');}text+=decoder.decode(value,{stream:true});}
 text+=decoder.decode();try{return JSON.parse(text);}catch{throw new AppError(400,'بيانات الطلب غير صالحة');}
}
