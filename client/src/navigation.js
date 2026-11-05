import {useEffect} from 'react';
export function currentRoute(){const [path,query='']=location.hash.replace(/^#/,'').split('?');const [page,focus='']=path.split('/');return {page:page||'home',focus,date:new URLSearchParams(query).get('date')};}
export function useDeepFocus(ready,locationKey=''){
 useEffect(()=>{const {focus}=currentRoute();if(!focus)return;const el=document.getElementById(focus);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('is-target');}},[ready,locationKey]);
}
