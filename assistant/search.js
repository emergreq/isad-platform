const stop=new Set(('а и или но в во на к ко с со у о об по про из для до от за при это этот эта эти как что где когда почему зачем какой какая какие такое такой мне меня мой моя мои пожалуйста пж найди найти покажи покажите расскажи объясни объяснить подскажи помоги хочу нужно надо можно есть было будет бы ли же то там тут еще более просто материал материалы методичка методичку презентация презентацию документ документа странице страница из').split(' '));
export function searchTerms(query){
 const tokens=String(query).toLocaleLowerCase('ru').replace(/ё/g,'е').match(/[\p{L}\p{N}]+/gu)||[];
 return [...new Set(tokens.filter(x=>x.length>1&&!stop.has(x)))].slice(0,16);
}
export async function findPages(db,query,allowed){
 const terms=searchTerms(query);if(!terms.length||!allowed.length)return [];
 const sql=`WITH scored AS (
  SELECT ch.id,ch.page,ch.content,d.title,d.portal_file_id,d.material_id,d.version,
   hits.exact*4+hits.fuzzy+ts_rank(ch.search,to_tsquery('russian',$3))*3 AS score
  FROM chunks ch JOIN documents d ON d.id=ch.document_id
  CROSS JOIN LATERAL (
   SELECT count(*) FILTER (WHERE ch.search @@ plainto_tsquery('russian',term) OR to_tsvector('russian',d.title) @@ plainto_tsquery('russian',term))::float exact,
    sum(greatest(strict_word_similarity(term,ch.content),strict_word_similarity(term,d.title))) fuzzy,
    count(*) FILTER (WHERE ch.search @@ plainto_tsquery('russian',term) OR greatest(strict_word_similarity(term,ch.content),strict_word_similarity(term,d.title))>=0.42) matched
   FROM unnest($2::text[]) term
  ) hits
  WHERE d.portal_file_id=ANY($1::uuid[]) AND hits.matched>0
 ), pages AS (
  SELECT *,row_number() OVER(PARTITION BY portal_file_id,page ORDER BY score DESC,id) page_rank FROM scored
 ) SELECT id,page,content,title,portal_file_id,material_id,version,score FROM pages WHERE page_rank=1 ORDER BY score DESC,id LIMIT 8`;
 return (await db.query(sql,[allowed,terms,terms.map(x=>x+':*').join(' | ')])).rows;
}
