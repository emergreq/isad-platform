import React from 'react';
import {lessonGroups} from './study-view.js';

const types={presentation:'Презентация',manual:'Методичка',practice:'Практика',reference:'Материал'};
const statuses={pending:'Обработка',ready:'Готов для поиска',reference:'Доступен для скачивания',error:'Ошибка обработки'};
export default function LessonLibrary({items,query,staff,offerings,onToggle,onRetry,onEdit,onRemoveFile,onAdd}){
 const groups=lessonGroups(items).filter(g=>!query||g.items.some(x=>`${x.title} ${x.topic} ${x.author} ${x.lesson_no?'занятие '+x.lesson_no:''}`.toLowerCase().includes(query.toLowerCase())));
 return <>{groups.length?<div className="lesson-library">{groups.map(g=>{
  const presentation=g.items.find(x=>x.kind==='presentation'),count=g.items.reduce((n,x)=>n+x.files.length,0),noun={one:'файл',few:'файла',many:'файлов',other:'файлов'}[new Intl.PluralRules('ru').select(count)];
  return <section className={`lesson-bundle ${g.lesson?'':'reference-bundle'}`} key={g.key} aria-label={g.lesson?`${g.course}, занятие ${g.lesson}`:g.items[0].title}>
   <header className="lesson-bundle-heading"><span className="bundle-number">{g.lesson?String(g.lesson).padStart(2,'0'):'PDF'}</span><div><p>{g.course} · {g.group}</p><h3>{g.lesson?`Занятие ${g.lesson}`:g.items[0].title}</h3>{presentation&&<span>{presentation.title.replace(/^Занятие\s+\d+\.\s*/,'')}</span>}</div>{staff&&offerings.some(o=>o.id===g.items[0].offering_id)&&<button className="link lesson-add" onClick={()=>onAdd(g)}>+ Добавить материал</button>}</header>
   <div className="bundle-summary">{count} {noun}</div>
   <div className="lesson-resources">{g.items.map(x=><div className="lesson-resource" id={`material-${x.id}`} key={x.id}>
    <div className="resource-heading"><span className="resource-type">{x.kind==='presentation'||x.kind==='manual'?'PDF':'⌘'}</span><div><h4>{x.title.replace(/^Занятие\s+\d+\.\s*/,'')}</h4><p>{types[x.kind]||'Материал'}{x.author?' · '+x.author:''}{!x.published?' · снят с публикации':''}</p></div></div>
    {x.description&&<p className="resource-description multiline">{x.description}</p>}
    <div className="file-list">{x.files.map(f=><div key={f.id}><a href={f.url} target="_blank" rel="noreferrer">{f.name}<span aria-hidden="true"> ↗</span></a><small>{Math.round(Number(f.size)/1024)} КБ{f.pages?' · '+f.pages+' стр.':''}{!['ready','reference'].includes(f.status)?' · '+statuses[f.status]:''}</small>{staff&&offerings.some(o=>o.id===x.offering_id)&&<button className="link remove-resource" onClick={()=>onRemoveFile(x,f)}>Убрать файл</button>}{f.error&&<small>{f.status==='error'?'Не удалось построить индекс. Можно открыть оригинал или повторить обработку.':f.error}</small>}</div>)}</div>
    {!x.files.length&&x.url&&<a href={x.url} target="_blank" rel="noreferrer">Открыть материал ↗</a>}
    {staff&&offerings.some(o=>o.id===x.offering_id)&&<div className="toolbar resource-actions"><button className="link" onClick={()=>onEdit(x)}>Редактировать</button><button className="link" onClick={()=>onToggle(x)}>{x.published?'Снять с публикации':'Опубликовать'}</button><button className="link" onClick={()=>onRetry(x)}>Обработать повторно</button></div>}
   </div>)}</div>
  </section>;
 })}</div>:<p className="empty">Материалов по выбранному фильтру нет.</p>}</>;
}
