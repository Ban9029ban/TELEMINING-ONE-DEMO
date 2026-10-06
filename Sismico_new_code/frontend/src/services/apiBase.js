const hostname = window.location.hostname || 'localhost';
const protocol = window.location.protocol || 'http:';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() ||
  `${protocol}//${hostname}:18000`;

export const API_ROOT = API_BASE_URL;