import {test} from 'node:test';
import assert from 'node:assert/strict';
import {todayClasses,teacherTodayClasses,moscowDay} from '../client/src/today-schedule.js';
test('today uses Moscow date, chosen week and subgroup, meeting links and dated changes',()=>{
 assert.equal(moscowDay('2026-11-04T22:00:00Z'),'2026-11-05');
 const entry={key:'p',group:'A',subgroup:1,week:'upper',day:'Четверг',title:'Базы данных',time:'09:00 — 10:30',meeting_url:'https://example.org/old'};
 const source={entries:[entry,{...entry,key:'wrong-group',group:'B'},{...entry,key:'wrong-sub',subgroup:2},{...entry,key:'wrong-week',week:'lower'}],announcements:[]};
 const options={date:'2026-11-05',group:'A',subgroup:1,week:'upper'};
 assert.deepEqual(todayClasses(source,options).map(x=>x.id),['p']);assert.equal(todayClasses(source,options)[0].meeting_url,entry.meeting_url);
 source.announcements=[{key:'s',kind:'session',group_name:'A',course:'Базы данных',title:'Занятие',date:'2026-11-05',starts_at:'2026-11-05T11:00:00+03:00',original_starts_at:'2026-11-05T09:00:00+03:00',rescheduled_at:'2026-11-04T10:00:00Z',meeting_url:'https://example.org/new',status:'published'}];
 const moved=todayClasses(source,options);assert.equal(moved.length,1);assert.equal(moved[0].time,'11:00');assert.equal(moved[0].meeting_url,'https://example.org/new');
 source.announcements[0].status='cancelled';assert.equal(todayClasses(source,options)[0].meeting_url,null);
 source.announcements[0].status='published';source.announcements[0].starts_at='2026-11-06T11:00:00+03:00';assert.equal(todayClasses(source,options)[0].movedOut,true);assert.equal(todayClasses(source,options)[0].meeting_url,null);
});

test('teacher sees own subjects across groups and subgroups, with joint classes shown once',()=>{
 const row={group:'A',subgroup:1,week:'upper',day:'Четверг',title:'Базы данных (Практические)',time:'09:00 — 10:30',room:'101'};
 const source={entries:[{...row,key:'a'},{...row,key:'a2',subgroup:2},{...row,key:'b',group:'B'},{...row,key:'other',title:'Физика'},{...row,key:'later',subgroup:2,time:'11:00 — 12:30'},{...row,key:'c',group:'C',time:'14:00 — 15:30'}],announcements:[]};
 const offerings=[{id:1,title:'Базы данных',group_names:['A','B']},{id:2,title:'Базы данных',group_names:['C']}];
 const rows=teacherTodayClasses(source,{date:'2026-11-05',week:'upper',offerings});assert.equal(rows.length,3);assert.deepEqual(rows[0].group_names,['A','B']);assert.ok(rows.some(x=>x.time==='11:00 — 12:30'));assert.ok(rows.some(x=>x.group_names.includes('C')));assert.ok(rows.every(x=>!x.title.includes('Физика')));
 assert.equal(teacherTodayClasses(source,{date:'2026-11-05',week:'upper',offerings,group:'B'}).length,1);
});
