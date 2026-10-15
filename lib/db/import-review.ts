import {AppError,config,rpc} from './supabase';
import {z} from 'zod';
import {rankSchema} from '../validation/schemas';
import {parseImportFile} from '../domain/imports';
import type {Session} from '../auth/session';
// Mapping, missing roster metadata and measurement time are explicit review decisions.
// Statistics and existing source metadata must match the bytes saved in private Storage.
export async function prepareImport(input:{type:'members'|'reports';file_hash:string;file_id:string;sheet?:string;rows:Record<string,unknown>[]},session:Session){
 const path=await rpc<string>('chico_file_path',{p_id:input.file_id},session.token);const c=config();
 const response=await fetch(c.url+'/storage/v1/object/authenticated/chico-files/'+path,{headers:{apikey:c.publishable,Authorization:'Bearer '+session.token},cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new AppError(502,'تعذر قراءة الملف المصدر للتحقق');const raw=await response.arrayBuffer();
 if(raw.byteLength>4*1024*1024)throw new AppError(413,'حجم المصدر أكبر من المسموح');
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(digest!==input.file_hash)throw new AppError(400,'بصمة الملف لا تطابق المصدر');
 const parsed=await parseImportFile(new File([raw],path.split('/').pop()??'source.csv'),input.sheet);
 const rows=validateReviewedRows(input,parsed);
 const preview=await rpc<string>('chico_service_import_prepare',{p_user:session.userId,p_type:input.type,p_hash:digest,p_file:input.file_id,p_rows:rows},undefined,true);
 return {rows,preview};
}
export function validateReviewedRows(input:{type:'members'|'reports';rows:Record<string,unknown>[]},parsed:Awaited<ReturnType<typeof parseImportFile>>){
 const seen=new Set<number>();
 const rows=input.rows.map(item=>{
  const index=Number(item._source_row);const original=parsed.rows.find(r=>r.index===index);
  if(!original||seen.has(index)||original.errors.length)throw new AppError(400,'السجل المصدر غير صالح أو مكرر: '+index);seen.add(index);
  if(input.type==='members'){
   if(item.display_name!==original.display_name||(original.rank&&item.rank!==original.rank)||(original.joined_at&&item.joined_at!==original.joined_at))throw new AppError(400,'بيانات العضو تختلف عن الملف في الصف '+index);
  }else{
   for(const key of ['tickets','hours','rating','complaints','requests_done','messages'] as const)if((['tickets','hours','rating'].includes(key)&&original[key]==null)||(item[key]??null)!==(original[key]??null))throw new AppError(400,'الأرقام تختلف عن المصدر في الصف '+index);
   if(item.flags_total!=null&&item.flags_total!==original.flags_total)throw new AppError(400,'الفلاجات تختلف عن المصدر في الصف '+index);
  }
  if(input.type==='members')return z.object({_source_row:z.number().int().positive(),staff_id:z.string().uuid().nullable(),display_name:z.string().min(2).max(60),rank:rankSchema,joined_at:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(item);
  return z.object({_source_row:z.number().int().positive(),staff_id:z.string().uuid(),measured_at:z.string().datetime({offset:true}),report_type:z.enum(['daily','weekly']),ticket_mode:z.enum(['week_to_date','daily_count']),tickets:z.number().int().min(0).max(100000),hours:z.number().min(0).max(168),rating:z.number().min(0).max(5),complaints:z.number().int().min(0).max(10000).nullable().optional(),requests_done:z.number().int().min(0).max(10000).nullable().optional(),messages:z.number().int().min(0).max(100000).nullable().optional(),report_id:z.string().uuid().optional(),expected_version:z.number().int().positive().optional(),correction_reason:z.string().max(1000).optional(),flags_total:z.number().int().min(0).max(10000).nullable()}).parse(item);
 });
 return rows;
}
