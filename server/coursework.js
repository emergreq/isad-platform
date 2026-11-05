import {pool,transaction} from './db.js';
import {fail,json,text,day,instant,offering,readAccess,notify} from './mvp-utils.js';
export async function courseworkRoute(req,u){
 if(req.method==='GET')return (await pool.query(`SELECT e.*,to_char(e.event_date,'YYYY-MM-DD') event_date,c.title course,g.name group_name,offering_group_names(o.id) group_names,f.original_name requirements_name,
 CASE WHEN m.published OR o.teacher_id=$1 OR $2='coordinator' THEN '/api/files/'||f.id END requirements_url,
 EXISTS(SELECT 1 FROM event_progress ep WHERE ep.event_id=e.id AND ep.user_id=$1 AND ep.done) done
 FROM coursework cw JOIN calendar_events e ON e.id=cw.event_id JOIN offerings o ON o.id=e.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id
 JOIN stored_files f ON f.id=cw.requirements_file_id JOIN materials m ON m.id=f.material_id WHERE e.status='published' AND ${readAccess} ORDER BY e.event_date,e.starts_at NULLS LAST,e.id`,[u.id,u.role])).rows;
 if(req.method!=='POST')throw fail(405,'Метод не поддерживается');
 const b=await json(req),o=await offering(u,b.offering_id,true),eventDate=day(b.event_date),start=b.starts_at?instant(b.starts_at):null;
 if(!/^[a-f0-9-]{36}$/i.test(b.requirements_file_id||''))throw fail(400,'Загрузите файл требований');
 if(start&&new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date(start))!==eventDate)throw fail(400,'Время и дата сдачи должны совпадать по Москве');
 return transaction(async c=>{
  const f=(await c.query('SELECT f.*,m.offering_id FROM stored_files f JOIN materials m ON m.id=f.material_id WHERE f.id=$1 AND m.offering_id=$2 AND (f.owner_id=$3 OR $4=\'coordinator\') FOR UPDATE OF f,m',[b.requirements_file_id,o.id,u.id,u.role])).rows[0];
  if(!f)throw fail(404,'Файл требований недоступен для этого предмета');
  const event=(await c.query("INSERT INTO calendar_events(offering_id,kind,title,description,event_date,starts_at,created_by) VALUES($1,'coursework',$2,$3,$4,$5,$6) RETURNING *",[o.id,text(b.title,250),String(b.description||'').slice(0,6000),eventDate,start,u.id])).rows[0];
  await c.query('INSERT INTO coursework(event_id,requirements_file_id) VALUES($1,$2)',[event.id,f.id]);
  await c.query('UPDATE materials SET published=true WHERE id=$1',[f.material_id]);
  await notify(c,o.id,'coursework:'+event.id,'Курсовая работа: '+event.title,'Срок сдачи: '+eventDate,'calendar',event.id);
  return event;
 });
}
