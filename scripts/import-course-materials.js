import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pool,transaction} from '../server/db.js';
import {hashPassword} from '../server/security.js';
import {parseSchedule,SHEETS} from '../server/schedule.js';
import {saveFile,assistantCall} from '../server/library.js';
const root=process.env.IMPORT_DIR||'work/course-import';
const manifest=JSON.parse(await readFile(root+'/manifest.json','utf8'));
const password=await hashPassword('demo-change-me');
const identity=async(c,name,email,role='teacher')=>(await c.query('INSERT INTO users(name,email,role,password_hash) VALUES($1,$2,$3,$4) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id',[name,email,role,password])).rows[0].id;
const context=await transaction(async c=>{
 const group=(await c.query("INSERT INTO groups(name) VALUES('БИВТ-25-6-1') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id")).rows[0].id;
 const admin=(await c.query("SELECT id FROM users WHERE role='coordinator' ORDER BY id LIMIT 1")).rows[0]?.id;if(!admin)throw Error('Нужен координатор портала');
 const zimin=await identity(c,'Иван Зимин','zimin.demo@isad.local');
 const math=await identity(c,'Яремко Н. Н.','math.demo@isad.local');
 const algo=await identity(c,'Куренков В. В.','algorithms.demo@isad.local');
 const python=await identity(c,'Овчинников С. А.','python.demo@isad.local');
 const offers={};for(const [title,teacher] of [['Базы данных',zimin],['Математика',math],['Алгоритмы и структуры данных',algo],['Практикум программирования на Python',python]]){
  const course=(await c.query('INSERT INTO courses(title) VALUES($1) ON CONFLICT(title) DO UPDATE SET title=EXCLUDED.title RETURNING id',[title])).rows[0].id;
  let offer=(await c.query("SELECT id FROM offerings WHERE course_id=$1 AND group_id=$2 AND semester='2026 осень' ORDER BY id LIMIT 1",[course,group])).rows[0];
  if(!offer)offer=(await c.query("INSERT INTO offerings(course_id,teacher_id,group_id,semester) VALUES($1,$2,$3,'2026 осень') RETURNING id",[course,teacher,group])).rows[0];offers[title]=offer.id;
 }
 const sharedGroup=(await c.query("INSERT INTO groups(name) VALUES('БИВТ-25-6-2') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id")).rows[0].id;
 for(const name of ['Базы данных','Алгоритмы и структуры данных','Практикум программирования на Python'])for(const gid of [group,sharedGroup])await c.query('INSERT INTO offering_groups(offering_id,group_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[offers[name],gid]);
 const students=(await c.query("SELECT id FROM users WHERE email IN ('student@example.org','headman@example.org')")).rows;
 for(let i=3;i<=8;i++)students.push({id:await identity(c,`Студент ${i} (демо)`,`bivt.demo.${i}@isad.local`,'student')});
 for(const student of students){
  await c.query("UPDATE memberships SET ends_on='2026-08-31' WHERE user_id=$1 AND group_id<>$2 AND starts_on<'2026-09-01' AND (ends_on IS NULL OR ends_on>='2026-09-01')",[student.id,group]);
  await c.query("INSERT INTO memberships(user_id,group_id,starts_on) SELECT $1,$2,'2026-09-01' WHERE NOT EXISTS(SELECT 1 FROM memberships WHERE user_id=$1 AND group_id=$2 AND starts_on='2026-09-01')",[student.id,group]);
 }
 const head=(await c.query("SELECT id FROM users WHERE email='headman@example.org'")).rows[0];if(head){await c.query("UPDATE headman_assignments SET ends_on='2026-08-31' WHERE user_id=$1 AND group_id<>$2 AND starts_on<'2026-09-01' AND (ends_on IS NULL OR ends_on>='2026-09-01')",[head.id,group]);await c.query("INSERT INTO headman_assignments(user_id,group_id,starts_on) SELECT $1,$2,'2026-09-01' WHERE NOT EXISTS(SELECT 1 FROM headman_assignments WHERE user_id=$1 AND group_id=$2)",[head.id,group]);}
 for(const [course,weekday,url] of [['Базы данных',0,'https://my.mts-link.ru/j/178132245/24598709786'],['Практикум программирования на Python',4,'https://my.mts-link.ru/j/178459277/24895821464'],['Практикум программирования на Python',5,'https://my.mts-link.ru/j/178459277/24896213366']]){
  await c.query("INSERT INTO meeting_links(offering_id,weekday,url,provider,recordings_at_same_url) VALUES($1,$2,$3,'МТС Линк',true) ON CONFLICT(offering_id,weekday) DO UPDATE SET url=EXCLUDED.url,recordings_at_same_url=true",[offers[course],weekday,url]);
  if(weekday===0)await c.query("UPDATE offerings SET current_meeting_url=$2,provider='МТС Линк' WHERE id=$1",[offers[course],url]);
 }
 for(const [key,kind,title,eventDate,description,topics] of [
  ['algo-contest-99331-deadline','deadline','Закрытие контеста по алгоритмам','2026-11-06','По сообщению группы: 6 ноября контест закроется. Точное время не сообщено.',''],
  ['algo-test-20261113','test','Контрольная по алгоритмам и структурам данных','2026-11-13','Очно в вузе либо дистанционно: запись/демонстрация экрана и включённая камера. Окончательный формат и время уточняет преподаватель.','Базовое хэширование; Z-функция; префикс-функция.']]){
  const event=(await c.query(`INSERT INTO calendar_events(offering_id,kind,title,event_date,description,topics,url,created_by,source_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(source_key) DO UPDATE SET description=EXCLUDED.description,topics=EXCLUDED.topics RETURNING id`,[offers['Алгоритмы и структуры данных'],kind,title,eventDate,description,topics,kind==='test'?'':'https://official.contest.yandex.ru/contest/99331',admin,key])).rows[0];
  await c.query(`INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) SELECT DISTINCT m.user_id,$2,$3,$4,'calendar',$5::integer FROM memberships m WHERE m.group_id=$1 AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE) ON CONFLICT DO NOTHING`,[group,key,title,eventDate+' · время не указано',event.id]);
 }
 for(const title of ['Учебный хакатон: портал кафедры (пример)','Учебный хакатон: анализ данных (пример)'])await c.query('INSERT INTO hackathons(title,description,organizer,is_demo,created_by) SELECT $1,$2,$3,true,$4 WHERE NOT EXISTS(SELECT 1 FROM hackathons WHERE title=$1)',[title,'Демонстрационная карточка для проверки достижения и заявки преподавателю. Не анонс реального мероприятия.','Демонстрационные данные',admin]);
 return {admin,offers,group};
});
let count=0;
for(const item of manifest){
 const key='course-pack-20261104:'+item.file;
 const material=(await pool.query(`INSERT INTO materials(offering_id,title,url,kind,topic,author,lesson_no,source_date,import_key) VALUES($1,$2,'',$3,$4,$5,$6,$7,$8) ON CONFLICT(import_key) DO UPDATE SET topic=EXCLUDED.topic RETURNING *`,[context.offers[item.course],item.title,item.kind,item.topic,item.author,item.lesson_no,item.source_date,key])).rows[0];
 const bytes=await readFile(root+'/files/'+item.file);const file=await saveFile(bytes,item.original_name,context.admin,material.id);
 await pool.query("UPDATE stored_files SET purpose='library' WHERE id=$1",[file.id]);
 await pool.query('UPDATE materials SET url=$2 WHERE id=$1',[material.id,'/api/files/'+file.id]);
 try{await assistantCall('/internal/index',{file_id:file.id,material_id:material.id,title:material.title,version:material.version,checksum:file.checksum,pages:item.pages},120000);await pool.query("UPDATE stored_files SET status='ready',page_count=$2,error=NULL WHERE id=$1",[file.id,item.original_name.endsWith('.pdf')?item.pages.length:null]);count++;console.log('Imported:',item.title);}
 catch(e){await pool.query("UPDATE stored_files SET status='error',error=$2 WHERE id=$1",[file.id,e.message]);throw e;}
}
const scheduleBytes=await readFile(root+'/files/schedule.xlsx');
const checksum=createHash('sha256').update(scheduleBytes).digest('hex');
let sf=(await pool.query("SELECT * FROM stored_files WHERE purpose='schedule' AND checksum=$1",[checksum])).rows[0];
if(!sf){sf=await saveFile(scheduleBytes,"Расписание ИСАД 2-4 26''.xlsx",context.admin);await pool.query("UPDATE stored_files SET purpose='schedule',status='reference' WHERE id=$1",[sf.id]);}
let entries=[];
for(const sheet of SHEETS){const result=parseSchedule(await readFile(root+'/'+sheet.name+'.csv','utf8'),sheet);entries.push(...result.entries);}
if(!(await pool.query('SELECT 1 FROM schedule_imports WHERE checksum=$1 AND published_at IS NOT NULL',[checksum])).rowCount)await pool.query('INSERT INTO schedule_imports(checksum,entries,source_url,created_by,published_at) VALUES($1,$2,$3,$4,now())',[checksum,JSON.stringify(entries),'/api/files/'+sf.id,context.admin]);
await pool.query("INSERT INTO import_batches(key,detail) VALUES('course-pack-20261104',$1) ON CONFLICT(key) DO UPDATE SET detail=EXCLUDED.detail",[JSON.stringify({materials:count,schedule_entries:entries.length,group:'БИВТ-25-6-1'})]);
console.log('Complete:',count,'materials;',entries.length,'timetable entries. Source SQL files were not executed.');
await pool.end();
