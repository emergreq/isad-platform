import React,{useEffect,useState} from 'react';
import CourseRequirements,{assessmentNames} from './CourseRequirements.jsx';
import JointGroups from './JointGroups.jsx';
import CourseworkPanel from './CourseworkPanel.jsx';

export default function ProfilePage({me,offerings,onChanged,call,upload,courseworks=[]}){
 const [profile,setProfile]=useState(null),[group,setGroup]=useState(''),[subgroup,setSubgroup]=useState('1'),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const student=['student','headman'].includes(me.role);
 const [requirements,setRequirements]=useState(null),[joint,setJoint]=useState(null);
 const settingsApi=(path,options)=>call(path,JSON.parse(options.body),options.method);
 const load=async()=>{const p=await call('profile');setProfile(p);setGroup(p.groups[0]?.name||'');setSubgroup(String(p.subgroup||1));};
 useEffect(()=>{load().catch(e=>setError(e.message));},[]);
 async function saveGroup(e){e.preventDefault();setBusy(true);setError('');setMessage('');try{await call('profile/group',{group,subgroup});await load();await onChanged();setMessage('Группа сохранена. Расписание, материалы и календарь обновлены для вашей группы.');}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function saveBio(e){e.preventDefault();setBusy(true);setError('');setMessage('');try{const f=new FormData(e.currentTarget),file=f.get('resume');let resume=profile.resume_file_id;if(file?.size)resume=(await upload(file,{},true)).id;await call('profile',{name:f.get('name'),bio:f.get('bio'),skills:f.getAll('skills'),resume_file_id:resume},'PATCH');await load();await onChanged();setMessage('Профиль сохранён');}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <><div className="mvp-intro"><span className="eyebrow">ТВОЁ ПРОСТРАНСТВО</span><h2>{profile?.name||me.name}</h2><p>{({teacher:'Преподаватель',coordinator:'Координатор',student:'Студент',headman:'Староста'})[me.role]}</p></div>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="profile-saved" role="status">{message}</p>}
  {profile&&<>
   {student&&<section className="profile-group-panel"><div><span className="eyebrow">УЧЁБА ДЛЯ ТВОЕЙ ГРУППЫ</span><h3>Моя группа</h3><p>Выберите свою учебную группу. В портале появятся её занятия, материалы и дедлайны.</p></div><form onSubmit={saveGroup}><label>Учебная группа<select value={group} onChange={e=>setGroup(e.target.value)} required><option value="">Выберите группу</option>{profile.group_options.map(g=><option key={g.name} value={g.name}>{g.name}</option>)}</select></label><label>Моя подгруппа<select value={subgroup} onChange={e=>setSubgroup(e.target.value)}><option value="1">1 подгруппа</option><option value="2">2 подгруппа</option></select></label><button className="primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить группу'}</button></form>{profile.groups.length>0&&<span className="current-group">Сейчас: {profile.groups.map(g=>g.name).join(', ')} · {profile.subgroup||1} подгруппа</span>}</section>}
   {me.role==='teacher'&&<section className="meeting-box"><h3>Мои предметы и группы</h3>{offerings.map(o=><div className="teacher-course" key={o.id}><p>{o.title} · {(o.group_names||[o.group_name]).join(' + ')}{o.assessment_type?' · '+assessmentNames[o.assessment_type]:''}</p><button className="link" onClick={()=>setRequirements(o)}>Форма контроля и условия</button><button className="link" onClick={()=>setJoint(o)}>Совместные группы</button></div>)}{!offerings.length&&<p>Преподавания ещё не назначены координатором.</p>}</section>}
   <CourseworkPanel items={courseworks} offerings={offerings} staff={['teacher','coordinator'].includes(me.role)} api={settingsApi} onChanged={onChanged}/>
   {joint&&<JointGroups offering={joint} call={call} onClose={()=>setJoint(null)} onSaved={onChanged}/>}
   {requirements&&<CourseRequirements offering={requirements} api={settingsApi} onClose={()=>setRequirements(null)} onSaved={onChanged}/>}
   <section className="form-panel"><h3>О себе и навыки</h3><form onSubmit={saveBio}><div className="form-grid"><label>ФИО<input name="name" defaultValue={profile.name||me.name} required maxLength={150}/></label><label>Краткое описание<textarea name="bio" defaultValue={profile.bio}/></label><label>Резюме PDF (доступно владельцу)<input type="file" name="resume" accept=".pdf"/>{profile.resume_file_id&&<a href={'/api/files/'+profile.resume_file_id} target="_blank" rel="noreferrer">Текущее резюме ↗</a>}</label><fieldset className="skill-picker"><legend>Навыки</legend>{profile.skill_options.map(s=><label key={s.id}><input type="checkbox" name="skills" value={s.id} defaultChecked={profile.skills.some(x=>x.id===s.id)}/>{s.name}</label>)}</fieldset></div><button className="primary" disabled={busy}>{busy?'Сохраняем…':'Сохранить профиль'}</button></form></section>
   {student&&<><h3>Мои достижения</h3><div className="cards">{profile.achievements.map(a=><article key={a.id}><div className="meta">Добавлено пользователем · {{participation:'Участие',prize:'Призовое место',winner:'Победа'}[a.result]}</div><h3>{a.title}</h3><p>{a.contribution}</p>{a.github_url&&<a href={a.github_url} target="_blank" rel="noreferrer">GitHub ↗</a>}</article>)}</div>{!profile.achievements.length&&<p className="empty">Добавьте достижение в разделе «Хакатоны и зачёты».</p>}</>}
  </>}
 </>;
}
