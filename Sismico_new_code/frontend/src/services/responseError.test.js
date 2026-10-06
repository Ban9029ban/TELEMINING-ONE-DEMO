import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responseErrorMessage } from './responseError.js';
test('502 HTML is replaced with a readable message', async () => {
 const message = await responseErrorMessage(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
 assert.ok(message.includes('temporalmente')); assert.ok(!message.includes('<html>'));
});
test('validation detail is preserved', async () => {
 assert.equal(await responseErrorMessage(new Response(JSON.stringify({detail:'Selecciona un sitio'}),{status:400})), 'Selecciona un sitio');
});
test('HTML in a JSON detail is not displayed', async () => {
 assert.ok(!(await responseErrorMessage(new Response(JSON.stringify({detail:'<html>Error</html>'}),{status:400}))).includes('<html>'));
});
