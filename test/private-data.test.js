import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encryptPrivateData,decryptPrivateData} from '../server/private-data.js';
test('private payload round trips with randomized authenticated encryption',()=>{const key=randomBytes(32).toString('base64'),value={contacts:[{name:'Private test contact',telegram:'private_test'}]};const a=encryptPrivateData(value,key),b=encryptPrivateData(value,key);assert.deepEqual(decryptPrivateData(a,key),value);assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);assert.ok(!JSON.stringify(a).includes('Private test contact'));assert.throws(()=>decryptPrivateData(a,randomBytes(32).toString('base64')));assert.throws(()=>decryptPrivateData({...a,tag:randomBytes(16).toString('base64')},key));assert.throws(()=>decryptPrivateData({...a,ciphertext:randomBytes(30).toString('base64')},key));assert.throws(()=>encryptPrivateData(value,'invalid'));});
