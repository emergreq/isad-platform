import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchTerms} from '../assistant/search.js';
test('search keeps topic keywords and removes question filler',()=>{
 assert.deepEqual(searchTerms('Пожалуйста, объясни мне, что такое внешний ключ?'),['внешний','ключ']);
 assert.deepEqual(searchTerms('ряды, РЯДЫ и предел'),['ряды','предел']);
 assert.deepEqual(searchTerms("' OR 1=1; --"),['or']);
});
