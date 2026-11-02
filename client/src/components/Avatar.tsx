import { useEffect, useState } from 'react';

export function Avatar({ src, name, large = false }: { src?: string | null; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return <span className={`avatar${large ? ' avatar--large' : ''}`}>
    {src && !failed ? <img src={src} alt={`Foto de ${name}`} onError={() => setFailed(true)} />
      : <span aria-label={`Avatar de ${name}`}>{Array.from(name.trim())[0]?.toUpperCase() || '?'}</span>}
  </span>;
}
