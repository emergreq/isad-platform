import React,{useEffect,useState} from 'react';

export default function SearchAssistant({call}){
 const [courses,setCourses]=useState([]),[query,setQuery]=useState(''),[selected,setSelected]=useState(''),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{call('offerings').then(items=>setCourses([...new Map(items.map(o=>[o.course_id,{id:o.course_id,title:o.title}])).values()].sort((a,b)=>a.title.localeCompare(b.title,'ru')))).catch(e=>setError(e.message));},[]);
 async function search(e){e.preventDefault();if(!query.trim())return;setBusy(true);setError('');try{setResult(await call('assistant/search',{query:query.trim(),course_id:selected||null}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 const groups=new Map();for(const source of result?.sources||[]){if(!groups.has(source.portal_file_id))groups.set(source.portal_file_id,[]);groups.get(source.portal_file_id).push(source);}
 return <><form className="assistant-search compact-search" onSubmit={search}><label>Поиск<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Тема или вопрос" maxLength={1500} required/></label><label>Предмет<select value={selected} disabled={busy} onChange={e=>{setSelected(e.target.value);setResult(null);}}><option value="">Все предметы</option>{courses.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label><button className="primary" disabled={busy}>{busy?'Ищем…':'Найти'}</button></form>
  {error&&<p className="error" role="alert">{error}</p>}
  <div className="compact-results" aria-live="polite">{[...groups.values()].map(sources=>{const first=sources[0],text=/\.(sql|dbml|ya?ml|txt|md)\b/i.test(first.title);return <section className="search-document" key={first.portal_file_id}><a className="document-title" href={`/api/files/${first.portal_file_id}#page=${first.page}`} target="_blank" rel="noreferrer"><span className="resource-type">{text?'TXT':'PDF'}</span><h3>{first.title}</h3><span>↗</span></a><div className="document-pages">{sources.map(s=><a key={s.page} href={`/api/files/${s.portal_file_id}#page=${s.page}`} target="_blank" rel="noreferrer">{text?'Открыть файл':`Страница ${s.page}`} ↗</a>)}</div></section>;})}{result&&!result.sources.length&&<p className="empty">Ничего не найдено. Попробуй другие ключевые слова.</p>}</div>
 </>;
}
