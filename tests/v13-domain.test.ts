import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {registerSchema,username} from '../lib/validation/schemas';
import {normalizeUsername} from '../lib/domain/rules';
import {validateOwnerInput,provisionInitialOwner} from '../scripts/provision-owner.mjs';
const input={username:'Owner Chico',password:'sample-pass-only-for-test',displayName:'Test game name',rank:'helper',joinedAt:'2025-01-01'};
test('v1.3 Owner username supports spaces while public signup reserves it',()=>{assert.equal(username.parse(' Owner  Chico '),'Owner Chico');assert.equal(normalizeUsername(' Owner  Chico '),'owner chico');assert.equal(registerSchema.safeParse({username:'Owner Chico',password:'test123',confirm:'test123'}).success,false);assert.equal(validateOwnerInput(input).username,'Owner Chico');});
test('v1.3 provisioning refuses an existing Owner before creating or changing Auth users',async()=>{const calls:string[]=[];await assert.rejects(provisionInitialOwner(input,async(path:string)=>{calls.push(path);return [{user_id:'existing-owner'}];}),/Owner بالفعل/);assert.equal(calls.length,1);assert.equal(calls.some(p=>p.startsWith('/auth/')),false);});
test('v1.3 provisioning never deletes an Auth identity after an uncertain uncommitted result',async()=>{
 const deleted:string[]=[],created='00000000-0000-4000-8000-000000000001';let state=0;
 const transport=async(path:string,body?:unknown,method?:string)=>{if(method==='DELETE'){deleted.push(path);return null;}if(path.includes('/chico_grants?'))return [];if(path.endsWith('chico_service_lookup'))return null;if(path.endsWith('chico_service_provision_state'))return ++state===1?{account_exists:false,owner:false}:{account_exists:false,owner:false};if(path==='/auth/v1/admin/users')return {id:created};throw Object.assign(new Error('timeout'),{uncertain:true});};
 await assert.rejects(provisionInitialOwner(input,transport),/غير مؤكدة/);assert.equal(deleted.length,0);
});
test('v1.3 provisioning recognizes a committed Owner after a lost RPC response',async()=>{
 const deleted:string[]=[];let checks=0;
 const result=await provisionInitialOwner(input,async(path:string,body?:unknown,method?:string)=>{if(method==='DELETE'){deleted.push(path);return null;}if(path.includes('/chico_grants?'))return [];if(path.endsWith('chico_service_lookup'))return null;if(path.endsWith('chico_service_provision_state'))return ++checks===1?{account_exists:false,owner:false}:{account_exists:true,owner:true};if(path==='/auth/v1/admin/users')return {id:'00000000-0000-4000-8000-000000000001'};throw Object.assign(new Error('timeout'),{uncertain:true});});
 assert.equal(result.reconciled,true);assert.equal(deleted.length,0);
});
test('v1.3 uncertain Auth creation persists its alias before the write and resumes that same identity',async()=>{
 let journal:any;let createCalls=0;const id='00000000-0000-4000-8000-000000000001';
 const transport=async(path:string,body?:any)=>{if(path.includes('/chico_grants?'))return [];if(path.endsWith('chico_service_lookup'))return null;if(path.endsWith('chico_service_provision_state'))return {account_exists:false,owner:false};if(path==='/auth/v1/admin/users'){assert.equal(journal.operation.stage,'auth_pending');assert.equal(journal.operation.alias,body.email);createCalls++;throw new Error('truncated response');}if(path.startsWith('/auth/v1/admin/users?'))return {users:[{id,email:journal.operation.alias}]};if(path.endsWith('chico_service_provision_owner'))return {user_id:id,owner:true};throw new Error('unexpected path');};
 const save=async(operation:any)=>{journal={operation:structuredClone(operation)};assert.equal(JSON.stringify(journal).includes(input.password),false);};
 await assert.rejects(provisionInitialOwner(input,transport,{save}),/--resume/);const alias=journal.operation.alias;
 const result=await provisionInitialOwner(input,transport,{operation:journal.operation,save});assert.equal(result.owner,true);assert.equal(journal.operation.alias,alias);assert.equal(createCalls,1);assert.equal(journal.operation.stage,'completed');
});
test('v1.3 definitive provisioning rejection cleans only a confirmed unused identity',async()=>{
 for(const outcome of ['unused','existing','unknown']){const deleted:string[]=[];let checks=0;
 const transport=async(path:string,body?:unknown,method?:string)=>{if(method==='DELETE'){deleted.push(path);return null;}if(path.includes('/chico_grants?'))return [];if(path.endsWith('chico_service_lookup'))return null;if(path.endsWith('chico_service_provision_state')){if(++checks===1)return {account_exists:false,owner:false};if(outcome==='unknown')throw new Error('lookup failed');return {account_exists:outcome==='existing',owner:false};}if(path==='/auth/v1/admin/users')return {id:'00000000-0000-4000-8000-000000000001'};throw Object.assign(new Error('rejected'),{uncertain:false});};
 await assert.rejects(provisionInitialOwner(input,transport));assert.equal(deleted.length,outcome==='unused'?1:0);
 }
});
test('v1.3 public routes contain no fixture imports, fake Owner or browser bootstrap',async()=>{
 assert.match(await readFile('app/preview/page.tsx','utf8'),/redirect\('\/app'\)/);assert.match(await readFile('app/setup/page.tsx','utf8'),/redirect\('\/app'\)/);
 for(const path of ['app/preview/page.tsx','app/app/page.tsx','app/page.tsx']){const source=await readFile(path,'utf8');assert.equal(source.includes('previewData'),false);assert.equal(source.includes('owner:true'),false);}
 const api=await readFile('app/api/[...path]/route.ts','utf8');assert.equal(api.includes("rpc('chico_service_bootstrap'"),false);assert.ok(api.includes("if(path==='bootstrap')throw new AppError(404"));const auth=await readFile('components/auth-panel.tsx','utf8');assert.equal(auth.includes('href="/preview"'),false);
});
