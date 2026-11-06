import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
let env='';try{env=await readFile('.env','utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
const defaults={PRIVATE_DATA_KEY:randomBytes(32).toString('base64'),LOCAL_ACCOUNTS_KEY:randomBytes(32).toString('base64'),PRIVATE_DATA_FILE:'work/private/teaching-data.enc.json',DEMO_PASSWORD:randomBytes(24).toString('base64url'),ASSISTANT_DB_PASSWORD:randomBytes(32).toString('hex'),ASSISTANT_SHARED_SECRET:randomBytes(32).toString('hex')};
let count=0;for(const [name,value] of Object.entries(defaults)){const match=env.match(new RegExp('^'+name+'=(.*)$','m'));if(match?.[1]?.trim())continue;if(match)env=env.replace(new RegExp('^'+name+'=.*$','m'),name+'='+value);else env+='\n'+name+'='+value;count++;}
await mkdir('work/private',{recursive:true});await writeFile('.env',env.trim()+'\n',{mode:0o600});console.log(`Local configuration ready (${count} values generated). Secrets were not printed. Keep .env outside Git.`);
