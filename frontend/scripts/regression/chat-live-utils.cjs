const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DEFAULT_BASE = 'https://testnet.ai-space.xyz';

function loadEnvLocal() {
  const envPath = path.resolve(__dirname, '../../.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function requireEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function login({ baseUrl = env('TESTNET_BASE_URL', DEFAULT_BASE), email = env('TESTNET_EMAIL'), password = env('TESTNET_PASSWORD') } = {}) {
  if (!email || !password) throw new Error('Missing TESTNET_EMAIL or TESTNET_PASSWORD');
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`login ${res.status}: ${text}`);
  const data = text ? JSON.parse(text) : {};
  const setCookie = res.headers.get('set-cookie') || '';
  const sessionMatch = setCookie.match(/ai_space_session=([^;,]+)/);
  const refreshMatch = setCookie.match(/ai_space_refresh_token=([^;,]+)/);
  return { ...data, sessionToken: sessionMatch?.[1] || '', refreshToken: refreshMatch?.[1] || '' };
}

async function apiGet(path, token, { baseUrl = env('TESTNET_BASE_URL', DEFAULT_BASE) } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return data;
}

async function openAuthedPage({ baseUrl = env('TESTNET_BASE_URL', DEFAULT_BASE), token, user, sessionToken = '', refreshToken = '', viewport = { width: 1440, height: 1000 } }) {
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const context = await browser.newContext({ viewport });
  const cookies = [];
  if (sessionToken) {
    cookies.push({ name: 'ai_space_session', value: sessionToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
  }
  if (refreshToken) {
    cookies.push({ name: 'ai_space_refresh_token', value: refreshToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' });
  }
  if (cookies.length) {
    await context.addCookies(cookies);
  }
  const page = await context.newPage();
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    if (user?.default_workspace_id) localStorage.setItem('current-workspace', String(user.default_workspace_id));
  }, { token, user });
  return { browser, page, context, baseUrl };
}

function summarizeConsole(events) {
  return (events || []).filter((item) => item.type === 'error' || item.type === 'warning').slice(-10);
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

module.exports = {
  DEFAULT_BASE,
  env,
  requireEnv,
  login,
  apiGet,
  openAuthedPage,
  summarizeConsole,
  printResult,
};
