import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Commit the tested source first. Release must match a clean Git revision.');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const version=JSON.parse(await readFile('package.json','utf8')).version;
const destination=path.resolve('releases');await mkdir(destination,{recursive:true});
const basename='CHICO_ADMINS_v'+version+'_'+sha.slice(0,8)+'.zip';const archive=path.join(destination,basename);
// Archive tracks only reviewed source, never working files, .env, uploads or node_modules.
execFileSync('git',['archive','--format=zip','--prefix=Chico-Admins/','--output='+archive,sha]);
const bytes=await readFile(archive);const digest=createHash('sha256').update(bytes).digest('hex');
const manifest={version,commit_sha:sha,archive:basename,sha256:digest,source_files:files.length,created_at:new Date().toISOString()};
await writeFile(archive+'.sha256',digest+'  '+basename+'\n');await writeFile(path.join(destination,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({archive,manifest},null,2));
