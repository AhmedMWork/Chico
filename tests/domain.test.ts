import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canPublish,hasCapability,weekDate,saudiDateTime,latestPerformance,goals} from '../lib/domain/rules';
import {csvCell,parseCsv,rowsFromMatrix,suggestMember,parseImportFile} from '../lib/domain/imports';
import {previewData} from '../lib/domain/preview';
import {memberState,effectiveGoals} from '../lib/domain/view';
import {config,AppError} from '../lib/db/supabase';
import {hash,encrypt,decrypt,randomToken,equalSecret} from '../lib/auth/crypto';
import {refreshTokens,type RefreshDependencies,type RefreshRow} from '../lib/auth/refresh';
import {sameOrigin,readJson} from '../lib/auth/security';
import {validateReviewedRows} from '../lib/db/import-review';
Object.assign(process.env,{SUPABASE_URL:'https://test.example',SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_SECRET_KEY:'test-server-key',SESSION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64url'),RATE_LIMIT_HMAC_KEY:'test-rate-key-'+ 'a'.repeat(32),APP_ORIGIN:'https://chico.example'});
test('Owner privilege never allows Helper or SN.Helper publication; stale approval grants fail closed',()=>{
 const a=previewData().account;for(const rank of ['helper','senior_helper'] as const){const actor={...a,owner:true,member:{...a.member!,rank}};assert.equal(canPublish(actor),false);assert.equal(hasCapability({...actor,owner:false,capabilities:['approve_accounts']},'approve_accounts'),false);}
 assert.equal(canPublish({...a,status:'pending'}),false);assert.equal(canPublish({...a,member:{...a.member!,game_status:'training'}}),false);
});
test('Saudi weekly boundary is Monday 03:00 with an exclusive end',()=>{
 assert.equal(weekDate('2026-10-12T02:59:59+03:00'),'2026-10-05');assert.equal(weekDate('2026-10-12T03:00:00+03:00'),'2026-10-12');assert.equal(weekDate('2026-10-19T03:00:00+03:00'),'2026-10-19');assert.equal(saudiDateTime('2026-10-12T22:00'),'2026-10-12T19:00:00.000Z');
});
test('Cumulative snapshots are not summed; weekly final is authoritative; only daily counts add',()=>{
 const template={...previewData().snapshots[0],status:'published' as const};const a={...template,tickets:30,measured_at:'2026-10-12T10:00:00Z'},b={...a,tickets:50,measured_at:'2026-10-13T10:00:00Z'};
 assert.equal(latestPerformance([a,b])?.tickets,50);assert.equal(latestPerformance([{...a,ticket_mode:'daily_count'},{...b,ticket_mode:'daily_count'}])?.tickets,80);
 assert.equal(latestPerformance([a,b,{...a,report_type:'weekly',tickets:75}])?.tickets,75);assert.equal(latestPerformance([]),null);
});
test('Missing flags are not zero and frozen historical targets survive policy changes',()=>{
 const data=previewData();const m=data.members[5];assert.equal(memberState(data,m).kind,'neutral');assert.equal(goals('administrator'),null);
 const perf=data.snapshots[0];data.settings.goals!.moderator!.tickets=999;assert.equal(effectiveGoals(data,data.members[0],perf)?.tickets,200);
});
test('CSV handles quotes, commas, line breaks, formula-safe exports and rejects malformed quoting',()=>{
 const rows=parseCsv('display_name,external_ref\r\n"Member, one","a"\r\n"Line\nTwo","b"');assert.equal(rows[1][0],'Member, one');assert.equal(rows[2][0],'Line\nTwo');assert.throws(()=>parseCsv('a,b\n"broken,x'));assert.equal(csvCell('=SUM(A1:A3)'),"\"'=SUM(A1:A3)\"");
});
test('Server import review rejects forged statistics and discards fields absent from the source',()=>{
 const parsed=rowsFromMatrix([['display_name','tickets','hours','rating','flags_total'],['Member sample',25,3,4.9,2]]);
 const row={_source_row:2,staff_id:'00000000-0000-4000-8000-000000000001',measured_at:'2026-10-12T10:00:00Z',report_type:'daily',ticket_mode:'week_to_date',tickets:25,hours:3,rating:4.9,flags_total:2};
 assert.throws(()=>validateReviewedRows({type:'reports',rows:[{...row,tickets:999}]},parsed),/تختلف عن المصدر/);assert.throws(()=>validateReviewedRows({type:'reports',rows:[row,row]},parsed),/مكرر/);
 const clean=validateReviewedRows({type:'reports',rows:[row]},parsed);assert.equal('complaints' in clean[0],false);assert.ok('tickets' in clean[0]);assert.equal(clean[0].tickets,25);
});
test('Excel dates normalize, unknown ranks error, zero rows warn, duplicate display names never auto-link',()=>{
 const parsed=rowsFromMatrix([['display_name','rank','joined_at','tickets','hours','rating'],['A name','unknown',new Date('2026-01-02'),0,0,0]]);assert.equal(parsed.rows[0].joined_at,'2026-01-02');assert.ok(parsed.rows[0].errors.length);assert.ok(parsed.rows[0].warnings.some(w=>w.startsWith('قيم صفرية')));
 const m=previewData().members[0];assert.equal(suggestMember({...parsed.rows[0],display_name:m.display_name},[m,{...m,id:'another'}]),null);
});
test('XLSX is read without evaluating formulas, with explicit source date and limits',async()=>{
 const Excel=await import('exceljs');const w=new (Excel.default??Excel).Workbook();const s=w.addWorksheet('Source');s.addRow(['Date',new Date('2026-12-10')]);s.addRow(['أسماء الإداريين','التذاكر','الفلاجات','التقييم','الساعات الأسبوعية']);s.addRow(['Sample',25,2,4.9,12]);s.addRow(['الإجمالي',{formula:'SUM(B3:B3)',result:25},2]);
 const parsed=await parseImportFile(new File([await w.xlsx.writeBuffer() as BlobPart],'source.xlsx'));assert.equal(parsed.sourceDate?.slice(0,10),'2026-12-10');assert.equal(parsed.rows[0].tickets,25);assert.equal(parsed.rows.length,1);
 await assert.rejects(parseImportFile(new File([new Uint8Array(4*1024*1024+1)],'huge.csv')),/4/);
});
test('Encrypted tokens reject tampering; random opaque cookies expose no Auth payload; configuration rejects wrong keys',async()=>{
 const value={access:'access-secret',refresh:'refresh-secret'};const cipher=await encrypt(value);assert.deepEqual(await decrypt(cipher),value);assert.equal(cipher.includes('access-secret'),false);const [iv,body]=cipher.split('.');await assert.rejects(decrypt(iv+'.'+(body[0]==='A'?'B':'A')+body.slice(1)));
 const a=randomToken(),b=randomToken();assert.equal(a.length,43);assert.notEqual(a,b);assert.equal((await hash(a)).length,64);assert.equal(await equalSecret('same','same'),true);assert.equal(await equalSecret('',''),false);
 const original=process.env.SESSION_ENCRYPTION_KEY;process.env.SESSION_ENCRYPTION_KEY='a'.repeat(40);assert.throws(config);process.env.SESSION_ENCRYPTION_KEY=original;
});
function dependencies(row:RefreshRow):RefreshDependencies<RefreshRow>&{calls:string[]}{const calls:string[]=[];return {calls,now:()=>100000,pause:async()=>{},decode:async cipher=>({access:cipher,refresh:cipher+'-refresh'}),load:async()=>row,lock:async()=>{calls.push('lock');return 'lease';},save:async()=>{calls.push('save');return true;},release:async()=>{calls.push('release');},revoke:async()=>{calls.push('revoke');},refresh:async pair=>{calls.push(pair.refresh);return {pair:{access:'new',refresh:'new-refresh'},expires:new Date(300000).toISOString()};}};}
test('Refresh re-reads after lease acquisition and never reuses the stale token',async()=>{
 const row={token_hash:'hash',tokens_cipher:'fresh',access_expires_at:new Date(300000).toISOString()};const d=dependencies(row);const out=await refreshTokens({...row,tokens_cipher:'stale',access_expires_at:new Date(0).toISOString()},d);assert.equal(out.access,'fresh');assert.deepEqual(d.calls,['lock','release']);
 const stale={...row,access_expires_at:new Date(0).toISOString()};const e=dependencies(stale);await refreshTokens({...stale,tokens_cipher:'older'},e);assert.ok(e.calls.includes('fresh-refresh'));assert.equal(e.calls.includes('older-refresh'),false);
});
test('Temporary refresh outages retain the session; invalid Auth tokens revoke it',async()=>{
 const row={token_hash:'hash',tokens_cipher:'old',access_expires_at:new Date(0).toISOString()};const d=dependencies(row);d.refresh=async()=>{throw new AppError(503,'outage');};await assert.rejects(refreshTokens(row,d),e=>e instanceof AppError&&e.status===503);assert.ok(d.calls.includes('release'));assert.equal(d.calls.includes('revoke'),false);
 const e=dependencies(row);e.refresh=async()=>{throw new AppError(401,'invalid');};await assert.rejects(refreshTokens(row,e));assert.ok(e.calls.includes('revoke'));
});
test('Cross-origin mutations and oversized or malformed JSON are denied',async()=>{
 assert.throws(()=>sameOrigin(new Request('https://chico.example/api/action',{method:'POST',headers:{origin:'https://attacker.example'}})));sameOrigin(new Request('https://chico.example/api/action',{method:'POST',headers:{origin:'https://chico.example'}}));
 await assert.rejects(readJson(new Request('https://chico.example',{method:'POST',headers:{'Content-Type':'application/json'},body:'not JSON'})));
 await assert.rejects(readJson(new Request('https://chico.example',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(101)}),100),e=>e instanceof AppError&&e.status===413);
});
