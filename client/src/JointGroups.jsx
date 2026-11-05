import React,{useEffect,useState} from 'react';
export default function JointGroups({offering,call,onClose,onSaved}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{call(`offerings/${offering.id}/groups`).then(setData).catch(e=>setError(e.message));},[offering.id]);
 async function save(e){e.preventDefault();setBusy(true);setError('');try{const groups=[...new Set([data.primary_group,...new FormData(e.currentTarget).getAll('groups')])];await call(`offerings/${offering.id}/groups`,{groups},'PUT');await onSaved();onClose();}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section className="form-panel"><div className="section-head"><h3>Совместные группы · {offering.title}</h3><button className="link" onClick={onClose}>Закрыть</button></div>{error&&<p className="error" role="alert">{error}</p>}{data&&<form onSubmit={save}><fieldset className="skill-picker"><legend>Общие занятия, ДЗ и материалы</legend>{data.options.map(g=><label key={g.name}><input type="checkbox" name="groups" value={g.name} disabled={g.name===data.primary_group} defaultChecked={data.selected.includes(g.name)}/>{g.name}</label>)}</fieldset><button className="primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить группы'}</button></form>}</section>;
}
