import {pool,transaction} from './db.js';
import {libraryRoutes} from './library.js';
import {groupOptions,setProfileGroup} from './profile-group.js';
import {attachMeetingLinks,courseKey,projectJointSchedule} from './schedule-links.js';
import {reschedule} from './reschedule.js';
import {jointGroups} from './joint-groups.js';
import {courseworkRoute} from './coursework.js';
import {notificationsWithLinks} from './notification-links.js';
import {projectInterestRoute} from './project-interests.js';
import {fail,number,text,day,instant,webUrl,json,readAccess,offering,notify} from './mvp-utils.js';
const rows=async(sql,args=[],c=pool)=>(await c.query(sql,args)).rows;
const staff=u=>{if(!['teacher','coordinator'].includes(u.role))throw fail(403,'Доступно преподавателю');};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const str=v=>typeof v==='string'?v:null;
const int=v=>Number.isSafeInteger(Number(v))&&v!==null&&v!==''?Number(v):null;
export async function calendar(u,from,to){
 // Календарь собирает база: представление calendar_items + функция calendar_for (db/016).
 // Права доступа, черновики и личные отметки «выполнено» тоже считаются там.
 return (await rows('SELECT item FROM calendar_for($1,$2::date,$3::date) AS item',[u.id,from,to])).map(r=>r.item);
}
export async function mvp(req,res,u){
 const fileResult=await libraryRoutes(req,res,u);if(fileResult!==undefined)return fileResult;
 const url=new URL(req.url,'http://localhost'),p=url.pathname,method=req.method;let m;
 if((m=p.match(/^\/api\/offerings\/(\d+)\/groups$/)))return jointGroups(req,u,m[1]);
 if(p==='/api/coursework')return courseworkRoute(req,u);
 if(p==='/api/project-interests')return projectInterestRoute(req,u);
 if(method==='POST'&&p==='/api/sessions/reschedule')return reschedule(req,u);
 if(method==='PATCH'&&(m=p.match(/^\/api\/offerings\/(\d+)\/requirements$/))){
  const o=await offering(u,m[1],true),b=await json(req),type=b.assessment_type||null;
  if(type&&!['exam','credit','graded_credit'].includes(type))throw fail(400,'Выберите форму контроля');
  if(typeof b.completion_conditions!=='string'||b.completion_conditions.length>6000)throw fail(400,'Условия: не более 6000 символов');
  return transaction(async c=>{const changed=(await rows('UPDATE offerings SET assessment_type=$2,completion_conditions=$3 WHERE id=$1 RETURNING *',[o.id,type,b.completion_conditions.trim()],c))[0];await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'offering',$2,'requirements',$3)",[u.id,o.id,JSON.stringify({assessment_type:changed.assessment_type,completion_conditions:changed.completion_conditions})]);await notify(c,o.id,`requirements:${o.id}:${Date.now()}`,'Условия по предмету: '+o.course,'Преподаватель обновил форму контроля и требования','home',o.id);return changed;});
 }
 if(method==='GET'&&p==='/api/teaching-roster'){
  const o=await offering(u,url.searchParams.get('offering_id'),true);
  return rows("SELECT DISTINCT u.id,u.name FROM memberships mm JOIN users u ON u.id=mm.user_id WHERE offering_has_group($1,mm.group_id) AND u.role IN ('student','headman') AND mm.starts_on<=CURRENT_DATE AND (mm.ends_on IS NULL OR mm.ends_on>=CURRENT_DATE) ORDER BY u.name,u.id",[o.id]);
 }
 if(method==='POST'&&p==='/api/profile/group')return setProfileGroup(req,u);
 if(method==='GET'&&p==='/api/schedule'){
  const latest=(await rows('SELECT id,entries,source_url,published_at FROM schedule_imports WHERE published_at IS NOT NULL ORDER BY published_at DESC,id DESC LIMIT 1'))[0];
  const personal=['student','headman'].includes(u.role);
  const groups=personal?await rows("SELECT g.id,g.name FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=$1 AND m.starts_on<=(now() AT TIME ZONE 'Europe/Moscow')::date AND (m.ends_on IS NULL OR m.ends_on>=(now() AT TIME ZONE 'Europe/Moscow')::date) ORDER BY m.starts_on DESC,g.id",[u.id]):[];
  const profile=(await rows('SELECT subgroup FROM user_profiles WHERE user_id=$1',[u.id]))[0];
  const owned=personal?[]:await rows("SELECT o.id,c.title course,g.name group_name,offering_group_names(o.id) group_names FROM offerings o JOIN courses c ON c.id=o.course_id JOIN groups g ON offering_has_group(o.id,g.id) WHERE $2='coordinator' OR o.teacher_id=$1",[u.id,u.role]);
  const joints=await rows('SELECT o.id,c.title course,g.name primary_group,offering_group_names(o.id) group_names FROM offerings o JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id WHERE cardinality(offering_group_names(o.id))>1 ORDER BY o.id');
  const entries=projectJointSchedule(latest?.entries||[],joints),visible=personal?entries.filter(x=>groups.some(g=>g.name===x.group)):u.role==='teacher'?entries.filter(x=>owned.some(o=>o.group_name===x.group)):entries;
  const links=await rows(`SELECT ml.*,c.title course,g.name group_name,offering_group_names(o.id) group_names FROM meeting_links ml JOIN offerings o ON o.id=ml.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON offering_has_group(o.id,g.id) WHERE ${readAccess}`,[u.id,u.role]);
  const dayOfWeek=new Date(today()+'T12:00:00Z').getUTCDay()||7;
  const weekFrom=new Date(Date.parse(today()+'T12:00:00Z')-(dayOfWeek-1)*86400000).toISOString().slice(0,10);
  const weekTo=new Date(Date.parse(weekFrom+'T12:00:00Z')+6*86400000).toISOString().slice(0,10);
  const announcements=(await calendar(u,weekFrom,weekTo)).filter(x=>x.source_type!=='homework'&&x.status!=='draft');
  const moves=await rows(`SELECT s.*,c.title course,g.name group_name,offering_group_names(o.id) group_names FROM sessions s JOIN offerings o ON o.id=s.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id WHERE ${readAccess} AND (s.original_starts_at AT TIME ZONE 'Europe/Moscow')::date BETWEEN $3::date AND $4::date AND s.rescheduled_at IS NOT NULL`,[u.id,u.role,weekFrom,weekTo]);
  for(const s of moves)if(!announcements.some(n=>n.source_type==='session'&&n.source_id===s.id))announcements.push({...s,source_type:'session',source_id:s.id,key:'session:'+s.id,kind:'session',date:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date(s.original_starts_at)),status:s.cancelled?'cancelled':'published'});
  const enriched=attachMeetingLinks(visible,links).map(entry=>{
   const editable=owned.find(o=>o.group_name===entry.group&&courseKey(o.course)===courseKey(entry.title));
   const moved=moves.find(s=>(s.group_names||[s.group_name]).includes(entry.group)&&courseKey(s.course)===courseKey(entry.title)&&new Date(s.original_starts_at).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow',weekday:'long'}).toLowerCase()===entry.day.toLowerCase()&&new Date(s.original_starts_at).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})===entry.time.split(' — ')[0]);
   return {...entry,editable_offering_id:editable?.id||null,reschedule:moved?{session_id:moved.id,original_starts_at:moved.original_starts_at,starts_at:moved.starts_at,reason:moved.reschedule_reason}:null};
  });
  const file=(await rows("SELECT id,original_name FROM stored_files WHERE purpose='schedule' ORDER BY created_at DESC LIMIT 1"))[0];
  return {...latest,entries:enriched,announcements,week_from:weekFrom,week_to:weekTo,personal,groups,subgroup:profile?.subgroup||1,source_file:file?{url:'/api/files/'+file.id,name:file.original_name}:null};
 }
 if(method==='GET'&&p==='/api/meeting-links')return rows(`SELECT ml.*,c.title course,g.name group_name,offering_group_names(o.id) group_names FROM meeting_links ml JOIN offerings o ON o.id=ml.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON offering_has_group(o.id,g.id) WHERE ${readAccess} ORDER BY c.title,ml.weekday`,[u.id,u.role]);
 if(method==='POST'&&p==='/api/meeting-links'){const b=await json(req),o=await offering(u,b.offering_id,true),weekday=Number(b.weekday);if(!Number.isInteger(weekday)||weekday<0||weekday>7)throw fail(400,'Выберите день');await pool.query('INSERT INTO meeting_links(offering_id,weekday,url,provider) VALUES($1,$2,$3,$4) ON CONFLICT(offering_id,weekday) DO UPDATE SET url=EXCLUDED.url,provider=EXCLUDED.provider',[o.id,weekday,webUrl(b.url,false),String(b.provider||'').slice(0,100)]);return {ok:true};}
 if(method==='GET'&&p==='/api/calendar'){
  const from=day(url.searchParams.get('from')||today()),to=day(url.searchParams.get('to')||new Date(Date.now()+90*86400000).toISOString().slice(0,10));
  if(to<from||Date.parse(to)-Date.parse(from)>366*86400000)throw fail(400,'Выберите период до года');return calendar(u,from,to);
 }
 if(method==='GET'&&p==='/api/study-overview'){
  const items=await calendar(u,new Date(Date.now()-30*86400000).toISOString().slice(0,10),new Date(Date.now()+90*86400000).toISOString().slice(0,10));
  const deadlines=items.filter(x=>['deadline','homework','test','coursework','retake','debt_day'].includes(x.kind)&&x.status==='published'&&!x.done).map(x=>({...x,priority:x.date<today()?'Срок прошёл':x.date===today()?'Сегодня':'По ближайшему сроку'}));
  return {as_of:new Date().toISOString(),timezone:'Europe/Moscow',deadlines,model_configured:!!process.env.MODEL_API_KEY};
 }
 if(method==='POST'&&p==='/api/calendar-events'){
  const b=await json(req),o=await offering(u,b.offering_id,true);if(!['test','deadline','coursework','announcement','consultation'].includes(b.kind))throw fail(400,'Некорректный тип события');
  const eventDate=day(b.event_date);const start=b.starts_at?instant(b.starts_at):null;
  if(start&&new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date(start))!==eventDate)throw fail(400,'Время и дата события должны совпадать по Москве');
  return transaction(async c=>{const e=(await rows('INSERT INTO calendar_events(offering_id,kind,title,description,topics,event_date,starts_at,url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[o.id,b.kind,text(b.title,250),String(b.description||'').slice(0,6000),String(b.topics||'').slice(0,4000),eventDate,start,webUrl(b.url),u.id],c))[0];await notify(c,o.id,'calendar:'+e.id,'Новое событие: '+e.title,e.description,'calendar',e.id);return e;});
 }
 if(method==='PATCH'&&(m=p.match(/^\/api\/calendar-events\/(\d+)$/))){
  const b=await json(req);return transaction(async c=>{const e=(await rows('SELECT * FROM calendar_events WHERE id=$1 FOR UPDATE',[number(m[1])],c))[0];if(!e)throw fail(404,'Событие не найдено');await offering(u,e.offering_id,true,c);
   const eventDate=day(b.event_date||e.event_date.toISOString().slice(0,10)),start=b.starts_at===null?null:b.starts_at?instant(b.starts_at):e.starts_at;
   const status=b.status||e.status;if(!['draft','published','cancelled'].includes(status))throw fail(400,'Неверный статус');
   const changed=(await rows('UPDATE calendar_events SET title=$2,description=$3,topics=$4,event_date=$5,starts_at=$6,url=$7,status=$8 WHERE id=$1 RETURNING *',[e.id,text(b.title??e.title,250),String(b.description??e.description).slice(0,6000),String(b.topics??e.topics).slice(0,4000),eventDate,start,webUrl(b.url??e.url),status],c))[0];await notify(c,e.offering_id,`event-update:${e.id}:${Date.now()}`,'Изменено событие: '+changed.title,'Проверьте актуальные дату, темы и условия','calendar',e.id);await c.query('INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,$2,$3,$4,$5)',[u.id,'calendar',e.id,'update',changed]);return changed;});
 }
 if(method==='POST'&&(m=p.match(/^\/api\/calendar-events\/(\d+)\/progress$/))){const b=await json(req);if(typeof b.done!=='boolean')throw fail(400,'Нужна отметка выполнения');const e=(await rows('SELECT * FROM calendar_events WHERE id=$1',[number(m[1])]))[0];if(!e)throw fail(404,'Событие не найдено');await offering(u,e.offering_id);if(!['deadline','coursework'].includes(e.kind))throw fail(400,'Это событие не является работой');await pool.query('INSERT INTO event_progress VALUES($1,$2,$3) ON CONFLICT(event_id,user_id) DO UPDATE SET done=EXCLUDED.done',[e.id,u.id,b.done]);return {ok:true};}
 if(method==='GET'&&p==='/api/notifications')return notificationsWithLinks(u);
 if(method==='POST'&&p==='/api/notifications/read'){await pool.query('UPDATE notifications SET read_at=now() WHERE recipient_id=$1 AND read_at IS NULL',[u.id]);return {ok:true};}
 if(method==='POST'&&(m=p.match(/^\/api\/sessions\/(\d+)\/cancel$/))){
  const b=await json(req),sid=number(m[1]);
  let replacement=null;if(b.replacement){replacement={title:text(b.replacement.title,200),description:text(b.replacement.description,4000),due_at:instant(b.replacement.due_at)};}
  // права, отмена, задание взамен, журнал и уведомления — в процедуре cancel_study_session (db/016)
  await pool.query('CALL cancel_study_session($1,$2,$3,$4,$5)',[sid,u.id,text(b.reason,1000),replacement,String(b.request_key||'').slice(0,150)]);
  return (await rows('SELECT * FROM sessions WHERE id=$1',[sid]))[0];
 }
 if(method==='PATCH'&&(m=p.match(/^\/api\/sessions\/(\d+)\/meeting$/))){
  const b=await json(req),url=['current_only','future_default'].includes(b.scope)?webUrl(b.url,false):null;
  // права, ссылка пары, правило по дню недели и уведомления — в функции set_session_meeting (db/016)
  await pool.query('SELECT set_session_meeting($1,$2,$3,$4,$5)',[number(m[1]),u.id,str(b.scope),url,String(b.provider||'')]);
  return {ok:true};
 }
 if(method==='PATCH'&&(m=p.match(/^\/api\/sessions\/(\d+)\/recording$/))){const b=await json(req),s=(await rows('SELECT * FROM sessions WHERE id=$1',[number(m[1])]))[0];if(!s)throw fail(404,'Занятие не найдено');await offering(u,s.offering_id,true);
  // set_actor: триггер sessions_audit запишет в журнал, кто поменял запись
  await transaction(async c=>{await c.query('SELECT set_actor($1)',[u.id]);await c.query('UPDATE sessions SET recording_url=$2 WHERE id=$1',[s.id,b.url?webUrl(b.url,false):null]);});return {ok:true};}
 if(method==='GET'&&p==='/api/hackathons')return rows('SELECT * FROM hackathons WHERE NOT is_demo OR id=(SELECT min(id) FROM hackathons WHERE is_demo) ORDER BY starts_on NULLS LAST,id DESC');
 if(method==='POST'&&p==='/api/hackathons'){staff(u);const b=await json(req);if(b.starts_on&&b.ends_on&&b.ends_on<b.starts_on)throw fail(400,'Конец раньше начала');return (await rows('INSERT INTO hackathons(title,description,organizer,starts_on,ends_on,source_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[text(b.title,200),String(b.description||'').slice(0,4000),String(b.organizer||'').slice(0,200),b.starts_on?day(b.starts_on):null,b.ends_on?day(b.ends_on):null,webUrl(b.source_url),u.id]))[0];}
 if(method==='GET'&&p==='/api/profile'){
  const profile=(await rows('SELECT * FROM user_profiles WHERE user_id=$1',[u.id]))[0]||{bio:'',resume_file_id:null};
  return {...profile,subgroup:profile.subgroup||1,group_options:await groupOptions(),name:u.name,email:u.email,groups:await rows('SELECT g.* FROM groups g JOIN memberships m ON m.group_id=g.id WHERE m.user_id=$1 AND m.starts_on<=CURRENT_DATE AND (m.ends_on IS NULL OR m.ends_on>=CURRENT_DATE)',[u.id]),skills:await rows('SELECT s.* FROM skills s JOIN user_skills us ON us.skill_id=s.id WHERE us.user_id=$1',[u.id]),skill_options:await rows('SELECT * FROM skills ORDER BY name'),achievements:await rows('SELECT a.*,h.title hackathon FROM achievements a LEFT JOIN hackathons h ON h.id=a.hackathon_id WHERE owner_id=$1 ORDER BY a.id DESC',[u.id])};
 }
 if(method==='PATCH'&&p==='/api/profile'){
  const b=await json(req);const skillIds=Array.isArray(b.skills)?[...new Set(b.skills.map(number))]:[];if(skillIds.length>50)throw fail(400,'Слишком много навыков');
  if(b.resume_file_id&&!(await rows('SELECT 1 FROM stored_files WHERE id=$1 AND owner_id=$2 AND material_id IS NULL',[b.resume_file_id,u.id])).length)throw fail(404,'Резюме недоступно');
  return transaction(async c=>{if(b.name!==undefined)await c.query('UPDATE users SET name=$2 WHERE id=$1',[u.id,text(b.name,150).replace(/\s+/g,' ')]);await c.query('INSERT INTO user_profiles(user_id,bio,resume_file_id) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET bio=EXCLUDED.bio,resume_file_id=EXCLUDED.resume_file_id',[u.id,String(b.bio||'').slice(0,2000),b.resume_file_id||null]);await c.query('DELETE FROM user_skills WHERE user_id=$1',[u.id]);for(const skill of skillIds)await c.query('INSERT INTO user_skills VALUES($1,$2)',[u.id,skill]);return {ok:true};});
 }
 if(method==='POST'&&p==='/api/achievements'){
  const b=await json(req);if(!['student','headman'].includes(u.role))throw fail(403,'Доступно студенту');if(!['participation','prize','winner'].includes(b.result))throw fail(400,'Укажите результат');
  if(b.certificate_file_id&&!(await rows('SELECT 1 FROM stored_files WHERE id=$1 AND owner_id=$2 AND material_id IS NULL',[b.certificate_file_id,u.id])).length)throw fail(404,'Сертификат недоступен');
  return (await rows('INSERT INTO achievements(owner_id,hackathon_id,title,github_url,contribution,certificate_file_id,result) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[u.id,b.hackathon_id?number(b.hackathon_id):null,text(b.title,200),webUrl(b.github_url),text(b.contribution),b.certificate_file_id||null,b.result]))[0];
 }
 if(method==='GET'&&p==='/api/credit-requests')return rows(`SELECT cr.*,u.name student,c.title course,g.name group_name,offering_group_names(o.id) group_names,h.title hackathon FROM credit_requests cr JOIN users u ON u.id=cr.student_id JOIN offerings o ON o.id=cr.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id JOIN hackathons h ON h.id=cr.hackathon_id WHERE cr.student_id=$1 OR (o.teacher_id=$1 AND $2='teacher') OR $2='coordinator' ORDER BY cr.created_at DESC`,[u.id,u.role]);
 if(method==='POST'&&p==='/api/credit-requests'){
  const b=await json(req);
  // роль, доступ к предмету, достижение, снимок и уведомление преподавателю — в create_credit_request (db/016)
  return (await rows('SELECT * FROM create_credit_request($1,$2,$3,$4)',[u.id,number(b.offering_id),number(b.achievement_id),str(b.requested_scope)]))[0];
 }
 if(method==='POST'&&(m=p.match(/^\/api\/credit-requests\/(\d+)\/decision$/))){
  const b=await json(req);
  // блокировка, версия, правила статусов, история и уведомление студенту — в decide_credit_request (db/016)
  return (await rows('SELECT * FROM decide_credit_request($1,$2,$3,$4,$5,$6)',[number(m[1]),u.id,int(b.version),str(b.status),str(b.decision_scope),str(b.comment)]))[0];
 }
 if(method==='POST'&&(m=p.match(/^\/api\/credit-requests\/(\d+)\/resubmit$/))){
  const b=await json(req);
  // проверка статуса и версии, новый снимок, история и уведомление преподавателю — в resubmit_credit_request (db/016)
  await pool.query('SELECT resubmit_credit_request($1,$2,$3,$4)',[number(m[1]),u.id,int(b.version),str(b.contribution)]);
  return {ok:true};
 }
 if(method==='GET'&&p==='/api/projects/recommended')return rows(`SELECT p.id,p.title,r.title position,r.skills,r.capacity,COALESCE((SELECT json_agg(s.name) FROM user_skills us JOIN skills s ON s.id=us.skill_id WHERE us.user_id=$1 AND lower(r.skills) LIKE '%'||lower(s.name)||'%'),'[]') matched_skills FROM projects p JOIN project_roles r ON r.project_id=p.id WHERE (SELECT count(*) FROM project_members pm WHERE pm.role_id=r.id)<r.capacity ORDER BY p.id DESC`,[u.id]);
 return undefined;
}
