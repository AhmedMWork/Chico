import {AppError,config,rpc} from './supabase';
import type {Session} from '../auth/session';
import {canPublish,hasCapability} from '../domain/rules';
import {sanitizeSource} from './sanitize-source';
import {validateZip} from '../domain/imports';
const mimes:Record<string,string>={xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'};
async function boundedBody(request:Request,max:number):Promise<Uint8Array>{const reader=request.body?.getReader();if(!reader)throw new AppError(400,'الملف مطلوب');const pieces:Uint8Array[]=[];let size=0;while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new AppError(413,'حجم الملف أكبر من المسموح');}pieces.push(value);}const result=new Uint8Array(size);let offset=0;for(const piece of pieces){result.set(piece,offset);offset+=piece.length;}return result;}
export async function uploadFile(request:Request,session:Session){
 if(!hasCapability(session.account,'manage_imports'))throw new AppError(403,'رفع الملفات غير مسموح');
 const bytes=await boundedBody(request,4*1024*1024+20000);const form=await new Response(bytes as BodyInit,{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData();let file=form.get('file');
 if(!(file instanceof File)||file.size===0||file.size>4*1024*1024)throw new AppError(400,'اختر ملفًا لا يزيد عن 4 ميجابايت');if(!/\.(csv|xlsx)$/i.test(file.name))throw new AppError(400,'لضمان خصوصية البيانات، تقبل المصادر جداول CSV أو Excel التشغيلية فقط.');
 file=await sanitizeSource(file,typeof form.get('sheet')==='string'?String(form.get('sheet')):undefined);
 const ext=file.name.split('.').pop()?.toLowerCase()??'';const mime=mimes[ext];if(!mime)throw new AppError(400,'نوع الملف غير مسموح');
 const body=await file.arrayBuffer();const signature=new Uint8Array(body);if(ext==='xlsx')validateZip(body);
 if(ext==='png'&&!(signature[0]===137&&signature[1]===80&&signature[2]===78&&signature[3]===71))throw new AppError(400,'ملف PNG غير صالح');
 if(['jpg','jpeg'].includes(ext)&&!(signature[0]===255&&signature[1]===216&&signature[2]===255))throw new AppError(400,'ملف JPEG غير صالح');
 if(ext==='webp'&&!(new TextDecoder().decode(signature.slice(0,4))==='RIFF'&&new TextDecoder().decode(signature.slice(8,12))==='WEBP'))throw new AppError(400,'ملف WebP غير صالح');
 if(ext==='pdf'&&new TextDecoder().decode(signature.slice(0,5))!=='%PDF-')throw new AppError(400,'ملف PDF غير صالح');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const existing=await rpc<{id:string;path:string}|null>('chico_file_reuse',{p_hash:hash},session.token);if(existing)return {...existing,hash,reused:true};
 const path=session.userId+'/'+hash+'.'+ext;const c=config();const target=c.url+'/storage/v1/object/chico-files/'+path;
 const response=await fetch(target,{method:'POST',headers:{apikey:c.publishable,Authorization:'Bearer '+session.token,'Content-Type':mime,'x-upsert':'false'},body,signal:AbortSignal.timeout(20000)});
 if(!response.ok&&response.status!==409)throw new AppError(502,'تعذر حفظ الملف المصدر. راجع إعداد التخزين والصلاحيات.');
 try{const id=await rpc<string>('chico_service_file_register',{p_user:session.userId,p_path:path,p_name:'source-'+hash.slice(0,12)+'.'+ext,p_mime:mime,p_size:file.size,p_hash:hash},undefined,true);return {id,path,hash};}
 catch(error){try{await fetch(c.url+'/storage/v1/object/chico-files',{method:'DELETE',headers:{apikey:c.publishable,Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});}catch{}throw error;}
}
export async function fileUrl(id:string,session:Session){const path=await rpc<string>('chico_file_path',{p_id:id},session.token);const c=config();const r=await fetch(c.url+'/storage/v1/object/sign/chico-files/'+path,{method:'POST',headers:{apikey:c.publishable,Authorization:'Bearer '+session.token,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300}),cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new AppError(502,'تعذر إتاحة الملف');const data=await r.json() as {signedURL?:string;signedUrl?:string};const url=data.signedURL??data.signedUrl;if(!url)throw new AppError(502,'تعذر إتاحة الملف');return {url:url.startsWith('https://')?url:c.url+'/storage/v1'+url,expires_in:300};}
