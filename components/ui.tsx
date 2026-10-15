'use client';
import {useEffect,useId,useRef} from 'react';
import {X,Inbox,Info} from 'lucide-react';
export function Badge({children,kind='neutral'}:{children:React.ReactNode;kind?:string}){return <span className={'badge '+kind}><i className="badge-dot"/>{children}</span>;}
export function Meter({value,target,kind='gold'}:{value:number|null;target:number|null;kind?:string}){const pct=value==null||target==null||target<=0?0:Math.max(0,Math.min(100,value/target*100));return <div className={'meter '+kind}><i style={{width:pct+'%'}}/></div>;}
export function Empty({text='لا توجد سجلات في هذه المساحة بعد.',detail}:{text?:string;detail?:string}){return <div className="system-empty"><Inbox size={31}/><strong>{text}</strong>{detail&&<p>{detail}</p>}</div>;}
export function Notice({children,kind='gold'}:{children:React.ReactNode;kind?:string}){return <div className={'notice '+kind}><Info className="icon"/><p>{children}</p></div>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);const id=useId();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const node=ref.current;node?.showModal();return()=>{node?.close();if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} className={'detail-dialog'+(wide?' wide-dialog':'')} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target!==ref.current)return;const r=ref.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}>
  <header className="dialog-header"><div><div className="eyebrow" dir="ltr">CHICO ADMINS · GENERAL TEAM</div><h2 id={id}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="إغلاق النافذة"><X className="icon"/></button></header><div className="dialog-body">{children}</div>
 </dialog>;
}
export interface Field {name:string;label:string;type?:'text'|'number'|'date'|'datetime-local'|'textarea'|'checkbox'|'password'|'select';options?:{value:string;label:string}[];value?:string|number|boolean|null;required?:boolean;disabled?:boolean;min?:number|string;max?:number|string;step?:number|string;hint?:string;dir?:'ltr'|'rtl';}
export function FormFields({fields}:{fields:Field[]}){const prefix=useId();return <div className="system-form-grid">{fields.map(field=>{const id=prefix+'-'+field.name;const shared={id,name:field.name,required:field.required??field.type!=='checkbox',disabled:field.disabled??false,defaultValue:field.value==null?undefined:String(field.value)};
 if(field.type==='checkbox')return <label className="checkbox-row system-full" key={field.name}><input name={field.name} type="checkbox" defaultChecked={field.value===true}/>{field.label}</label>;
 return <label key={field.name} className={'system-field'+(field.type==='textarea'?' system-full':'')} htmlFor={id}><span>{field.label}</span>{field.type==='select'?<select {...shared}>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:field.type==='textarea'?<textarea {...shared} rows={3} maxLength={1000}/>:<input {...shared} type={field.type??'text'} min={field.min} max={field.max} step={field.step} maxLength={field.type==='number'?undefined:field.type==='password'?128:500} dir={field.dir??(field.type==='number'||field.type==='datetime-local'||field.type==='date'?'ltr':undefined)}/>} {field.hint&&<small>{field.hint}</small>}</label>;
 })}</div>;}
export function safeUrl(value:string):string|null{try{const u=new URL(value);return u.protocol==='https:'||u.protocol==='http:'?u.toString():null;}catch{return null;}}
export function DateText({value,time=true}:{value:string;time?:boolean}){const d=new Date(value);return <span>{Number.isFinite(+d)?new Intl.DateTimeFormat('ar-EG',{timeZone:'Asia/Riyadh',day:'numeric',month:'short',...(time?{hour:'2-digit',minute:'2-digit',hour12:true}:{})}).format(d):'لم يُحدد'}</span>;}
export function localDateTime(value:string|Date=new Date()):string{const date=new Date(value);return new Date(+date+3*3600000).toISOString().slice(0,16);}
