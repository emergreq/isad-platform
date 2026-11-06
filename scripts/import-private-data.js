import {pool,transaction} from '../server/db.js';
import {loadPrivateData} from '../server/private-data.js';
const data=loadPrivateData({required:true});let count=0;
await transaction(async c=>{for(const contact of data.contacts||[]){if(!contact.name||!contact.position)throw Error('Invalid private contact');const found=(await c.query('SELECT id FROM contacts WHERE (telegram<>\'\' AND telegram=$1) OR (email<>\'\' AND email=$2) LIMIT 1',[contact.telegram||'',contact.email||''])).rows[0];if(!found){await c.query('INSERT INTO contacts(name,position,email,telegram) VALUES($1,$2,$3,$4)',[contact.name,contact.position,contact.email||'',contact.telegram||'']);count++;}}});
console.log('Imported private contacts: '+count);await pool.end();
