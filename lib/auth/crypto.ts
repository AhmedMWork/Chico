import { config } from '../db/supabase';
const encoder=new TextEncoder();
export function randomToken(bytes=32):string {const array=crypto.getRandomValues(new Uint8Array(bytes));return bytesToBase64(array);}
export function bytesToBase64(bytes:Uint8Array):string {return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export function fromBase64(value:string):Uint8Array {const normalized=value.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
export async function hash(value:string):Promise<string> {const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));return [...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function key(){const bytes=fromBase64(config().encryption);if(bytes.length!==32)throw new Error('SESSION_ENCRYPTION_KEY must encode 32 bytes');return crypto.subtle.importKey('raw',bytes as BufferSource,{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encrypt(value:unknown):Promise<string>{const iv=crypto.getRandomValues(new Uint8Array(12));const result=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),encoder.encode(JSON.stringify(value)));return bytesToBase64(iv)+'.'+bytesToBase64(new Uint8Array(result));}
export async function decrypt<T>(value:string):Promise<T>{const [a,b]=value.split('.');const result=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(a) as BufferSource},await key(),fromBase64(b) as BufferSource);return JSON.parse(new TextDecoder().decode(result)) as T;}
export async function rateHash(value:string):Promise<string>{const k=await crypto.subtle.importKey('raw',encoder.encode(config().rateKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);return bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC',k,encoder.encode(value))));}
export async function equalSecret(a:string,b:string):Promise<boolean>{const x=await hash(a),y=await hash(b);let result=0;for(let i=0;i<x.length;i++)result|=x.charCodeAt(i)^y.charCodeAt(i);return result===0&&!!a&&!!b;}
export function jwtSessionId(access:string):string {const payload=JSON.parse(new TextDecoder().decode(fromBase64(access.split('.')[1])));if(!/^[0-9a-f-]{36}$/i.test(payload.session_id??''))throw new Error('Missing auth session id');return payload.session_id;}
