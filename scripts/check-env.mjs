const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SESSION_ENCRYPTION_KEY','RATE_LIMIT_HMAC_KEY','APP_ORIGIN'];
const errors=required.filter(key=>!process.env[key]).map(key=>key+': missing');
for(const key of ['SUPABASE_URL','APP_ORIGIN'])if(process.env[key]){try{const url=new URL(process.env[key]);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))errors.push(key+': HTTPS required');if(key==='APP_ORIGIN'&&url.origin!==process.env[key])errors.push(key+': origin only, no trailing slash or path');}catch{errors.push(key+': invalid URL');}}
if(process.env.SESSION_ENCRYPTION_KEY&&(!/^[A-Za-z0-9_-]{43}$/.test(process.env.SESSION_ENCRYPTION_KEY)||Buffer.from(process.env.SESSION_ENCRYPTION_KEY,'base64url').length!==32))errors.push('SESSION_ENCRYPTION_KEY: must encode exactly 32 bytes');
if(process.env.RATE_LIMIT_HMAC_KEY&&process.env.RATE_LIMIT_HMAC_KEY.length<32)errors.push('RATE_LIMIT_HMAC_KEY: too short');
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Configuration format passed. This does not verify service connectivity.');
