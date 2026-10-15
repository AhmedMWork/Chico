import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {sanitizeAvatar} from '../lib/db/avatars';
import {password,registerSchema,actionSchemas} from '../lib/validation/schemas';
import {canManage,hasCapability,canPublish} from '../lib/domain/rules';
import {previewData} from './fixtures/dashboard';
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type:string,body:Uint8Array){const b=Buffer.alloc(body.length+12);b.writeUInt32BE(body.length);b.write(type,4);b.set(body,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function png(width=1,extras:Buffer[]=[]){const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...extras,chunk('IDAT',deflateSync(Buffer.from([0,220,180,110,255]))),chunk('IEND',Buffer.alloc(0))]);}
test('v1.2 six-character passwords work consistently; five fail and signup confirmation still matters',()=>{
 assert.equal(password.safeParse('123456').success,true);assert.equal(password.safeParse('12345').success,false);assert.equal(registerSchema.safeParse({username:'test.user',password:'123456',confirm:'123456'}).success,true);assert.equal(registerSchema.safeParse({username:'test.user',password:'123456',confirm:'654321'}).success,false);
});
test('v1.2 server avatar sanitation removes EXIF, text and trailing bytes while retaining image pixels',()=>{
 const image=png(),privateImage=Buffer.concat([png(1,[chunk('tEXt',Buffer.from('Author\0private name')),chunk('eXIf',Buffer.from('location metadata'))]),Buffer.from('trailing metadata')]);const output=sanitizeAvatar(privateImage);assert.deepEqual(Buffer.from(output),image);assert.equal(new TextDecoder().decode(output).includes('private name'),false);
});
test('v1.2 avatar limits reject animation, corrupt chunks, huge dimensions and malformed files',()=>{
 assert.throws(()=>sanitizeAvatar(png(513)));assert.throws(()=>sanitizeAvatar(png(1,[chunk('acTL',Buffer.alloc(8))])));const broken=png();broken[32]^=1;assert.throws(()=>sanitizeAvatar(broken));assert.throws(()=>sanitizeAvatar(Buffer.from('<svg onload=alert(1)>')));assert.throws(()=>sanitizeAvatar(png().subarray(0,30)));assert.throws(()=>sanitizeAvatar(Buffer.alloc(1048577)));
});
test('v1.2 full administration follows Owner or Responsible, never Administrator grants; helper publishing stays denied',()=>{
 const a=previewData().account;for(const rank of ['helper','senior_helper','moderator','administrator','responsible'] as const){const actor={...a,owner:false,capabilities:['approve_accounts','manage_settings'],member:{...a.member!,rank}};assert.equal(canManage(actor),rank==='responsible');assert.equal(hasCapability(actor,'manage_settings'),rank==='responsible');assert.equal(hasCapability(actor,'owner'),false);assert.equal(canManage({...actor,owner:true}),true);if(rank==='helper'||rank==='senior_helper')assert.equal(canPublish({...actor,owner:true}),false);}
});
test('v1.2 requests accept message links only and points adjustments cannot be zero',()=>{
 const body={staff_id:'00000000-0000-4000-8000-000000000001',type:'leave',starts_at:'2026-10-20T00:00:00+03:00',ends_at:'2026-10-21T00:00:00+03:00',notice_at:'2026-10-15T00:00:00Z',substitute_id:null,substitute_accepted:false,reason:'operational leave',source:'Discord',discord_url:'https://discord.com/channels/123456/234567/345678'};assert.equal(actionSchemas.request_create.safeParse(body).success,true);for(const discord_url of ['https://discord.com/channels/123456/234567','https://discord.com.evil.test/channels/123456/234567/345678','javascript:alert(1)'])assert.equal(actionSchemas.request_create.safeParse({...body,discord_url}).success,false);assert.equal(actionSchemas.points_adjust.safeParse({staff_id:body.staff_id,period_start:'2026-10-12',amount:0,reason:'reviewed adjustment'}).success,false);
});
