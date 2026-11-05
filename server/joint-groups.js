import {transaction,pool} from './db.js';
import {offering,json,fail,notify} from './mvp-utils.js';
import {groupOptions} from './profile-group.js';
export async function jointGroups(req,u,id){
 const o=await offering(u,id,true);
 if(req.method==='GET')return {primary_group:o.group_name,selected:(await pool.query('SELECT offering_group_names($1) names',[o.id])).rows[0].names,options:await groupOptions()};
 if(req.method!=='PUT')throw fail(405,'Метод не поддерживается');
 const b=await json(req),options=await groupOptions();
 if(!Array.isArray(b.groups)||!b.groups.length||b.groups.length>20||b.groups.some(name=>!options.some(g=>g.name===name)))throw fail(400,'Выберите группы из списка');
 if(!b.groups.includes(o.group_name))throw fail(400,'Основная группа должна оставаться в списке');
 return transaction(async c=>{
  await c.query('SELECT id FROM offerings WHERE id=$1 FOR UPDATE',[o.id]);
  const ids=[];for(const name of [...new Set(b.groups)])ids.push((await c.query('INSERT INTO groups(name) VALUES($1) ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id',[name])).rows[0].id);
  await c.query('DELETE FROM offering_groups WHERE offering_id=$1',[o.id]);
  for(const gid of ids)await c.query('INSERT INTO offering_groups VALUES($1,$2)',[o.id,gid]);
  await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'offering',$2,'joint_groups',$3)",[u.id,o.id,JSON.stringify({groups:b.groups})]);
  await notify(c,o.id,`joint-groups:${o.id}:${Date.now()}`,'Совместные занятия: '+o.course,'Обновлён список групп предмета','home',o.id);
  return {ok:true};
 });
}
