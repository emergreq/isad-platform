import {courseKey} from '../../server/schedule-links.js';
export const moscowDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const time=value=>new Date(value).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'});
export function todayClasses(source,{date=moscowDay(Date.now()),group,subgroup=1,week='upper'}={}){
 const weekday=new Date(date+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow',weekday:'long'}).toLocaleLowerCase('ru');
 const dated=(source?.announcements||[]).filter(n=>['session','announcement'].includes(n.kind)&&(n.group_names||[n.group_name]).includes(group)&&(n.date===date||(n.original_starts_at&&moscowDay(n.original_starts_at)===date)));
 const base=(source?.entries||[]).filter(e=>e.group===group&&String(e.subgroup)===String(subgroup)&&e.week===week&&e.day.toLocaleLowerCase('ru')===weekday);
 const rows=base.filter(e=>!dated.some(n=>courseKey(n.course)===courseKey(e.title)&&(n.original_starts_at||n.starts_at)&&moscowDay(n.original_starts_at||n.starts_at)===date&&time(n.original_starts_at||n.starts_at)===e.time.split(' — ')[0])).map(e=>({...e,sort:e.time.split(' — ')[0],id:e.key,course:e.title}));
 for(const n of dated){const movedOut=n.rescheduled_at&&moscowDay(n.starts_at)!==date;
  rows.push({...n,id:n.key,course:n.course,title:n.kind==='announcement'?n.title:n.course,time:n.starts_at?time(movedOut?n.original_starts_at:n.starts_at):'Время не указано',sort:n.starts_at?time(movedOut?n.original_starts_at:n.starts_at):'99:99',room:n.room||'',cancelled:n.status==='cancelled',movedOut,meeting_url:n.status==='cancelled'||movedOut?null:n.meeting_url||n.url,warning:movedOut?'Перенесено на '+new Date(n.starts_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):n.rescheduled_at?'Занятие перенесено':n.status==='cancelled'?'Занятие отменено':''});
 }
 return rows.sort((a,b)=>a.sort.localeCompare(b.sort)||a.title.localeCompare(b.title));
}

export function teacherTodayClasses(source,{date=moscowDay(Date.now()),week='upper',offerings=[],group=''}={}){
 const groups=[...new Set(offerings.flatMap(o=>o.group_names||[o.group_name]))].filter(g=>g&&(!group||group===g)),merged=new Map();
 for(const g of groups){
  const subgroups=[...new Set((source?.entries||[]).filter(e=>e.group===g).map(e=>e.subgroup))];if(!subgroups.length)subgroups.push(1);
  for(const subgroup of subgroups)for(const row of todayClasses(source,{date,group:g,subgroup,week})){
   const offering=offerings.find(o=>(o.group_names||[o.group_name]).includes(g)&&courseKey(o.title)===courseKey(row.course));if(!offering)continue;
   const key=row.source_type?row.id:JSON.stringify([offering.id,row.time,courseKey(row.title),row.room||'',row.warning||'']);
   const previous=merged.get(key);if(previous){previous.group_names=[...new Set([...previous.group_names,g])];continue;}
   merged.set(key,{...row,id:'teacher:'+key,group_names:[g]});
  }
 }
 return [...merged.values()].sort((a,b)=>a.sort.localeCompare(b.sort)||a.title.localeCompare(b.title));
}
