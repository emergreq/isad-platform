import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachMeetingLinks,projectJointSchedule} from '../server/schedule-links.js';

test('joint subject uses the same weekly classes for both groups without replacing other subjects',()=>{
 const original=[{key:'a',group:'A',title:'Базы данных (Лекционные)',day:'Понедельник',time:'09:00 — 10:30'}, {key:'b',group:'B',title:'Базы данных (Лекционные)',day:'Пятница',time:'15:00 — 16:30'}, {key:'math',group:'B',title:'Математика',day:'Вторник'}];
 const result=projectJointSchedule(original,[{id:1,course:'Базы данных',primary_group:'A',group_names:['A','B']}]);
 assert.equal(result.find(e=>e.group==='B'&&e.title.startsWith('Базы')).day,'Понедельник');
 assert.ok(result.some(e=>e.key==='math'));assert.equal(result.length,3);assert.equal(original[1].day,'Пятница');
});

test('schedule links follow course, group and weekday, with specific rules first',()=>{
 const links=[
  {course:'Базы данных',group_name:'A',weekday:0,url:'https://example.org/db',provider:'МТС Линк',recordings_at_same_url:true},
  {course:'Практикум программирования на Python',group_name:'A',weekday:0,url:'https://example.org/default'},
  {course:'Практикум программирования на Python',group_name:'A',weekday:4,url:'https://example.org/thu'},
  {course:'Практикум программирования на Python',group_name:'A',weekday:5,url:'https://example.org/fri'},
 ];
 const entries=[
  {title:'1, 2 п.г. Базы данных (Лабораторные)',group:'A',day:'Среда'},
  {title:'Практикум программирования на Python (Практические)',group:'A',day:'Четверг'},
  {title:'Практикум программирования на Python (Практические)',group:'A',day:'Пятница'},
  {title:'Базы данных (Лекционные)',group:'B',day:'Среда'},
  {title:'Физика (Лекционные)',group:'A',day:'Четверг'},
 ];
 const result=attachMeetingLinks(entries,links);
 assert.deepEqual(result.map(x=>x.meeting_url),['https://example.org/db','https://example.org/thu','https://example.org/fri',null,null]);
 assert.equal(result[0].recordings_at_same_url,true);
 assert.equal(entries[0].meeting_url,undefined);
});
