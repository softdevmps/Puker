import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeChat } from '../format.js';

test('el chat limpia caracteres de control y espacios de más', () => {
  assert.equal(sanitizeChat('  hola \u0007mesa  '), 'hola mesa');
  assert.equal(sanitizeChat('   '), '');
});

test('un emoji no se parte al medio al recortar el mensaje', () => {
  // 239 letras y un emoji justo en el borde: cortar en 240 dejaría media letra
  // suelta, que se ve como un rombo con un signo de pregunta.
  const texto = 'a'.repeat(239) + '😂';
  const recortado = sanitizeChat(texto);

  assert.equal(recortado.length, 239, 'se saca el emoji entero, no la mitad');
  assert.ok(!/[\uD800-\uDFFF]/.test(recortado), 'no queda ninguna mitad de emoji');
  assert.equal(recortado, 'a'.repeat(239));
});

test('un emoji que entra completo se conserva', () => {
  const texto = 'a'.repeat(238) + '😂';
  assert.equal(sanitizeChat(texto).length, 240, 'el emoji ocupa dos y entra justo');
  assert.ok(sanitizeChat(texto).endsWith('😂'));
});

test('un mensaje de puros emojis pasa entero', () => {
  assert.equal(sanitizeChat('🃏♠️🔥'), '🃏♠️🔥');
});
