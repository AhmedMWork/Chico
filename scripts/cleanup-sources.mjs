// Run with node --env-file=.env.local scripts/cleanup-sources.mjs. No credentials in logs.
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;
if(!base||!key)throw new Error('Server environment is required');
const headers={'Content-Type':'application/json',apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})};
async function rpc(name,body){const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw new Error('Source cleanup failed: '+r.status);return r.json();}
const rows=await rpc('chico_service_sources_cleanup',{});let removed=0;
for(const row of rows){const r=await fetch(base+'/storage/v1/object/chico-files',{method:'DELETE',headers,body:JSON.stringify({prefixes:[row.path]})});if(!r.ok)throw new Error('Storage cleanup failed: '+r.status);await rpc('chico_service_sources_cleanup',{p_finalize:row.id});removed++;}
console.log(JSON.stringify({removed,remainingBatch:rows.length===25}));
