import { useEffect, useRef, useState, type FormEvent } from 'react';
import { sanitizeName, type AuthUser, type ProfileUpdate } from '@puker/shared';
import { AliasCopy } from './AliasCopy';
import { Avatar } from './Avatar';

/** Recorta al centro y reduce la foto antes de enviarla; no conserva metadatos. */
async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Elegí una foto JPG, PNG o WebP.');
  if (file.size > 5 * 1024 * 1024) throw new Error('La foto debe pesar como máximo 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { throw new Error('No se pudo leer la imagen. Elegí otra foto.'); }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo preparar la foto.');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = '#182d29';
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

export function Profile({ user, onSave, onClose }: {
  user: AuthUser;
  onSave(profile: ProfileUpdate): Promise<void>;
  onClose(): void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [bio, setBio] = useState(user.bio);
  const [alias, setAlias] = useState(user.transferAlias ?? '');
  const [avatar, setAvatar] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const locked = busy || processing;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    form.current?.querySelector<HTMLInputElement>('#profile-name')?.focus();
    return () => previous?.focus();
  }, []);
  const selectPhoto = async (file?: File) => {
    if (!file) return;
    setProcessing(true); setError(''); setSaved(false);
    try { setAvatar(await preparePhoto(file)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo leer la foto.'); }
    finally { setProcessing(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      await onSave({ displayName, bio, transferAlias: alias, ...(avatar !== undefined ? { avatarDataUrl: avatar } : {}) });
      setDisplayName(sanitizeName(displayName)); setBio(bio.trim()); setAlias(alias.trim());
      setAvatar(undefined); setSaved(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo guardar el perfil.'); }
    finally { setBusy(false); }
  };
  return <div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && !locked) onClose();
    if (event.key === 'Tab') {
      const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className="modal__backdrop" onClick={() => { if (!locked) onClose(); }} />
    <div className="modal__card">
      <header className="modal__head"><h2 id="profile-title">Mi perfil</h2><button type="button" className="btn btn--icon" aria-label="Cerrar perfil" disabled={locked} onClick={onClose}>×</button></header>
      <form ref={form} className="profile-form" onSubmit={(event) => void submit(event)} onChange={() => setSaved(false)}>
        <div className="modal__body profile-fields">
        <div className="profile-photo">
          <Avatar src={avatar === undefined ? user.avatarUrl : avatar} name={displayName} large />
          <div><span className="field__label">Foto de perfil</span>
            <input ref={photoInput} type="file" hidden accept="image/jpeg,image/png,image/webp" disabled={locked} aria-label="Elegir foto de perfil" onChange={(event) => { void selectPhoto(event.target.files?.[0]); event.target.value = ''; }} />
            <button type="button" className="btn btn--small btn--ghost" disabled={locked} onClick={() => photoInput.current?.click()}>Elegir foto</button>
            <small>JPG, PNG o WebP, hasta 5 MB.</small>
            {(avatar === undefined ? user.avatarUrl : avatar) ? <button className="btn btn--small btn--ghost" type="button" disabled={locked} onClick={() => { setAvatar(null); setSaved(false); }}>Quitar foto</button> : null}
          </div>
        </div>
        <p className="profile-account">@{user.username} · Desde {new Date(user.createdAt).toLocaleDateString('es-AR')}</p>
        <label className="field" htmlFor="profile-name"><span className="field__label">Nombre en la mesa</span><input id="profile-name" className="field__input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={2} maxLength={16} disabled={locked} autoComplete="nickname" /></label>
        <label className="field" htmlFor="profile-bio"><span className="field__label">Sobre mí <small>(opcional)</small></span><textarea id="profile-bio" className="field__input" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} rows={2} disabled={locked} placeholder="Algo breve sobre vos" /></label>
        <label className="field" htmlFor="profile-alias"><span className="field__label">Alias de transferencia <small>(opcional)</small></span><input id="profile-alias" className="field__input" value={alias} onChange={(event) => setAlias(event.target.value)} maxLength={100} disabled={locked} autoCapitalize="none" autoCorrect="off" spellCheck={false} /><small className="field__hint">Tu alias del banco o de la billetera. Aparece en el reparto final para que te puedan transferir.</small></label>
        {user.transferAlias ? <AliasCopy alias={user.transferAlias} label="Alias guardado" /> : null}
        </div>
        <footer className="profile-footer">
        {error ? <p className="profile-error" role="alert">{error}</p> : null}
        <p className="profile-status" role="status">{processing ? 'Preparando foto…' : saved ? 'Perfil guardado' : ''}</p>
        <button className="btn btn--primary btn--wide" type="submit" disabled={locked}>{busy ? 'Guardando…' : 'Guardar perfil'}</button>
        </footer>
      </form>
    </div>
  </div>;
}
