const { chromium } = require('playwright');

const DEFAULT_BASE = 'https://testnet.ai-space.xyz';

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
  const refreshMatch = setCookie.match(/ai_space_refresh_token=([^;,]+)/);
  return { ...data, refreshToken: refreshMatch?.[1] || '' };
}

async function apiGet(path, token, { baseUrl = env('TESTNET_BASE_URL', DEFAULT_BASE) } = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return data;
}

async function openAuthedPage({ baseUrl = env('TESTNET_BASE_URL', DEFAULT_BASE), token, user, refreshToken = '', viewport = { width: 1440, height: 1000 } }) {
  const browser = await chromium.launch({ headless: env('HEADFUL') !== '1' });
  const context = await browser.newContext({ viewport });
  if (refreshToken) {
    await context.addCookies([{ name: 'ai_space_refresh_token', value: refreshToken, domain: new URL(baseUrl).hostname, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
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
