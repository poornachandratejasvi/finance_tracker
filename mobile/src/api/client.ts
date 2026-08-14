import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import * as SecureStore from "expo-secure-store";

import { TokenResponse } from "../types";

const KEYS = {
  serverUrl: "ft_server_url",
  accessToken: "ft_access_token",
  refreshToken: "ft_refresh_token",
} as const;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export const api = axios.create();

export async function setServerUrl(url: string): Promise<void> {
  const clean = normalizeUrl(url);
  api.defaults.baseURL = clean;
  await SecureStore.setItemAsync(KEYS.serverUrl, clean);
}

export async function getServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.serverUrl);
}

export async function setTokens(accessToken: string, refreshToken?: string): Promise<void> {
  api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
  await SecureStore.setItemAsync(KEYS.accessToken, accessToken);
  if (refreshToken) {
    await SecureStore.setItemAsync(KEYS.refreshToken, refreshToken);
  }
}

async function getTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(KEYS.accessToken),
    SecureStore.getItemAsync(KEYS.refreshToken),
  ]);
  return { accessToken, refreshToken };
}

export async function clearSession(): Promise<void> {
  delete api.defaults.headers.common.Authorization;
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.accessToken),
    SecureStore.deleteItemAsync(KEYS.refreshToken),
  ]);
}

/** Full reset (Settings > Personal data & privacy) -- also forgets the saved server URL,
 * unlike a plain logout which keeps it prefilled for convenience. */
export async function clearAllLocalData(): Promise<void> {
  await clearSession();
  await SecureStore.deleteItemAsync(KEYS.serverUrl);
}

/** Load a previously-saved server URL + access token into the shared axios instance.
 * Returns true if a session was restored (caller should still expect the first request
 * to 401-refresh transparently if the access token has since expired). */
export async function restoreSession(): Promise<boolean> {
  const serverUrl = await getServerUrl();
  if (!serverUrl) return false;
  api.defaults.baseURL = serverUrl;

  const { accessToken, refreshToken } = await getTokens();
  if (!accessToken || !refreshToken) return false;

  api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
  return true;
}

// Serialize concurrent refreshes so a burst of 401s only hits /auth/refresh once,
// mirroring the web app's frontend/src/services/api.js interceptor.
let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

function flushQueue(error: unknown, token: string | null) {
  refreshQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token as string)));
  refreshQueue = [];
}

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetryableConfig | undefined;

    if (error.response?.status !== 401 || !original || original._retry) {
      return Promise.reject(error);
    }

    const { refreshToken } = await getTokens();
    if (!refreshToken) {
      await clearSession();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        original._retry = true;
        return api(original);
      });
    }

    original._retry = true;
    isRefreshing = true;
    try {
      const { data } = await axios.post<{ access_token: string }>(
        `${api.defaults.baseURL}/api/auth/refresh`,
        { refresh_token: refreshToken }
      );
      await setTokens(data.access_token);
      flushQueue(null, data.access_token);
      original.headers.Authorization = `Bearer ${data.access_token}`;
      return api(original);
    } catch (refreshError) {
      flushQueue(refreshError, null);
      await clearSession();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  }
);

export async function loginRequest(
  serverUrl: string,
  username: string,
  password: string
): Promise<TokenResponse> {
  await setServerUrl(serverUrl);
  const params = new URLSearchParams();
  params.append("username", username);
  params.append("password", password);

  // FastAPI's OAuth2PasswordRequestForm requires application/x-www-form-urlencoded,
  // not JSON — axios sets that content-type automatically for a URLSearchParams body.
  const { data } = await axios.post<TokenResponse>(`${api.defaults.baseURL}/api/auth/login`, params);
  await setTokens(data.access_token, data.refresh_token);
  return data;
}
