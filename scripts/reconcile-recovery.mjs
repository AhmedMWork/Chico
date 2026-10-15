// Only after checking provider outcome and confirming the previous HTTP request has terminated.
const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
if(!args.includes('--confirmed-no-pending-auth-request'))throw new Error('Confirm the provider outcome and termination of the previous request first');
const claim=get('--claim'),resolution=get('--resolution'),reason=get('--reason');
if(!/^[0-9a-f-]{36}$/i.test(claim??'')||!['confirmed_applied','confirmed_not_applied'].includes(resolution)||!reason||reason.length<15)throw new Error('Provide --claim, --resolution and an operational --reason (15+ characters)');
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY;if(!base||!key)throw new Error('Server environment is required');
async function rpc(name,body){const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json',apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body)});if(!response.ok)throw new Error('Reconciliation failed: '+response.status);return response.json();}
const operation=await rpc('chico_service_recovery_reconcile',{p_claim:claim,p_resolution:resolution,p_reason:reason});
if(resolution==='confirmed_applied')await rpc('chico_service_recovery_finish',{p_hash:operation.hash,p_claim:operation.claim});
console.log(JSON.stringify({reconciled:true,state:resolution==='confirmed_applied'?'completed':'reserved'}));
