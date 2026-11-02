import { useState } from 'react';

async function copyText(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  } catch { /* En HTTP o con permisos denegados se prueba la selección tradicional. */ }
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement('textarea');
  input.value = value;
  input.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(input);
  input.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copiá el alias seleccionando el texto.');
  } finally { input.remove(); previous?.focus(); }
}

export function AliasCopy({ alias, label = 'Alias de transferencia' }: { alias?: string | null; label?: string }) {
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async () => {
    if (!alias) return;
    try { await copyText(alias); setCopied(alias); setMessage(''); }
    catch { setMessage('No se pudo copiar. Podés seleccionar el alias y copiarlo manualmente.'); }
  };
  return <div className="alias-copy">
    <span className="field__label">{label}</span>
    {alias ? <>
      <div className="alias-copy__row"><code>{alias}</code><button type="button" className="btn btn--small btn--ghost" onClick={() => void copy()}>Copiar alias</button></div>
      <small role="status">{message || (copied === alias ? 'Alias copiado' : '')}</small>
    </> : <small>Todavía no cargó un alias.</small>}
  </div>;
}
