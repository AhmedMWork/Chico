'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {DataBundle,Notification} from '@/lib/domain/types';
export function useDashboardData(initial:DataBundle,preview:boolean){
 const [data,setData]=useState(initial),[period,setPeriod]=useState(initial.period),[refreshing,setRefreshing]=useState(false),[loadError,setLoadError]=useState('');
 const [updatedAt,setUpdatedAt]=useState(initial.fetched_at??new Date().toISOString());
 const request=useRef<{id:number;controller?:AbortController}>({id:0});
 const refresh=useCallback(async(selected=period)=>{
  if(preview)return;request.current.controller?.abort();const controller=new AbortController(),id=++request.current.id;request.current.controller=controller;
  setRefreshing(true);setLoadError('');
  try{const r=await fetch('/api/dashboard?period='+encodeURIComponent(selected),{cache:'no-store',signal:controller.signal});const result=await r.json() as DataBundle&{error?:string};
   if(id!==request.current.id)return;if(r.status===401){window.location.assign('/');return;}if(!r.ok)throw new Error(result.error??'تعذر تحديث البيانات');
   setData(result);setPeriod(result.period);setUpdatedAt(result.fetched_at??new Date().toISOString());
   const url=new URL(window.location.href);url.searchParams.set('period',result.period);window.history.replaceState(null,'',url);
  }catch(error){if(!controller.signal.aborted&&id===request.current.id)setLoadError(error instanceof Error?error.message:'تعذر الاتصال؛ آخر بيانات ناجحة ما زالت ظاهرة.');}
  finally{if(id===request.current.id)setRefreshing(false);}
 },[period,preview]);
 useEffect(()=>()=>{request.current.controller?.abort();},[]);
 useEffect(()=>{if(preview)return;const desired=new URL(window.location.href).searchParams.get('period');if(desired&&/^\d{4}-\d{2}-\d{2}$/.test(desired)&&desired!==initial.period)void refresh(desired);},[]);
 useEffect(()=>{if(preview)return;const sync=()=>{const desired=new URL(window.location.href).searchParams.get('period');if(desired&&/^\d{4}-\d{2}-\d{2}$/.test(desired)&&desired!==period)void refresh(desired);};window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[period,preview,refresh]);
 useEffect(()=>{if(preview)return;let pending=false,disposed=false;const controller=new AbortController();async function poll(){if(pending||document.visibilityState!=='visible')return;pending=true;try{const r=await fetch('/api/notifications',{cache:'no-store',signal:controller.signal});if([401,403].includes(r.status)){window.location.assign('/');return;}if(!r.ok)return;const result=await r.json() as {rows:Notification[];unread_count:number;can_manage:boolean};if(!disposed)setData(old=>({...old,notifications:result.rows,unread_notifications:result.unread_count,notifications_can_manage:result.can_manage}));}catch{}finally{pending=false;}}const timer=setInterval(()=>void poll(),15000);const focus=()=>void poll();window.addEventListener('focus',focus);return()=>{disposed=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',focus);};},[preview]);
 return {data,period,refreshing,refresh,loadError,updatedAt};
}
