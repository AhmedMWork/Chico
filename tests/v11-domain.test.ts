import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {numeric,rowsFromMatrix,parseImportFile} from '../lib/domain/imports';
import {sanitizeSource} from '../lib/db/sanitize-source';
import {effectiveGoals,teamSummary,flagsText} from '../lib/domain/view';
import {previewData} from './fixtures/dashboard';
import {validateReviewedRows} from '../lib/db/import-review';
test('v1.1 locale numbers distinguish decimal comma, Arabic digits and ambiguous separators',()=>{
 for(const [raw,value] of [['12,5',12.5],['١٢٫٥',12.5],['۱٫۵',1.5],['1٬234',1234],['4.85',4.85]] as const)assert.equal(numeric(raw),value);
 for(const raw of ['1,234','1,234.5','12.3.4','12 hours','12٬5'])assert.equal(numeric(raw),null);
 const parsed=rowsFromMatrix([['display_name','hours','rating'],['Alias','12,5','4,85']]);assert.equal(parsed.rows[0].hours,12.5);assert.equal(parsed.rows[0].rating,4.85);assert.equal(parsed.rows[0].raw_numbers?.hours,'12,5');
 const invalid=rowsFromMatrix([['اسم العضو','الساعات','التقييم'],['Alias','not numeric','4.9']]);assert.ok(invalid.rows[0].errors.length);
});
test('v1.1 source sanitation excludes external identity, metadata and arbitrary columns while preserving row identity',async()=>{
 const f=new File(['display_name,external_ref,email,phone,tickets,hours,rating\nAlias,discord-identity,private@example.invalid,01234,25,12.5,4.85'],'roster-private-name.csv');
 const safe=await sanitizeSource(f);const text=await safe.text();for(const forbidden of ['external_ref','discord-identity','email','private@example','phone','01234','roster-private'])assert.equal(text.includes(forbidden),false);
 assert.equal(safe.name,'source.csv');const parsed=await parseImportFile(safe);assert.equal(parsed.rows[0].index,2);assert.equal(parsed.rows[0].tickets,25);assert.equal(parsed.rows[0].hours,12.5);
 const legacy=new File(['source_row,display_name,tickets,hours,rating\n18,Alias,4,2,4.9'],'source.csv');const roundtrip=await parseImportFile(await sanitizeSource(legacy));assert.equal(roundtrip.rows[0].index,18);
});
test('v1.1 historical goals depend on the saved report rank instead of current promotion or demotion',()=>{
 const data=previewData(),member=data.account.member!;const report=data.snapshots.find(r=>r.staff_id===member.id)!;data.snapshots=[report];
 member.rank='administrator';report.rank_at_measurement='helper';report.target_snapshot={tickets:120,hours:14,rating:4.8,complaints:null,requests:null,messages:null};assert.equal(effectiveGoals(data,member)?.tickets,120);
 report.rank_at_measurement='administrator';report.target_snapshot=null;member.rank='helper';assert.equal(effectiveGoals(data,member),null);assert.doesNotThrow(()=>teamSummary(data));
});
test('v1.1 unreviewed flags remain unknown and import tasks must match the saved operational source',()=>{
 const data=previewData(),member=data.account.member!;data.flags=[];member.flags_reviewed=false;assert.equal(flagsText(data,member),'لم تُراجع');
 const parsed=rowsFromMatrix([['display_name','tickets','hours','rating','complaints','requests_done','messages'],['Alias','25','3','4.9','15','20','70']]);const row={_source_row:2,staff_id:'00000000-0000-4000-8000-000000000001',measured_at:'2026-10-12T10:00:00Z',report_type:'weekly',ticket_mode:'week_to_date',tickets:25,hours:3,rating:4.9,complaints:15,requests_done:20,messages:70,flags_total:null};
 const clean=validateReviewedRows({type:'reports',rows:[row]},parsed)[0];assert.ok('complaints' in clean);assert.equal(clean.complaints,15);assert.throws(()=>validateReviewedRows({type:'reports',rows:[{...row,messages:999}]},parsed),/تختلف/);
});

test('v1.1 sanitized aliases beginning with formula characters survive round-trip safely',async()=>{
 for(const alias of ['@Alias','+Alias','-Alias','=Alias',"'@Alias"]){
 const quoted='"'+alias.replace(/"/g,'""')+'"';const source=new File(['display_name,tickets,hours,rating\n'+quoted+',25,2,4.9'],'source.csv');const safe=await sanitizeSource(source);const rows=await parseImportFile(safe);assert.equal(rows.rows[0].display_name,alias);assert.ok((await safe.text()).includes('chico-1.1'));
 }
});
test('v1.1 sanitizer rejects external identifiers disguised as technical IDs and invalid date fields',async()=>{
 for(const csv of ['display_name,staff_id\nAlias,123456789012345678','display_name,joined_at\nAlias,2026-99-99','display_name,measured_at\nAlias,private@example.invalid'])await assert.rejects(sanitizeSource(new File([csv],'source.csv')));
});

test('v1.1 selected Excel sheet named CSV is sanitized instead of falling back to the first sheet',async()=>{
 const ExcelJS=await import('exceljs');const workbook=new (ExcelJS.default??ExcelJS).Workbook();for(const [name,tickets] of [['First',99],['CSV',25]] as const){const sheet=workbook.addWorksheet(name);sheet.addRow(['display_name','tickets','hours','rating']);sheet.addRow(['Alias',tickets,2,4.9]);}
 const bytes=await workbook.xlsx.writeBuffer();const source=new File([bytes as unknown as Uint8Array<ArrayBuffer>],'source.xlsx');const result=await parseImportFile(await sanitizeSource(source,'CSV'));assert.equal(result.rows[0].tickets,25);
});
