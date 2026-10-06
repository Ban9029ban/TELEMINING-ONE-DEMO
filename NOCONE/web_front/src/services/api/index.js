// src/services/api/index.js
import axios from "axios";
import { API_URL } from "../../api-config";

const api = axios.create({
  baseURL: API_URL
});

export default api;