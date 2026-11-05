import {pool} from './db.js';
import {readAccess} from './mvp-utils.js';

export async function notificationsWithLinks(u){
 const result=(await pool.query('SELECT * FROM notifications WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 100',[u.id])).rows;
 for(const n of result){
  n.href=null;n.external_url=null;
  if(n.target_page==='homework'){
   const h=(await pool.query(`SELECT h.id,to_char(h.due_at AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD') date FROM homework h JOIN sessions s ON s.id=h.session_id JOIN offerings o ON o.id=s.offering_id WHERE h.id=$3 AND ${readAccess}`,[u.id,u.role,n.target_id])).rows[0];
   if(h)n.href=`#calendar/homework-${h.id}?date=${h.date}`;
  }else if(n.target_page==='calendar'){
   const session=/^(cancel-session|meeting|reschedule):/.test(n.event_key);
   const sql=session?`SELECT s.id,s.meeting_url url,to_char(s.starts_at AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD') date FROM sessions s JOIN offerings o ON o.id=s.offering_id WHERE s.id=$3 AND ${readAccess}`:`SELECT e.id,e.url,to_char(e.event_date,'YYYY-MM-DD') date FROM calendar_events e JOIN offerings o ON o.id=e.offering_id WHERE e.id=$3 AND e.status='published' AND ${readAccess}`;
   const target=(await pool.query(sql,[u.id,u.role,n.target_id])).rows[0];
   if(target){n.href=`#calendar/${session?'session':'event'}-${target.id}?date=${target.date}`;n.external_url=target.url||null;}
  }else if(['library','materials'].includes(n.target_page)){
   const m=(await pool.query(`SELECT m.id,m.url FROM materials m JOIN offerings o ON o.id=m.offering_id WHERE m.id=$3 AND m.published AND ${readAccess}`,[u.id,u.role,n.target_id])).rows[0];
   if(m){n.href=`#materials/material-${m.id}`;n.external_url=m.url||null;}
  }else if(n.target_page==='home'){
   if((await pool.query(`SELECT o.id FROM offerings o WHERE o.id=$3 AND ${readAccess}`,[u.id,u.role,n.target_id])).rowCount)n.href=`#home/course-${n.target_id}`;
  }else if(n.target_page==='projects'){
   if((await pool.query('SELECT id FROM projects WHERE id=$1',[n.target_id])).rowCount)n.href=`#projects/project-${n.target_id}`;
  }else if(n.target_page==='debts')n.href='#debts';
  else if(n.target_page==='hackathons')n.href='#hackathons';
 }
 return result;
}
