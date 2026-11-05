import React,{useEffect,useRef,useState} from 'react';
import LessonLibrary from './LessonLibrary.jsx';
import {useDeepFocus} from './navigation.js';

export default function CourseLibrary({offerings,allOfferings,staff,onChanged,initialCourse,call,upload}){
 const [items,setItems]=useState([]),[filter,setFilter]=useState(initialCourse||''),[query,setQuery]=useState(''),[error,setError]=useState(''),[editor,setEditor]=useState(null),[busy,setBusy]=useState(false);
 const formRef=useRef(null);
 useEffect(()=>{if(editor)formRef.current?.scrollIntoView({behavior:'smooth',block:'start'});},[editor]);
 const load=()=>call('library').then(setItems).catch(e=>setError(e.message));
 useEffect(()=>{load();},[]);useEffect(()=>setFilter(initialCourse||''),[initialCourse]);useDeepFocus(items);
 useEffect(()=>{if(!items.some(x=>x.files.some(f=>f.status==='pending')))return;const timer=setTimeout(load,1500);return()=>clearTimeout(timer);},[items]);
 const courses=[...new Set([...allOfferings.map(o=>o.title),...items.map(x=>x.course)])];
 const visibleCourses=filter?[filter]:courses.filter(course=>items.some(x=>x.course===course));
 const open=(item={})=>{setError('');setEditor({...item,mode:item.id?'edit':'add',source:'file'});};
 async function submit(e){e.preventDefault();setBusy(true);setError('');try{const f=new FormData(e.currentTarget),values=Object.fromEntries([...f.entries()].filter(([k])=>!['file','source'].includes(k)));
  if(editor.mode==='edit'){
   await call(`library/${editor.id}`,values,'PATCH');
   if(f.get('file')?.size)await upload(f.get('file'),{offering_id:editor.offering_id,material_id:editor.id});
  }else if(editor.source==='link')await call('library',values);
  else await upload(f.get('file'),values);
  setEditor(null);await load();await onChanged();
 }catch(e){setError(e.message);await load();}finally{setBusy(false);}}
 const remove=async(x,file)=>{if(!window.confirm(`Убрать файл «${file.name}» из материалов занятия?`))return;setError('');try{await call(`library/${x.id}/files/${file.id}`,{},'DELETE');await load();await onChanged();}catch(e){setError(e.message);}};
 const toggle=async x=>{try{await call(`library/${x.id}`,{published:!x.published},'PATCH');await load();onChanged();}catch(e){setError(e.message);}};
 const retry=async x=>{try{await call(`library/${x.id}/retry`,{});await load();}catch(e){setError(e.message);}};
 return <>
  <div className="subject-toolbar"><div className="subject-tabs" aria-label="Предметы"><button aria-pressed={!filter} onClick={()=>setFilter('')}>Все</button>{courses.map(course=><button key={course} aria-pressed={filter===course} onClick={()=>setFilter(course)}>{course}</button>)}</div>{staff&&<button className="primary" onClick={()=>editor?setEditor(null):open({offering_id:offerings.find(o=>o.title===filter)?.id})}>+ Материал</button>}</div>
  {error&&<p className="error" role="alert">{error}</p>}
  {editor&&<section className="form-panel" ref={formRef}><div className="section-head"><h3>{editor.mode==='edit'?'Редактировать материал':'Новый материал'}</h3><button className="link" onClick={()=>setEditor(null)}>Закрыть</button></div><form onSubmit={submit} key={editor.id||`${editor.offering_id}:${editor.lesson_no}`}><div className="form-grid">
  {editor.mode==='add'&&<label>Предмет<select name="offering_id" required defaultValue={editor.offering_id||''}><option value="">Выберите предмет</option>{offerings.map(o=><option key={o.id} value={o.id}>{o.title} · {(o.group_names||[o.group_name]).join(' + ')}</option>)}</select></label>}
  <label>Название<input name="title" required maxLength={220} defaultValue={editor.title||''}/></label><label>Тип<select name="kind" defaultValue={editor.kind||'reference'}><option value="presentation">Презентация</option><option value="manual">Методичка</option><option value="practice">Практика</option><option value="reference">Материал</option></select></label><label>Занятие<input name="lesson_no" type="number" min="1" max="999" defaultValue={editor.lesson_no||''}/></label><label>Тема<input name="topic" maxLength={500} defaultValue={editor.topic||''}/></label><label>Автор<input name="author" maxLength={250} defaultValue={editor.author||''}/></label><label>Описание<textarea name="description" maxLength={6000} defaultValue={editor.description||''}/></label>
  {editor.mode==='add'&&<label>Материал<select value={editor.source} onChange={e=>setEditor({...editor,source:e.target.value})}><option value="file">Файл</option><option value="link">Ссылка</option></select></label>}
  {editor.mode==='add'&&editor.source==='link'||editor.mode==='edit'&&!editor.files?.length&&!editor.url?.startsWith('/api/files/')&&editor.url?<label>Ссылка<input name="url" type="url" required placeholder="https://…" defaultValue={editor.url||''}/></label>:<label>{editor.mode==='edit'?'Добавить файл (необязательно)':'Файл до 25 МБ'}<input name="file" type="file" required={editor.mode==='add'} accept=".pdf,.docx,.sql,.dbml,.yaml,.yml,.txt,.md,.xlsx"/></label>}
  </div><button className="primary" disabled={busy}>{busy?'Сохраняем…':editor.mode==='edit'?'Сохранить изменения':'Добавить'}</button></form></section>}
  <label className="material-search">Поиск<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название или тема"/></label>
  {visibleCourses.map(course=><section className="subject-section" key={course} aria-label={course}><div className="subject-title"><h2>{course}</h2><span>{items.filter(x=>x.course===course).reduce((n,x)=>n+x.files.length,0)}</span></div><LessonLibrary items={items.filter(x=>x.course===course)} query={query} staff={staff} offerings={offerings} onToggle={toggle} onRetry={retry} onEdit={open} onRemoveFile={remove} onAdd={g=>open({offering_id:g.items[0].offering_id,lesson_no:g.lesson})}/></section>)}
  {!visibleCourses.length&&<p className="empty">Материалы пока не добавлены.</p>}
 </>;
}
