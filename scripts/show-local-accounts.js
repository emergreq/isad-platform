import {readFile} from 'node:fs/promises';
import {loadPrivateData} from '../server/private-data.js';
const file='work/private/accounts.enc.json';
if(!process.env.LOCAL_ACCOUNTS_KEY){const env=await readFile('.env','utf8');process.env.LOCAL_ACCOUNTS_KEY=env.match(/^LOCAL_ACCOUNTS_KEY=(.*)$/m)?.[1]?.trim();}
const accounts=loadPrivateData({file,key:process.env.LOCAL_ACCOUNTS_KEY,required:true}).accounts||[];
if(process.argv.includes('--reveal')){console.table(accounts.map(({email,password})=>({email,password})));}else{console.log('Local accounts: '+accounts.map(x=>x.email).join(', '));console.log('Add --reveal only in your private terminal to show passwords.');}
