import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const target=new URL('../.env.local',import.meta.url);
const template=await readFile(new URL('../.env.example',import.meta.url),'utf8');
const output=template.replace('SESSION_ENCRYPTION_KEY=', 'SESSION_ENCRYPTION_KEY='+randomBytes(32).toString('base64url')).replace('RATE_LIMIT_HMAC_KEY=', 'RATE_LIMIT_HMAC_KEY='+randomBytes(32).toString('base64url')).replace('CHICO_BOOTSTRAP_TOKEN=', 'CHICO_BOOTSTRAP_TOKEN='+randomBytes(32).toString('base64url'));
try{await writeFile(target,output,{flag:'wx',mode:0o600});console.log('Created .env.local with random server keys. Add your Supabase keys and APP_ORIGIN locally. No secrets were printed.');}catch(error){if(error.code==='EEXIST'){console.error('.env.local already exists; preserved it.');process.exitCode=1;}else throw error;}
