import {pool} from './db.js';
import {fail,json} from './mvp-utils.js';

export const topics=[
 {key:'ml',label:'ML / ИИ',aliases:['ml','ai','машинн','нейросет','искусственн','machine learning','deep learning','computer vision','nlp']},
 {key:'data',label:'Анализ данных',aliases:['аналитик','анализ данных','data science','data analytics','data scientist']},
 {key:'web',label:'Веб-разработка',aliases:['web','веб','сайт','frontend','backend','react','django','node']},
 {key:'mobile',label:'Мобильные приложения',aliases:['мобильн','android','ios','flutter','swift','kotlin']},
 {key:'design',label:'Дизайн',aliases:['дизайн','design','ux','ui','figma']},
 {key:'security',label:'Информационная безопасность',aliases:['безопасност','security','ctf','пентест']},
];
export const roles=[
 {key:'ml_engineer',label:'ML-инженер',aliases:['ml engineer','ml инженер','ml разработчик','machine learning','машинн','нейросет','mlops']},
 {key:'data_scientist',label:'Data Scientist',aliases:['data scientist','data science','датасаентист','исследователь данных']},
 {key:'analyst',label:'Аналитик данных',aliases:['аналитик','data analyst','анализ данных']},
 {key:'frontend',label:'Frontend-разработчик',aliases:['frontend','фронтенд','front end','react','vue']},
 {key:'backend',label:'Backend-разработчик',aliases:['backend','бэкенд','бекенд','back end','django','fastapi','node']},
 {key:'mobile',label:'Мобильный разработчик',aliases:['мобильн','android','ios','flutter']},
 {key:'designer',label:'Дизайнер',aliases:['дизайн','design','ux','ui','figma']},
 {key:'qa',label:'Тестировщик',aliases:['тестиров','qa','testing']},
 {key:'pm',label:'Менеджер проекта',aliases:['менеджер','project manager','product manager','pm']},
];
const norm=s=>' '+(String(s).toLowerCase().replace(/ё/g,'е').match(/[\p{L}\p{N}]+/gu)||[]).join(' ')+' ';
function matches(text,option){const content=norm(text);return option.aliases.some(a=>{const value=norm(a).trim();return content.includes(' '+value+(value.length<=3?' ':''));});}
export function matchingRoles(preference,project,positions){
 if(!preference.topics.length&&!preference.roles.length)return null;
 const open=positions.filter(r=>Number(r.booked||0)<Number(r.capacity));
 const topicText=[project.title,project.description,...open.flatMap(r=>[r.title,r.skills])].join(' ');
 if(preference.topics.length&&!topics.some(t=>preference.topics.includes(t.key)&&matches(topicText,t)))return null;
 if(!preference.roles.length)return [];
 const found=open.filter(r=>roles.some(role=>preference.roles.includes(role.key)&&matches(r.title+' '+r.skills,role)));
 return found.length?found:null;
}
export async function notifyProjectMatches(c,projectId){
 const project=(await c.query('SELECT * FROM projects WHERE id=$1',[projectId])).rows[0];
 const positions=(await c.query('SELECT r.*,(SELECT count(*)::int FROM project_members m WHERE m.role_id=r.id) booked FROM project_roles r WHERE r.project_id=$1',[projectId])).rows;
 const preferences=(await c.query('SELECT * FROM project_interests WHERE enabled AND user_id<>$1',[project.owner_id])).rows;
 for(const pref of preferences){
  const found=matchingRoles(pref,project,positions);if(found===null)continue;
  const message=found.length?'Ищут: '+found.map(r=>r.title).join(', '):'Совпадает с вашими интересами';
  await c.query("INSERT INTO notifications(recipient_id,event_key,title,message,target_page,target_id) VALUES($1,$2,$3,$4,'projects',$5) ON CONFLICT(recipient_id,event_key) DO NOTHING",[pref.user_id,'project-match:'+project.id,'Новый проект: '+project.title,message,project.id]);
 }
}
export async function projectInterestRoute(req,u){
 if(req.method==='GET'){
  const saved=(await pool.query('SELECT topics,roles,enabled FROM project_interests WHERE user_id=$1',[u.id])).rows[0];
  return {...(saved||{topics:[],roles:[],enabled:false}),saved:!!saved,topic_options:topics.map(({key,label})=>({key,label})),role_options:roles.map(({key,label})=>({key,label}))};
 }
 if(req.method==='PUT'){
  const b=await json(req);
  const validate=(values,options)=>{if(!Array.isArray(values)||values.length>20||values.some(v=>!options.some(o=>o.key===v)))throw fail(400,'Выберите значения из списка');return [...new Set(values)];};
  const selectedTopics=validate(b.topics,topics),selectedRoles=validate(b.roles,roles);
  if(typeof b.enabled!=='boolean')throw fail(400,'Выберите режим уведомлений');
  if(b.enabled&&!selectedTopics.length&&!selectedRoles.length)throw fail(400,'Выберите направление или роль');
  await pool.query('INSERT INTO project_interests(user_id,topics,roles,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET topics=EXCLUDED.topics,roles=EXCLUDED.roles,enabled=EXCLUDED.enabled,updated_at=now()',[u.id,selectedTopics,selectedRoles,b.enabled]);
  return {ok:true};
 }
 throw fail(405,'Метод не поддерживается');
}
