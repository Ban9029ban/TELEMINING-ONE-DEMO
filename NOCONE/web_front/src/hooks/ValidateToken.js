
export function handleAuthError(error, navigate) {
  if (error.response && error.response.status === 401) {
    localStorage.removeItem('token');
    navigate('/login'); // o window.location.href = '/login';
  }
}