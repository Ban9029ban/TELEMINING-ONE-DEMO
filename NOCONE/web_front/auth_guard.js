function getToken() { return localStorage.getItem('access_token'); }
async function apiGet(path) {
  const t = getToken();
  const res = await fetch(window.API_BASE + path, { headers: { 'Authorization': 'Bearer ' + t }});
  if (res.status === 401) {
    window.location.href = '/login/index.html';
    return null;
  }
  return res.json();
}
document.addEventListener('DOMContentLoaded', () => {
  // If used on protected pages, redirect if no token
  if (!getToken() && location.pathname.includes('/home')) {
    window.location.href = '/login/index.html';
  }
});