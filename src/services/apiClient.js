import { auth } from "../config/firebase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

const getAuthHeader = async () => {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  return `Bearer ${token}`;
};

const buildUrl = (path) => {
  if (/^https?:\/\//i.test(path)) return path;
  const base = API_BASE_URL.replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tail}`;
};

export const apiFetch = async (path, options = {}) => {
  const { auth: requireAuth = false, headers = {}, ...rest } = options;
  const finalHeaders = { ...headers };

  if (requireAuth) {
    const authHeader = await getAuthHeader();
    if (!authHeader) {
      throw new Error("You must be signed in to perform this action.");
    }
    finalHeaders.Authorization = authHeader;
  }

  return fetch(buildUrl(path), { ...rest, headers: finalHeaders });
};

export const apiJson = async (path, body, options = {}) => {
  const { method = "POST", auth: requireAuth = false, headers = {}, ...rest } = options;
  return apiFetch(path, {
    ...rest,
    method,
    auth: requireAuth,
    headers: { "Content-Type": "application/json", ...headers },
    body: body == null ? undefined : JSON.stringify(body),
  });
};

export { API_BASE_URL };
