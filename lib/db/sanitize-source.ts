import {z} from 'zod';
import {parseImportFile,csvCell} from '../domain/imports';
const isoDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(+new Date(v))&&new Date(v).toISOString().slice(0,10)===v);
const optionalUuid=z.union([z.literal(''),z.string().uuid()]);
// Only permitted operational columns survive. Hidden sheets, external identities and file metadata are discarded.
export async function sanitizeSource(file:File,sheet?:string):Promise<File>{
 const parsed=await parseImportFile(file,sheet);
 const headers=['source_format','source_row','staff_id','display_name','rank','joined_at','measured_at','tickets','hours','rating','complaints','requests_done','messages','flags_total'];
 const lines=[headers.map(csvCell).join(',')];
 for(const row of parsed.rows){
  optionalUuid.parse(row.staff_id);if(row.display_name)z.string().trim().min(2).max(60).parse(row.display_name);
  if(row.joined_at)isoDate.parse(row.joined_at);if(row.measured_at)z.string().datetime({offset:true}).parse(row.measured_at);
  // A known source format quotes aliases once, and the parser removes that single prefix.
  const record={...row,source_format:'chico-1.1',source_row:row.index,display_name:"'"+row.display_name};
  lines.push(headers.map(key=>csvCell(record[key as keyof typeof record])).join(','));
 }
 const output=new File(['\uFEFF'+lines.join('\r\n')],'source.csv',{type:'text/csv'});if(output.size>4*1024*1024)throw new Error('المصدر المنقح أكبر من 4 ميجابايت');return output;
}
