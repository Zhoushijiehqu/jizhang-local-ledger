import { useEffect, useState } from 'react';
import { useApp } from '../state/app';
export function MacShortcuts() {
  const {toast} = useApp();
  const [tray, setTray] = useState(false);
  const [shortcut, setShortcut] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.ledgerDesktop?.shortcuts().then(settings => {setTray(settings.tray);setShortcut(settings.shortcut);}).catch(error => toast(String(error))); }, []);
  if (!window.ledgerDesktop) return null;
  return <section className="card"><div className="card-head"><span className="card-title">Mac 快速入口</span></div>
    <label className="row"><input type="checkbox" checked={tray} onChange={event => setTray(event.target.checked)} />在菜单栏显示 ￥ 记账入口</label>
    <label className="shortcut-field">全局快捷键<input placeholder="点击后按下快捷键，留空关闭" value={shortcut.replace('CommandOrControl','⌘').replace('Shift','⇧').replace('Alt','⌥').replace('Control','⌃').replace('Space','空格')} readOnly onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (event.key === 'Backspace' || event.key === 'Delete') {setShortcut(''); return;}
      if (['Meta','Control','Shift','Alt','Escape','Tab'].includes(event.key)) return;
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {toast('请搭配 Command、Control 或 Option 键');return;}
      const modifiers = [event.metaKey ? 'CommandOrControl' : '', event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
      setShortcut([...modifiers, event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key].join('+'));
    }} /></label>
    <div className="row"><button className="btn" onClick={() => setShortcut('CommandOrControl+Shift+Space')}>用 ⇧⌘ 空格</button><button className="btn" onClick={() => setShortcut('')}>关闭快捷键</button><button className="btn primary" disabled={busy} onClick={async () => {
      setBusy(true);try {await window.ledgerDesktop!.shortcuts({tray, shortcut});toast('快速入口已保存');}catch(error){toast((error as Error).message);}finally{setBusy(false);}
    }}>保存入口设置</button></div>
    <p className="hint">程序运行时，在其他应用中也能呼出记账小窗，保存后自动收起。菜单栏入口和快捷键可各自关闭。</p>
  </section>;
}
