import {transaction} from './db.js';
import {fail,number,text,instant,json,offering,notify} from './mvp-utils.js';

export async function moveSession(c,s,actor,newTime,reason){
 if(s.cancelled)throw fail(409,'Занятие отменено');
 if(new Date(s.starts_at).getTime()===new Date(newTime).getTime())return s;
 const changed=(await c.query('UPDATE sessions SET original_starts_at=COALESCE(original_starts_at,starts_at),starts_at=$2,rescheduled_at=now(),rescheduled_by=$3,reschedule_reason=$4 WHERE id=$1 RETURNING *',[s.id,newTime,actor,reason])).rows[0];
 const fmt=value=>new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
 await notify(c,s.offering_id,`reschedule:${s.id}:${Date.now()}`,'Перенос занятия: '+s.title,`${fmt(s.starts_at)} → ${fmt(newTime)} МСК. ${reason}`,'calendar',s.id);
 await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'session',$2,'reschedule',$3)",[actor,s.id,JSON.stringify({from:s.starts_at,to:newTime,reason})]);
 return changed;
}
export async function reschedule(req,u){
 const b=await json(req),original=instant(b.original_starts_at),target=instant(b.starts_at),reason=text(b.reason,1000);
 if(!b.session_id&&Date.parse(original)===Date.parse(target))throw fail(400,'Выберите новую дату или время');
 return transaction(async c=>{
  const o=await offering(u,b.offering_id,true,c);
  await c.query('SELECT pg_advisory_xact_lock(90211,$1::integer)',[o.id]);
  let s;
  if(b.session_id){s=(await c.query('SELECT * FROM sessions WHERE id=$1 AND offering_id=$2 FOR UPDATE',[number(b.session_id),o.id])).rows[0];if(!s)throw fail(404,'Занятие не найдено');}
  else{
   const existing=(await c.query('SELECT * FROM sessions WHERE offering_id=$1 AND (starts_at=$2 OR original_starts_at=$2) ORDER BY id FOR UPDATE',[o.id,original])).rows;
   if(existing.length>1)throw fail(409,'Найдено несколько занятий. Выберите занятие в календаре.');
   s=existing[0]||(await c.query('INSERT INTO sessions(offering_id,title,starts_at) VALUES($1,$2,$3) RETURNING *',[o.id,text(b.title||o.course,200),original])).rows[0];
  }
  return moveSession(c,s,u.id,target,reason);
 });
}
