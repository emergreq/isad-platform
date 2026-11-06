import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('local bootstrap generates secrets without printing them and preserves existing keys',async()=>{const dir=await mkdtemp(join(tmpdir(),'isad-secrets-'));try{const script=fileURLToPath(new URL('../scripts/init-local-secrets.js',import.meta.url));let run=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});assert.equal(run.status,0,run.stderr);const env=await readFile(join(dir,'.env'),'utf8');for(const key of ['PRIVATE_DATA_KEY','LOCAL_ACCOUNTS_KEY','DEMO_PASSWORD','ASSISTANT_DB_PASSWORD','ASSISTANT_SHARED_SECRET']){const value=env.match(new RegExp('^'+key+'=(.*)$','m'))[1];assert.ok(value.length>=24);assert.ok(!run.stdout.includes(value));}run=spawnSync(process.execPath,[script],{cwd:dir,encoding:'utf8'});assert.equal(run.status,0);assert.equal(await readFile(join(dir,'.env'),'utf8'),env);assert.match(env,/PRIVATE_DATA_FILE=work\/private\/teaching-data.enc.json/);}finally{await rm(dir,{recursive:true,force:true});}});
