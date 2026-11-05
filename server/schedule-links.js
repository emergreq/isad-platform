const days=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
export const courseKey=value=>String(value||'').replace(/^\s*[\d,\s]+п\.\s*г\.\s*/iu,'').replace(/\([^)]*\)/gu,'').trim().toLocaleLowerCase('ru').replace(/\s+/g,' ');
export function projectJointSchedule(entries,joints){
 let result=[...entries];
 for(const joint of joints){
  const source=entries.filter(e=>e.group===joint.primary_group&&courseKey(e.title)===courseKey(joint.course));
  if(!source.length)continue;
  for(const group of joint.group_names){if(group===joint.primary_group)continue;
   result=result.filter(e=>!(e.group===group&&courseKey(e.title)===courseKey(joint.course)));
   result.push(...source.map(e=>({...e,key:`${e.key}:joint:${joint.id}:${group}`,group,joint:true})));
  }
 }
 return result;
}

export function attachMeetingLinks(entries,links){
 return entries.map(entry=>{
  const weekday=days.indexOf(entry.day)+1;
  const matches=links.filter(link=>link.group_name===entry.group&&courseKey(link.course)===courseKey(entry.title)&&(link.weekday===0||link.weekday===weekday));
  // A specific weekday takes precedence over the general course link.
  const link=matches.sort((a,b)=>b.weekday-a.weekday)[0];
  return {...entry,meeting_url:link?.url||null,meeting_provider:link?.provider||'',recordings_at_same_url:!!link?.recordings_at_same_url};
 });
}
