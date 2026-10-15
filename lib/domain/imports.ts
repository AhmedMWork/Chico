import type {Member,Rank} from './types';
export interface ImportRow {index:number;display_name:string;rank:string;joined_at:string;staff_id:string;tickets:number|null;hours:number|null;rating:number|null;flags_total:number|null;measured_at:string;complaints?:number|null;requests_done?:number|null;messages?:number|null;raw_numbers?:Record<string,string>;errors:string[];warnings:string[];}
export interface ParsedImport {rows:ImportRow[];sourceDate:string|null;sheet:string;legacy:boolean;sheets?:string[];}
function scalar(value:unknown):unknown {
 if(value&&typeof value==='object'){
  const cell=value as {result?:unknown;formula?:unknown;richText?:{text:string}[];text?:string};
  if(cell.richText)return cell.richText.map(v=>v.text).join('');
  if(cell.formula!==undefined)return cell.result??null;
  if(cell.text!==undefined)return cell.text;
 }
 return value;
}
function text(value:unknown):string {const v=scalar(value);return v==null?'':v instanceof Date?v.toISOString():String(v).trim();}
export function numeric(value:unknown):number|null {
 const v=scalar(value);if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;
 let raw=String(v).trim().replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/٫/g,'.');
 if(raw.includes('٬')){if(!/^[+-]?\d{1,3}(٬\d{3})+(\.\d+)?$/.test(raw))return null;raw=raw.replace(/٬/g,'');}
 if(raw.includes(',')){if(!/^[+-]?\d+,\d{1,2}$/.test(raw))return null;raw=raw.replace(',','.');}
 if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw))return null;const number=Number(raw);return Number.isFinite(number)?number:null;
}
export function canonicalRank(value:string):Rank|''{const lower=value.toLowerCase().replace(/\s/g,'');if(['helper','هيلبر','adminl1','l1','helper1'].includes(lower))return 'helper';if(['sn.helper','snhelper','senior_helper','seniorhelper','sn.helper1','snhelper1'].includes(lower))return 'senior_helper';if(['moderator','مودريتور','moderatorl2','adminl2','l2','moderator2'].includes(lower))return 'moderator';if(['administrator','admin','administratorl3','adminl3','l3','administrator3'].includes(lower))return 'administrator';if(['responsible','مسؤول','مسؤوال','responsible3','responsible4'].includes(lower))return 'responsible';return '';}
export function parseCsv(value:string):string[][]{
 const input=value.replace(/^\uFEFF/,'');const first=input.split(/\r?\n/,1)[0];const delimiter=first.includes('\t')?'\t':first.split(';').length>first.split(',').length?';':',';
 const rows:string[][]=[];let row:string[]=[];let field='';let quoted=false;
 for(let i=0;i<input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else if(quoted||field==='')quoted=!quoted;else field+=c;}
 else if(c===delimiter&&!quoted){row.push(field);field='';}
 else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field='';}else field+=c;
 if(rows.length>520)throw new Error('الملف أكبر من الحد المسموح: 500 سجل لكل دفعة.');}
 if(quoted)throw new Error('علامات الاقتباس في CSV غير مكتملة');row.push(field);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export function validateZip(data:ArrayBuffer){const v=new DataView(data);let end=-1;for(let i=v.byteLength-22;i>=Math.max(0,v.byteLength-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}if(end<0)throw new Error('ملف Excel غير صالح');
 const count=v.getUint16(end+10,true);let offset=v.getUint32(end+16,true);let total=0;if(count>250)throw new Error('ملف Excel يحتوي ملفات داخلية أكثر من المسموح');
 for(let i=0;i<count;i++){if(offset+46>v.byteLength||v.getUint32(offset,true)!==0x02014b50)throw new Error('تركيب ملف Excel غير صالح');total+=v.getUint32(offset+24,true);if(total>8*1024*1024)throw new Error('ملف Excel كبير جدًا بعد فك الضغط');offset+=46+v.getUint16(offset+28,true)+v.getUint16(offset+30,true)+v.getUint16(offset+32,true);}
}
export function rowsFromMatrix(matrix:unknown[][],sheet='CSV'):ParsedImport {
 const legacy=matrix.some(row=>row.some(v=>text(v)==='أسماء الإداريين')&&row.some(v=>text(v)==='الساعات الأسبوعية'));
 const headerIndex=legacy?matrix.findIndex(row=>row.some(v=>text(v)==='أسماء الإداريين')):matrix.findIndex(row=>row.some(v=>['display_name','اسم العضو','الاسم الظاهر','staff_id'].includes(text(v).toLowerCase())));
 if(matrix.some(row=>row.length>100||row.some(v=>text(v).length>20000)))throw new Error('أعمدة أو خلايا الملف أكبر من الحد المسموح');
 if(headerIndex<0)throw new Error('لم يُعثر على رؤوس الأعمدة. استخدم القالب أو ملف CHICO الأصلي.');
 const headers=matrix[headerIndex].map(v=>text(v).toLowerCase());const col=(...names:string[])=>headers.findIndex(h=>names.includes(h));
 const nameCol=col('display_name','اسم العضو','الاسم الظاهر','أسماء الإداريين');const rankCol=col('rank','الرتبة');const joinedCol=col('joined_at','تاريخ الانضمام');const staffCol=col('staff_id');
 const ticketCol=col('tickets','التذاكر');const hourCol=col('hours','الساعات الأسبوعية','الساعات');const ratingCol=col('rating','التقييم');const flagCol=col('flags_total','الفلاجات');const dateCol=col('measured_at','وقت القياس');
 const sourceDateValue=legacy?matrix.slice(0,headerIndex).flat().find(v=>v instanceof Date):null;
 const rows:ImportRow[]=[];
 for(let i=headerIndex+1;i<matrix.length;i++){
  const values=matrix[i];let display_name=nameCol<0?'':text(values[nameCol]);if(col('source_format')>=0&&text(values[col('source_format')])==='chico-1.1'&&display_name.startsWith("'"))display_name=display_name.slice(1);const staff_id=staffCol<0?'':text(values[staffCol]);
  if(!display_name&&!staff_id)continue;
  if(legacy&&/^(المجموع|الحد|هدف|الإجمالي|الاجمالي|إجمالي|اجمالي|target|total)/i.test(display_name))continue;
  // Legacy roster ends at its first empty line after member records.
  if(legacy&&rows.length&&i>headerIndex+1&&!matrix[i-1]?.some(v=>text(v)))break;
  const sourceIndex=col('source_row');const originalIndex=sourceIndex<0?i+1:Number(text(values[sourceIndex]));if(!Number.isInteger(originalIndex)||originalIndex<2||originalIndex>601)throw new Error('رقم الصف المصدر غير صالح');
  const row:ImportRow={index:originalIndex,display_name,rank:rankCol<0?'':canonicalRank(text(values[rankCol])),joined_at:joinedCol<0?'':text(values[joinedCol]).slice(0,10),staff_id,tickets:ticketCol<0?null:numeric(values[ticketCol]),hours:hourCol<0?null:numeric(values[hourCol]),rating:ratingCol<0?null:numeric(values[ratingCol]),flags_total:flagCol<0?null:numeric(values[flagCol]),measured_at:dateCol<0?'':text(values[dateCol]),errors:[],warnings:[]};
  const numberColumns={tickets:ticketCol,hours:hourCol,rating:ratingCol,flags_total:flagCol,complaints:col('complaints','الشكاوى'),requests_done:col('requests_done','الطلبات'),messages:col('messages','الرسائل')};
  row.raw_numbers={};for(const [key,index] of Object.entries(numberColumns)){if(index<0)continue;row.raw_numbers[key]=text(values[index]);if(['complaints','requests_done','messages'].includes(key))(row as unknown as Record<string,unknown>)[key]=numeric(values[index]);if(text(values[index])&&numeric(values[index])==null)row.errors.push('رقم غير واضح في '+key+': '+text(values[index])+'؛ استخدم نقطة عشرية أو فاصلة عشرية دون فصل الآلاف');}
  for(const key of ['tickets','flags_total','complaints','requests_done','messages'] as const){const value=row[key];if(value!=null&&(!Number.isInteger(value)||value<0||value>100000))row.errors.push('عدد صحيح غير سالب مطلوب: '+key);}
  if(rankCol>=0&&text(values[rankCol])&&!row.rank)row.errors.push('رتبة غير معروفة في المصدر؛ صحح الملف قبل الاعتماد.');
  for(const [key,max] of [['tickets',100000],['hours',168],['rating',5],['flags_total',10000]] as const){if(row[key]!=null&&(row[key]!<0||row[key]!>max))row.errors.push('قيمة غير صالحة: '+key);else if(col(key)>=0&&text(values[col(key)])&&row[key]==null)row.errors.push('قيمة رقمية غير مفهومة: '+key);}
  const sourceWarningCol=col('source_warning');if(sourceWarningCol>=0&&text(values[sourceWarningCol]))row.warnings.push(text(values[sourceWarningCol]).slice(0,1000));
  if(row.tickets===0&&row.hours===0&&row.rating===0)row.warnings.push('قيم صفرية كاملة؛ راجع هل هي أرقام فعلية أم بيانات غير مضافة.');
  if(!row.staff_id)row.warnings.push('الاسم وحده لا يثبت هوية العضو؛ راجع الربط.');
  rows.push(row);if(rows.length>500)throw new Error('الحد الأقصى 500 سجل لكل دفعة.');
 }
 return {rows,sourceDate:sourceDateValue instanceof Date?sourceDateValue.toISOString():null,sheet,legacy};
}
export async function parseImportFile(file:File,sheetName?:string):Promise<ParsedImport>{
 if(file.size>4*1024*1024)throw new Error('حجم الملف لا يزيد عن 4 ميجابايت');const extension=file.name.split('.').pop()?.toLowerCase();
 if(extension==='csv')return rowsFromMatrix(parseCsv(await file.text()));
 if(extension!=='xlsx')throw new Error('استخدم Excel بصيغة .xlsx أو ملف CSV');
 const bytes=await file.arrayBuffer();validateZip(bytes);const ExcelJS=await import('exceljs');const workbook=new (ExcelJS.default??ExcelJS).Workbook();await workbook.xlsx.load(bytes);
 const worksheet=sheetName?workbook.worksheets.find(s=>s.name===sheetName):workbook.worksheets.find(s=>s.rowCount>0);if(!worksheet)throw new Error('الملف لا يحتوي بيانات');if(worksheet.rowCount>600)throw new Error('عدد صفوف الملف أكبر من المسموح');if(worksheet.columnCount>100)throw new Error('عدد أعمدة الملف أكبر من المسموح');
 const matrix:unknown[][]=[];worksheet.eachRow({includeEmpty:true},row=>{const values:unknown[]=[];for(let i=1;i<=Math.min(100,worksheet.columnCount);i++)values.push(row.getCell(i).value);matrix.push(values);});return {...rowsFromMatrix(matrix,worksheet.name),sheets:workbook.worksheets.filter(s=>s.rowCount>0).map(s=>s.name)};
}
export function suggestMember(row:ImportRow,members:Member[]):{id:string;method:string}|null{
 if(row.staff_id){const match=members.find(m=>m.id===row.staff_id);return match?{id:match.id,method:'معرف العضو'}:null;}
 const matches=members.filter(m=>m.display_name.toLowerCase()===row.display_name.toLowerCase());return matches.length===1?{id:matches[0].id,method:'اسم مطابق يحتاج مراجعة'}:null;
}
export function csvCell(value:unknown){let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
