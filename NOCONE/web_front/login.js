// Requires config.js
async function doLogin(evt) {
  evt && evt.preventDefault();
  const email = document.querySelector('#email').value;
  const password = document.querySelector('#password').value;
  const res = await fetch(window.API_BASE + '/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email, password})
  });
  if (!res.ok) {
    alert('Credenciales inválidas');
    return;
  }
  const data = await res.json();
  localStorage.setItem('access_token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  window.location.href = '/home/index.html';
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form');
  if (form) form.addEventListener('submit', doLogin);
});