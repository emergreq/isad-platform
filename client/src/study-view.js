export const weekdays=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
export function lessonGroups(items){
 const groups=new Map();
 for(const item of items){
  const key=item.lesson_no?`${item.offering_id}:${item.lesson_no}`:`material:${item.id}`;
  if(!groups.has(key))groups.set(key,{key,course:item.course,group:item.group_name,lesson:item.lesson_no,items:[]});
  groups.get(key).items.push(item);
 }
 const priority={presentation:0,manual:1,reference:2,practice:3};
 for(const group of groups.values())group.items.sort((a,b)=>(priority[a.kind]??9)-(priority[b.kind]??9)||a.title.localeCompare(b.title,'ru',{numeric:true}));
 return [...groups.values()].sort((a,b)=>a.course.localeCompare(b.course,'ru')||(a.lesson||999)-(b.lesson||999)||a.key.localeCompare(b.key));
}
export function scheduleDays(rows){
 return weekdays.map((day,index)=>({day,index,entries:rows.filter(x=>x.day===day).sort((a,b)=>a.lesson-b.lesson||String(a.time).localeCompare(String(b.time)))}));
}
