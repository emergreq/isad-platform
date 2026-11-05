import {pool,transaction} from './db.js';
import {fail,json,text} from './mvp-utils.js';

export async function groupOptions(c=pool){
 const known=(await c.query("SELECT id,name FROM groups WHERE name NOT IN ('ИСАД-101','ИСАД-102') ORDER BY name")).rows;
 const snapshot=(await c.query('SELECT entries FROM schedule_imports WHERE published_at IS NOT NULL ORDER BY published_at DESC,id DESC LIMIT 1')).rows[0];
 const options=new Map(known.map(g=>[g.name,g]));
 for(const entry of snapshot?.entries||[]){if(!options.has(entry.group))options.set(entry.group,{id:null,name:entry.group});}
 return [...options.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
}

export async function setProfileGroup(req,u){
 if(!['student','headman'].includes(u.role))throw fail(403,'Группу студента выбирают в студенческом кабинете');
 const b=await json(req),name=text(b.group,100),subgroup=Number(b.subgroup||1);
 if(![1,2].includes(subgroup))throw fail(400,'Выберите подгруппу 1 или 2');
 return transaction(async c=>{
  // Serialise concurrent selections for one account and preserve earlier academic periods.
  await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[u.id]);
  if(!(await groupOptions(c)).some(g=>g.name===name))throw fail(400,'Выберите группу из списка');
  const group=(await c.query('INSERT INTO groups(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name',[name])).rows[0];
  const {today}=(await c.query("SELECT (now() AT TIME ZONE 'Europe/Moscow')::date::text today")).rows[0];
  const before=(await c.query('SELECT * FROM memberships WHERE user_id=$1 AND starts_on<=$2::date AND (ends_on IS NULL OR ends_on>=$2::date) FOR UPDATE',[u.id,today])).rows;
  if(!before.some(g=>g.group_id===group.id)||before.some(g=>g.group_id!==group.id)){
   await c.query('UPDATE memberships SET ends_on=$2::date-1 WHERE user_id=$1 AND group_id<>$3 AND starts_on<$2::date AND (ends_on IS NULL OR ends_on>=$2::date)',[u.id,today,group.id]);
   // A same-day correction changes only today's choice; completed attendance/marks are untouched.
   await c.query('DELETE FROM memberships WHERE user_id=$1 AND group_id<>$3 AND starts_on=$2::date',[u.id,today,group.id]);
   if(!before.some(g=>g.group_id===group.id))await c.query('INSERT INTO memberships(user_id,group_id,starts_on) VALUES($1,$2,$3)',[u.id,group.id,today]);
   await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'profile',$1,'select_group',$2)",[u.id,JSON.stringify({before,group,day:today})]);
  }
  await c.query('INSERT INTO user_profiles(user_id,subgroup) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET subgroup=EXCLUDED.subgroup',[u.id,subgroup]);
  return {ok:true,group,subgroup};
 });
}
