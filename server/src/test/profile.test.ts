import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { decodeAvatar } from '../auth/avatar.js';
import { Store } from '../db/store.js';
import { createPukerServer } from '../server.js';

// JPEG real de 2 × 2 píxeles, generado para esta prueba.
const jpeg = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8rZ55LmaSaaRpZZGLvI7EszE5JJPUmiiis6fwL0OvF/7xU/xP8z//2Q==';
const photo = `data:image/jpeg;base64,${jpeg}`;

test('perfil: valida entradas, modifica solo la propia cuenta y sirve la foto autenticada', async () => {
  const server = createPukerServer({ databaseFile: ':memory:', clientDist: false });
  const url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`;
  try {
    const response = await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'perfil', password: 'claveDePrueba123' }) });
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!;
    const other = server.store.createUser({ username: 'otro', displayName: 'Otro' });
    const patch = (body: unknown, session = cookie) => fetch(url + '/api/auth/profile', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: session }, body: JSON.stringify(body) });
    assert.equal((await patch({ displayName: 'Anonimo' }, '')).status, 401);
    for (const body of [[], { displayName: 3 }, { bio: 'a'.repeat(161) }, { transferAlias: 'con espacios' }, { avatarDataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' }, { avatarDataUrl: 'data:image/jpeg;base64,aG9sYQ==' }]) {
      assert.equal((await patch(body)).status, 400);
    }
    const updated = await patch({ id: other.id, displayName: 'Nuevo', bio: ' Poker con amigos ', transferAlias: ' mi.alias ', avatarDataUrl: photo });
    assert.equal(updated.status, 200);
    const { user } = await updated.json() as { user: { id: number; avatarUrl: string; bio: string; transferAlias: string } };
    assert.equal(user.id, 1);
    assert.equal(user.bio, 'Poker con amigos');
    assert.equal(user.transferAlias, 'mi.alias');
    assert.equal(server.store.findUserById(other.id)!.display_name, 'Otro');
    assert.equal((await fetch(url + user.avatarUrl)).status, 401);
    const image = await fetch(url + user.avatarUrl, { headers: { cookie } });
    assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(jpeg, 'base64'));
    await patch({ displayName: 'Otro nombre' });
    assert.equal(server.store.findUserById(1)!.avatar_url, user.avatarUrl, 'editar texto conserva la foto');
    await patch({ avatarDataUrl: null, transferAlias: '' });
    assert.equal(server.store.findUserById(1)!.avatar_url, null);
    assert.equal(server.store.findUserById(1)!.transfer_alias, null);
    assert.equal((await fetch(url + user.avatarUrl, { headers: { cookie } })).status, 404);
  } finally { await server.close(); }
});

test('avatar: rechaza archivos grandes y dimensiones excesivas', () => {
  assert.throws(() => decodeAvatar('data:image/jpeg;base64,' + 'A'.repeat(270001)));
  const oversized = Buffer.from(jpeg, 'base64');
  const frame = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  oversized.writeUInt16BE(513, frame + 5);
  assert.throws(() => decodeAvatar(`data:image/jpeg;base64,${oversized.toString('base64')}`), /512/);
});

test('foto, descripción y alias sobreviven al reabrir la base', () => {
  const directory = mkdtempSync(join(tmpdir(), 'puker-profile-'));
  const file = join(directory, 'profile.db');
  let store: Store | null = null;
  try {
    store = new Store(file);
    const user = store.createUser({ username: 'perfil', displayName: 'Perfil' });
    const saved = store.updateProfile(user.id, { displayName: 'Amigo', bio: 'Hola', transferAlias: 'amigo.alias', avatar: decodeAvatar(photo) });
    store.close(); store = new Store(file);
    assert.deepEqual(store.findUserById(user.id), saved);
    assert.deepEqual(Buffer.from(store.avatarFor(user.id, saved.avatar_url!.split('/').at(-1)!)!), Buffer.from(jpeg, 'base64'));
  } finally {
    store?.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
    rmdirSync(directory);
  }
});
