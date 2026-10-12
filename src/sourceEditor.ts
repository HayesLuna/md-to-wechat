// Measure visual lines using the textarea's typography, including soft wrapping.
// This runs only when navigating the outline, never while typing.
export function revealSourcePosition(textarea:HTMLTextAreaElement,position:number) {
 const style=getComputedStyle(textarea);const mirror=document.createElement('div');
 for(const property of ['font-family','font-size','font-weight','font-style','line-height','letter-spacing','padding','tab-size','white-space','overflow-wrap'])mirror.style.setProperty(property,style.getPropertyValue(property));
 Object.assign(mirror.style,{position:'fixed',top:'0',left:'0',width:`${textarea.clientWidth}px`,boxSizing:'border-box',visibility:'hidden',pointerEvents:'none'});
 const marker=document.createElement('span');marker.textContent=textarea.value[position]||'\u200b';
 mirror.append(document.createTextNode(textarea.value.slice(0,position)),marker);document.body.append(mirror);
 try{textarea.focus();textarea.setSelectionRange(position,position);textarea.scrollTop=Math.max(0,marker.offsetTop-80);}
 finally{mirror.remove();}
}
