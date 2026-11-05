import { mkdir,writeFile,readFile,unlink } from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import { pool,transaction } from './db.js';
import {fail,number,text,json,offering,readAccess,notify,webUrl} from './mvp-utils.js';
const root=resolve(process.env.FILES_DIR||'work/uploads');
export async function assistantCall(route,payload,timeout=30000){
 const secret=process.env.ASSISTANT_SHARED_SECRET;if(!secret)throw fail(503,'Сервис поиска ещё не настроен');
 const body=JSON.stringify({...payload,timestamp:Date.now(),nonce:randomUUID()});
 const response=await fetch((process.env.ASSISTANT_URL||'http://assistant:3001')+route,{method:'POST',headers:{'Content-Type':'application/json','x-signature':createHmac('sha256',secret).update(route+'\n'+body).digest('hex')},body,signal:AbortSignal.timeout(timeout)});
 const result=await response.json();if(!response.ok)throw fail(response.status,result.error||'Поиск временно недоступен');return result;
}
export async function indexFile(file,material){
 try{
  let pages=[];const bytes=await readFile(join(root,file.storage_name));
  if(file.mime==='application/pdf'){
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true,isEvalSupported:false});
   try{
    const doc=await task.promise;if(doc.numPages>1500)throw Error('Слишком много страниц');
    for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n);const content=await page.getTextContent();pages.push({page:n,text:content.items.map(x=>x.str+(x.hasEOL?'\n':' ')).join('')});page.cleanup();}
   }finally{await task.destroy();}
  }else if(/\.(sql|dbml|ya?ml|txt|md|json)$/i.test(file.original_name)){pages=[{page:1,text:bytes.toString('utf8')}];}
  if(!pages.length||!pages.some(x=>x.text.trim())){await pool.query("UPDATE stored_files SET status='reference',page_count=$2,error='Нет извлекаемого текста; файл доступен для скачивания' WHERE id=$1",[file.id,pages.length]);return;}
  await assistantCall('/internal/index',{file_id:file.id,material_id:material.id,title:material.title,version:material.version,checksum:file.checksum,pages},120000);
  await pool.query("UPDATE stored_files SET status='ready',page_count=$2,error=NULL WHERE id=$1",[file.id,pages.length]);
 }catch(e){await pool.query("UPDATE stored_files SET status='error',error=$2 WHERE id=$1",[file.id,String(e.message).slice(0,250)]);}
}
export async function saveFile(bytes,filename,owner,materialId=null){
 const ext=extname(filename).toLowerCase();const types={'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.sql':'text/plain','.dbml':'text/plain','.yml':'text/plain','.yaml':'text/plain','.txt':'text/plain','.md':'text/plain','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
 if(!types[ext])throw fail(400,'Поддерживаются PDF, DOCX, SQL, DBML, YAML, TXT, MD и XLSX');
 if(!bytes.length||bytes.length>25*1024*1024)throw fail(413,'Размер файла: от 1 байта до 25 МБ');
 if(ext==='.pdf'&&bytes.subarray(0,5).toString()!=='%PDF-')throw fail(400,'Некорректный PDF');
 if(['.xlsx','.docx'].includes(ext)&&bytes.subarray(0,2).toString()!=='PK')throw fail(400,'Некорректный XLSX');
 const checksum=createHash('sha256').update(bytes).digest('hex');
 if(materialId){const existing=(await pool.query('SELECT * FROM stored_files WHERE material_id=$1 AND checksum=$2',[materialId,checksum])).rows[0];if(existing){if(existing.archived)await pool.query('UPDATE stored_files SET archived=false WHERE id=$1',[existing.id]);return {...existing,archived:false};}}
 const id=randomUUID(),storageName=id+ext;await mkdir(root,{recursive:true});await writeFile(join(root,storageName),bytes,{flag:'wx'});
 try{return (await pool.query('INSERT INTO stored_files(id,owner_id,material_id,original_name,storage_name,mime,size,checksum) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id,owner,materialId,filename.slice(0,220),storageName,types[ext],bytes.length,checksum])).rows[0];}
 catch(e){await unlink(join(root,storageName));throw e;}
}
export async function libraryRoutes(req,res,u){
 const url=new URL(req.url,'http://localhost'),p=url.pathname;let m;
 if(req.method==='GET'&&p==='/api/library')return (await pool.query(`SELECT m.*,c.title course,g.name group_name,u.name teacher,
 COALESCE((SELECT json_agg(json_build_object('id',f.id,'name',f.original_name,'size',f.size,'status',f.status,'pages',f.page_count,'error',f.error,'url','/api/files/'||f.id) ORDER BY f.created_at) FROM stored_files f WHERE f.material_id=m.id AND NOT f.archived),'[]') files
 FROM materials m JOIN offerings o ON o.id=m.offering_id JOIN courses c ON c.id=o.course_id JOIN groups g ON g.id=o.group_id JOIN users u ON u.id=o.teacher_id
 WHERE ${readAccess} AND (m.published OR $2='coordinator' OR o.teacher_id=$1) ORDER BY c.title,m.lesson_no NULLS LAST,m.id`,[u.id,u.role])).rows;
 if(req.method==='POST'&&(p==='/api/library/upload'||p==='/api/profile/files')){
  const personal=p==='/api/profile/files',draft=url.searchParams.get('draft')==='coursework';let material;
  const existingId=!personal&&url.searchParams.get('material_id');
  if(!personal){const o=await offering(u,url.searchParams.get('offering_id'),true);material={offering_id:o.id};if(existingId){material=(await pool.query('SELECT * FROM materials WHERE id=$1 AND offering_id=$2',[number(existingId),o.id])).rows[0];if(!material)throw fail(404,'Материал не найден');}}
  const filename=text(url.searchParams.get('filename'),220);
  if(personal&&!/\.pdf$/i.test(filename))throw fail(400,'Для резюме и сертификата нужен PDF');
  let size=0;const parts=[];for await(const c of req){size+=c.length;if(size>25*1024*1024)throw fail(413,'Максимум 25 МБ');parts.push(c);}
  const bytes=Buffer.concat(parts);
  const lessonRaw=url.searchParams.get('lesson_no');const lessonNo=lessonRaw?Number(lessonRaw):null;
  if(lessonNo!==null&&(!Number.isInteger(lessonNo)||lessonNo<1||lessonNo>999))throw fail(400,'Номер занятия: от 1 до 999');
  if(!personal&&!existingId){
   const title=text(url.searchParams.get('title')||filename,220),kind=url.searchParams.get('kind')||'reference';
   material=(await pool.query('INSERT INTO materials(offering_id,title,url,kind,topic,author,lesson_no,published,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[material.offering_id,title,'',kind,String(url.searchParams.get('topic')||'').slice(0,500),String(url.searchParams.get('author')||'').slice(0,250),lessonNo,!draft,String(url.searchParams.get('description')||'').slice(0,6000)])).rows[0];
  }
  try{const file=await saveFile(bytes,filename,u.id,material?.id);if(material){await pool.query("UPDATE materials SET url=CASE WHEN url='' THEN $2 ELSE url END WHERE id=$1",[material.id,'/api/files/'+file.id]);void indexFile(file,material);if(!draft)await notify(pool,material.offering_id,'material:'+material.id,'Новый материал: '+material.title,'Материал добавлен преподавателем','library',material.id);}return {id:file.id,material_id:material?.id,url:'/api/files/'+file.id,status:file.status};}
  catch(e){if(material&&!existingId)await pool.query('DELETE FROM materials WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM stored_files WHERE material_id=$1)',[material.id]);throw e;}
 }
 if(req.method==='POST'&&(m=p.match(/^\/api\/library\/(\d+)\/retry$/))){const material=(await pool.query('SELECT * FROM materials WHERE id=$1',[number(m[1])])).rows[0];if(!material)throw fail(404,'Материал не найден');await offering(u,material.offering_id,true);const files=(await pool.query('SELECT * FROM stored_files WHERE material_id=$1',[material.id])).rows;for(const f of files){await pool.query("UPDATE stored_files SET status='pending',error=NULL WHERE id=$1",[f.id]);void indexFile(f,material);}return {ok:true};}
 if(req.method==='POST'&&p==='/api/library'){
  const b=await json(req),o=await offering(u,b.offering_id,true);const lesson=b.lesson_no?number(b.lesson_no):null;if(lesson>999)throw fail(400,'Номер занятия: от 1 до 999');
  if(!['presentation','manual','practice','reference'].includes(b.kind||'reference'))throw fail(400,'Некорректный тип');
  return transaction(async c=>{
   const material=(await c.query("INSERT INTO materials(offering_id,title,url,kind,topic,author,lesson_no,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[o.id,text(b.title,220),webUrl(b.url,false),b.kind||'reference',String(b.topic||'').slice(0,500),String(b.author||'').slice(0,250),lesson,String(b.description||'').slice(0,6000)])).rows[0];
   await notify(c,o.id,'material:'+material.id,'Новый материал: '+material.title,'Материал добавлен преподавателем','library',material.id);return material;
  });
 }
 if(req.method==='PATCH'&&(m=p.match(/^\/api\/library\/(\d+)$/))){
  const b=await json(req);const saved=await transaction(async c=>{
   const material=(await c.query('SELECT * FROM materials WHERE id=$1 FOR UPDATE',[number(m[1])])).rows[0];if(!material)throw fail(404,'Материал не найден');await offering(u,material.offering_id,true,c);
   const next={...material};let changed=false;
   for(const key of ['title','kind','topic','author','description','lesson_no','published','url'])if(Object.hasOwn(b,key)){
    changed=true;next[key]=b[key];
    if(key==='title')next[key]=text(b[key],220);
    if(key==='published'&&typeof b[key]!=='boolean')throw fail(400,'Нужен статус публикации');
    if(key==='lesson_no'){next[key]=b[key]===''||b[key]===null?null:number(b[key]);if(next[key]>999)throw fail(400,'Номер занятия: от 1 до 999');}
    if(key==='kind'&&!['presentation','manual','practice','reference'].includes(b[key]))throw fail(400,'Некорректный тип');
    if(['topic','author','description'].includes(key)){if(typeof b[key]!=='string'||b[key].length>({topic:500,author:250,description:6000}[key]))throw fail(400,'Слишком длинное описание');}
    if(key==='url'){if((await c.query('SELECT 1 FROM stored_files WHERE material_id=$1 AND NOT archived',[material.id])).rowCount)throw fail(400,'Ссылку файла менять нельзя: добавьте новый файл');next.url=webUrl(b.url,false);}
   }
   if(!changed)throw fail(400,'Нет изменений');
   await c.query('INSERT INTO material_history(material_id,version,title,url,changed_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[material.id,material.version,material.title,material.url,u.id]);
   const updated=(await c.query('UPDATE materials SET title=$2,kind=$3,topic=$4,author=$5,description=$6,lesson_no=$7,published=$8,url=$9,version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[material.id,next.title,next.kind,next.topic,next.author,next.description,next.lesson_no,next.published,next.url])).rows[0];
   await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'material',$2,'edit',$3)",[u.id,material.id,JSON.stringify({before:material,after:updated})]);return updated;
  });
  if(Object.hasOwn(b,'title')){const files=(await pool.query('SELECT * FROM stored_files WHERE material_id=$1 AND NOT archived',[saved.id])).rows;for(const f of files){await pool.query("UPDATE stored_files SET status='pending' WHERE id=$1",[f.id]);void indexFile(f,saved);}}
  return saved;
 }
 if(req.method==='DELETE'&&(m=p.match(/^\/api\/library\/(\d+)\/files\/([a-f0-9-]{36})$/i))){
  return transaction(async c=>{
   const material=(await c.query('SELECT * FROM materials WHERE id=$1 FOR UPDATE',[number(m[1])])).rows[0];if(!material)throw fail(404,'Материал не найден');await offering(u,material.offering_id,true,c);
   if((await c.query("SELECT 1 FROM coursework cw JOIN calendar_events e ON e.id=cw.event_id WHERE cw.requirements_file_id=$1 AND e.status<>'cancelled'",[m[2]])).rowCount)throw fail(409,'Файл используется как требования к курсовой');
   const file=(await c.query('UPDATE stored_files SET archived=true WHERE id=$1 AND material_id=$2 RETURNING *',[m[2],material.id])).rows[0];if(!file)throw fail(404,'Файл не найден');
   await c.query("UPDATE materials SET url=COALESCE((SELECT '/api/files/'||id FROM stored_files WHERE material_id=$1 AND NOT archived ORDER BY created_at LIMIT 1),''),updated_at=now() WHERE id=$1 AND url=$2",[material.id,'/api/files/'+file.id]);
   await c.query("INSERT INTO audit_events(actor_id,object_type,object_id,action,detail) VALUES($1,'material',$2,'archive_file',$3)",[u.id,material.id,JSON.stringify({file_id:file.id,name:file.original_name})]);return {ok:true};
  });
 }
 if(req.method==='GET'&&(m=p.match(/^\/api\/files\/([a-f0-9-]{36})$/i))){
  const f=(await pool.query('SELECT * FROM stored_files WHERE id=$1',[m[1]])).rows[0];if(!f)throw fail(404,'Файл не найден');if(f.archived)throw fail(404,'Файл убран из материалов');
  if(f.material_id){const material=(await pool.query('SELECT * FROM materials WHERE id=$1',[f.material_id])).rows[0];await offering(u,material.offering_id);if(!material.published&&u.role!=='coordinator'&&(await offering(u,material.offering_id)).teacher_id!==u.id)throw fail(404,'Файл недоступен');}
  else if(f.purpose!=='schedule'&&f.owner_id!==u.id&&u.role!=='coordinator'){
   const allowed=(await pool.query(`SELECT 1 FROM credit_requests cr JOIN offerings o ON o.id=cr.offering_id WHERE o.teacher_id=$1 AND cr.snapshot->>'certificate_file_id'=$2`,[u.id,f.id])).rowCount;
   if(!allowed)throw fail(404,'Файл недоступен');
  }
  const resolved=resolve(root,f.storage_name);if(!resolved.startsWith(root+'/')&&!resolved.startsWith(root+'\\'))throw fail(404,'Файл недоступен');
  const bytes=await readFile(resolved);res.setHeader('Content-Type',f.mime);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`${f.mime==='application/pdf'?'inline':'attachment'}; filename="file${extname(f.storage_name)}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);res.end(bytes);return {ok:true};
 }
 if(req.method==='POST'&&p==='/api/assistant/search'){
  const b=await json(req);const query=text(b.query,1500);const args=[u.id,u.role];let filter='';
  if(b.course_id){args.push(number(b.course_id));filter+=` AND o.course_id=$${args.length}`;}
  if(b.material_id){args.push(number(b.material_id));filter+=` AND m.id=$${args.length}`;}
  const allowed=(await pool.query(`SELECT f.id FROM stored_files f JOIN materials m ON m.id=f.material_id JOIN offerings o ON o.id=m.offering_id WHERE m.published AND NOT f.archived AND f.status='ready' AND ${readAccess}${filter}`,args)).rows.map(x=>x.id);
  try{return await assistantCall('/internal/search',{owner_id:String(u.id),query,explain:b.explain===true,allowed_files:allowed,conversation_id:b.conversation_id||null});}catch(e){throw fail(503,e.message||'Поиск временно недоступен');}
 }
 return undefined;
}
