import type { Settings } from './sample';
export function SettingsPanel({settings:s,onChange}:{settings:Settings;onChange:(s:Settings)=>void}) {
 const change=(key:keyof Settings,value:unknown)=>onChange({...s,[key]:value});
 return <div className="settings-panel">
  <div className="setting-row"><span>主题风格</span><div className="theme-options">{(['default','simple','elegant'] as const).map((theme,i)=><button key={theme} className={s.theme===theme?'selected':''} onClick={()=>change('theme',theme)}>{['默认','简约','雅致'][i]}</button>)}</div></div>
  <div className="setting-row"><label htmlFor="theme-color">主题色</label><div className="color-options">{['#a6493d','#303030','#6f7480','#8b7765'].map(c=><button key={c} aria-label={'使用主题色 '+c} className={c===s.color?'selected':''} style={{background:c}} onClick={()=>change('color',c)}/>)}<input id="theme-color" aria-label="自定义主题色" type="color" value={s.color} onChange={e=>change('color',e.target.value)}/></div></div>
  <div className="setting-row"><label htmlFor="font-size">正文字号</label><input id="font-size" type="range" min="14" max="20" value={s.fontSize} onChange={e=>change('fontSize',Number(e.target.value))}/><output>{s.fontSize}px</output></div>
  <div className="setting-row"><label htmlFor="line-height">行距</label><input id="line-height" type="range" min="1.5" max="2.3" step="0.05" value={s.lineHeight} onChange={e=>change('lineHeight',Number(e.target.value))}/><output>{s.lineHeight.toFixed(2)}</output></div>
  <div className="setting-row"><span>代码配色</span><div className="code-themes">{(['light','dark'] as const).map((v,i)=><button key={v} className={s.codeTheme===v?'selected':''} onClick={()=>change('codeTheme',v)}>{['浅色','深色'][i]}</button>)}</div></div>
 </div>;
}
