import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
export function Dialog({title,children,onClose,drawer=false}:{title:string;children:React.ReactNode;onClose:()=>void;drawer?:boolean}) {
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const focused=document.activeElement as HTMLElement;const el=ref.current!;el.querySelector<HTMLElement>('input,button,textarea')?.focus();
 const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const items=Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],textarea,select'));const i=items.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&i<=0){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&i===items.length-1){e.preventDefault();items[0]?.focus();}};
 el.addEventListener('keydown',trap);return()=>{el.removeEventListener('keydown',trap);if(focused?.isConnected)focused.focus();};},[]);
 return <div className={`dialog-backdrop ${drawer?'drawer-backdrop':''}`} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={`dialog ${drawer?'draft-drawer':''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button title="关闭弹窗" onClick={onClose}><X size={19}/></button></header>{children}</div></div>;
}
