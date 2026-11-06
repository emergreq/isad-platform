import { pool } from './db.js';
export const fail=(status,message)=>Object.assign(new Error(message),{status});
export const number=(v)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<1)throw fail(400,'Некорректный идентификатор');return n;};
export const text=(v,max=4000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail(400,'Проверьте обязательные поля');return v.trim();};
export function day(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw fail(400,'Некорректная дата');return v;}
export function instant(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw fail(400,'Нужны дата, время и часовой пояс');return v;}
export function webUrl(v,optional=true){if(!v&&optional)return '';try{const u=new URL(v);if(u.protocol!=='https:')throw 0;return u.href;}catch{throw fail(400,'Нужна HTTPS-ссылка');}}
export async function json(req,max=80000){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw fail(413,'Слишком большой запрос');chunks.push(c);}try{const v=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw 0;return v;}catch{throw fail(400,'Некорректный JSON');}}
export const readAccess=`($2='coordinator' OR o.teacher_id=$1 OR EXISTS(SELECT 1 FROM memberships mm WHERE mm.user_id=$1 AND offering_has_group(o.id,mm.group_id) AND mm.starts_on<=CURRENT_DATE AND (mm.ends_on IS NULL OR mm.ends_on>=CURRENT_DATE)))`;
export async function offering(u,id,write=false,c=pool){const r=await c.query(`SELECT o.*,c.title course,g.name group_name FROM offerings o JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id WHERE o.id=$3 AND ${write?"($2='coordinator' OR ($2='teacher' AND o.teacher_id=$1))":readAccess}`,[u.id,u.role,number(id)]);if(!r.rowCount)throw fail(404,'Предмет не найден или недоступен');return r.rows[0];}
// Рассылка студентам предмета (состав группы на сегодня по Москве) — функция БД notify_offering_students (db/016)
export async function notify(c,offeringId,key,title,message,page,targetId){await c.query('SELECT notify_offering_students($1,msk_today(),$2,$3,$4,$5,$6::integer)',[offeringId,key,title,message,page,targetId]);}
