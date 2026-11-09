/* Kira clone — personal AI assistant app (local build, inspired by the Kira app UI).
   All data lives in localStorage (keys prefixed kira_). AI chat uses the user's
   own free Gemini API key. Real booking / payment / phone calls are NOT possible
   from an app alone — those modules plan and save locally and say so honestly.
   Google sign-in below is REAL OAuth (PKCE, Web application client) — it needs
   a Google Cloud OAuth client ID + client secret (see GOOGLE_CLIENT_ID_DEFAULT
   and GOOGLE_CLIENT_SECRET_DEFAULT). The secret is injected at build time from
   the GOOGLE_CLIENT_SECRET repo secret and never committed. */
import { Browser } from '@capacitor/browser';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return d; } };

/* ---------- storage ---------- */
function load(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v === null ? fallback : v; }
  catch { return fallback; }
}
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
const store = {
  get(key, fb) { return load('kira_' + key, fb); },
  set(key, v) { save('kira_' + key, v); },
  del(key) { try { localStorage.removeItem('kira_' + key); } catch {} },
};

/* ---------- Gemini (free key, with model fallback) ---------- */
const MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];
// NOTE: the old 2.0 Flash model is retired — it is never used anywhere in this app.
const GEMINI_KEY = () => store.get('gemini_key', '');
const GEMINI_MODEL = () => store.get('gemini_model', '') || MODELS[0];

async function callGemini(prompt, system = '') {
  const key = GEMINI_KEY();
  if (!key) throw new Error('no-key');
  const models = [GEMINI_MODEL(), ...MODELS.filter(m => m !== GEMINI_MODEL())];
  let lastErr = null;
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_instruction: system ? { parts: [{ text: system }] } : undefined, contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      if (text.trim()) return { text: text.trim(), model };
      lastErr = new Error('empty');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('gemini-failed');
}

/* Template replies when no Gemini key is saved — honest, useful, local. */
function templateReply(text) {
  const t = text.toLowerCase();
  if (/^(hi|hello|hey|hii|আসসালামু|সালাম)/.test(t)) return 'Hello abdur! I am Kira, your personal AI assistant. I can help with your calendar, meals, travel plans, homework, shopping lists, notes and more. What would you like to do?';
  if (t.includes('time') || t.includes('date') || t.includes('সময়')) return 'Right now it is ' + new Date().toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) + '.';
  if (t.includes('agenda') || t.includes('today') || t.includes('আজ')) {
    const evs = store.get('events', []).filter(e => e.date === todayStr());
    return evs.length ? "Today's agenda:\n" + evs.map(e => '• ' + e.title + (e.time ? ' at ' + e.time : '')).join('\n') : 'Nothing scheduled today. You can add an event in Smart Calendar.';
  }
  if (t.includes('task')) { const ts = store.get('tasks', []); return ts.length ? 'Your tasks:\n' + ts.map(x => '• ' + x.title + (x.done ? ' (done)' : '')).join('\n') : 'No tasks yet. Add one in Task runner.'; }
  if (t.includes('meal') || t.includes('খাবার') || t.includes('dinner') || t.includes('lunch')) return 'For a full 7-day meal plan, open Meal Planner from the More menu. Quick idea for today: rice, dal, seasonal vegetables and chicken curry — simple, healthy Bengali food.';
  if (t.includes('travel') || t.includes('trip') || t.includes('ভ্রমণ')) return 'Open Travel Planner from the More menu, tell me the destination, days and budget, and I will build a day-wise itinerary for you.';
  if (t.includes('thank')) return "You're welcome, abdur!";
  if (t.includes('who are you') || t.includes('তুমি কে')) return 'I am Kira, your personal AI assistant — I remember your goals, people and plans, and help you get things done. Add your free Gemini API key in Settings to unlock full AI answers.';
  return 'I understood: "' + text + '". To give you a full AI answer, add your free Gemini API key in Settings (gear icon). Without a key I can still open any tool for you — try Smart Calendar, Meal Planner, Travel Planner, Homework or Image Gen from the More menu.';
}

/* ---------- Google OAuth (real sign-in, PKCE, Web application client) ----------
   HOW TO SET IT UP (one time, in Google Cloud Console):
   1. Use the existing "Kira Clone" project, configure the OAuth consent screen
      (External, Testing mode) and keep the user's Google account as a test user
      (unverified apps can only be used by test users).
   2. Credentials → Create OAuth client ID → Application type: Web application.
      Authorized redirect URI (exact):
        https://razzakar133-cell.github.io/kira-clone/oauth.html
   3. Paste the resulting client ID (…apps.googleusercontent.com) in
      Settings → Google OAuth client ID inside the app, and put the client
      secret (GOCSPX-…) in the GOOGLE_CLIENT_SECRET repo secret (GitHub →
      repo Settings → Secrets and variables → Actions). The build injects the
      secret into the app bundle; it is never committed to the repo.
   HOW SIGN-IN WORKS: Connect opens the Google sign-in page in the system
   browser; Google redirects to oauth.html (a static page on GitHub Pages)
   which shows the authorization code. The user copies that code and pastes
   it into the app's Google Sign-in screen, which exchanges it for tokens.
   Until the client ID + secret are set, Connect shows "not configured yet"
   and nothing is sent anywhere. Tokens are stored on this device only
   (kira_google_tokens). Scopes are read-only: openid, email, profile,
   gmail.readonly, drive.readonly, calendar.readonly. */
const GOOGLE_CLIENT_ID_DEFAULT = '419209461444-5sil155htgnd107qov73vssa7g4gajtb.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET_DEFAULT = '__GOOGLE_CLIENT_SECRET__';
const GOOGLE_REDIRECT_URI = 'https://razzakar133-cell.github.io/kira-clone/oauth.html';
const GOOGLE_SCOPES = ['openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'];
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_IDS = ['google', 'gmail', 'drive', 'gcal'];
const googleClientId = () => { const v = (store.get('google_client_id', '') || '').trim(); return v || GOOGLE_CLIENT_ID_DEFAULT; };
/* Secret resolution: built-in value injected at build time wins; otherwise the
   secret saved in Settings (device only); otherwise unconfigured. The built-in
   placeholder '__GOOGLE_CLIENT_SECRET__' counts as "not set". */
function resolveGoogleSecret(builtin, stored) {
  const b = (builtin || '').trim();
  if (b && b !== '__GOOGLE_CLIENT_SECRET__') return b;
  return (stored || '').trim();
}
const googleClientSecret = () => resolveGoogleSecret(GOOGLE_CLIENT_SECRET_DEFAULT, store.get('google_client_secret', ''));
const googleBuiltInSecretActive = () => { const b = (GOOGLE_CLIENT_SECRET_DEFAULT || '').trim(); return !!b && b !== '__GOOGLE_CLIENT_SECRET__'; };
const isGoogleConfigured = () => {
  const id = googleClientId();
  return !!id && id !== 'PASTE_WEB_CLIENT_ID_HERE' && !!googleClientSecret();
};
const googleTokens = () => store.get('google_tokens', null);
const isGoogleSignedIn = () => { const t = googleTokens(); return !!(t && (t.refresh_token || t.access_token)); };

/* SHA-256 (pure JS fallback — crypto.subtle is missing in some WebViews/jsdom).
   Verified against Node crypto and the RFC 7636 PKCE test vector. */
/* UTF-8 encode without depending on TextEncoder (missing in jsdom/old WebViews). */
function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c < 0xdc00) {
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(bytes);
}
/* base64url without padding, no btoa dependency. */
function base64Url(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += chars[b0 >> 2];
    out += chars[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) out += chars[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    if (b2 !== undefined) out += chars[b2 & 63];
  }
  return out;
}
function sha256Ascii(str) {
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bytes = utf8Bytes(str);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => od.setUint32(i * 4, v >>> 0));
  return out;
}
function makeVerifier() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = new Uint8Array(64);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}
async function pkceChallenge(verifier) {
  try {
    if (typeof TextEncoder !== 'undefined' && window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      return base64Url(new Uint8Array(digest));
    }
  } catch {}
  return base64Url(sha256Ascii(verifier));
}
async function buildGoogleAuthUrl() {
  const verifier = makeVerifier();
  store.set('oauth_verifier', verifier);
  const challenge = await pkceChallenge(verifier);
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  return GOOGLE_AUTH_URL + '?' + params.toString();
}
function isNativeApp() {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
}
async function startGoogleSignIn() {
  if (!isGoogleConfigured()) { toast('Google sign-in is not configured yet — paste the OAuth client ID and secret in Settings.'); return; }
  let url;
  try { url = await buildGoogleAuthUrl(); } catch { toast('Could not start Google sign-in.'); return; }
  state.googleManualUrl = url;
  // Primary flow: open the Google sign-in page in the system browser.
  // Google redirects to oauth.html, which shows the code to paste back here.
  if (isNativeApp()) {
    try { await Browser.open({ url }); } catch {}
  } else {
    try { window.open(url, '_blank'); } catch {}
  }
  openModule('google-signin');
}
function markGoogleConnected(on) {
  const con = store.get('integrations', {});
  GOOGLE_IDS.forEach(id => { if (on) con[id] = 'google'; else delete con[id]; });
  store.set('integrations', con);
}
async function exchangeGoogleCode(code) {
  const verifier = store.get('oauth_verifier', '');
  if (!verifier) throw new Error('no-verifier');
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: googleClientId(), client_secret: googleClientSecret(),
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'token-exchange-failed');
  let profile = {};
  try {
    const r = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: 'Bearer ' + data.access_token } });
    if (r.ok) profile = await r.json();
  } catch {}
  const prev = googleTokens() || {};
  store.set('google_tokens', {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prev.refresh_token || '',
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    email: profile.email || prev.email || '',
    name: profile.name || prev.name || '',
    scope: data.scope || '',
  });
  store.del('oauth_verifier');
  markGoogleConnected(true);
  return true;
}
async function refreshGoogleToken() {
  const t = googleTokens();
  if (!t || !t.refresh_token) return null;
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;
  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: googleClientId(), client_secret: googleClientSecret(), grant_type: 'refresh_token', refresh_token: t.refresh_token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) return null;
    store.set('google_tokens', { ...t, access_token: data.access_token, expires_at: Date.now() + (data.expires_in || 3600) * 1000 });
    return data.access_token;
  } catch { return null; }
}
async function googleSignOut() {
  const t = googleTokens();
  const tok = (t && (t.refresh_token || t.access_token)) || '';
  store.del('google_tokens');
  markGoogleConnected(false);
  if (tok) {
    try { await fetch(GOOGLE_REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok }) }); } catch {}
  }
  toast('Signed out of Google.');
  render();
}
/* ---------- app state ---------- */
const state = {
  tab: 'home',            // home | chats | voice | automate | more
  module: null,           // open module id (full-screen view)
  sheet: null,            // 'automate' | 'more' bottom sheet
  drawer: false,
  drawerTab: 'chat',
  persona: null,          // {name, system} for Kbots / consultants
  chatBusy: false,
  listening: false,
  chatHist: load('kira_chat_v1', []),
  stats: store.get('stats', { toolsUsed: 0, tasksRun: 0, turns: 0 }),
  voiceLang: store.get('voice_lang', 'bn-BD'),
  pinned: store.get('pinned', ['messages', 'smart-calendar', 'meal-planner']),
  googleManualUrl: '', // Google auth URL shown in the sign-in module (copy link + paste code)
  connSearch: '', // Connectors directory search text (kept across re-renders)
  connKeyFor: null, // id of the key connector whose inline API-key form is open
};
function saveChat() { save('kira_chat_v1', state.chatHist.slice(-30)); }
function saveStats() { store.set('stats', state.stats); }
function bumpTools() { state.stats.toolsUsed++; saveStats(); }
function addMemory(text, kind = 'note') {
  const mems = store.get('memories', []);
  mems.push({ id: uid(), text, kind, at: new Date().toISOString() });
  store.set('memories', mems);
}

/* ---------- shared data ---------- */
const CONSULTANTS = [
  { id: 'business', name: 'Business Consultant', icon: '💼', sys: 'You are a practical business consultant. Give short, actionable advice.' },
  { id: 'finance', name: 'Finance Consultant', icon: '💰', sys: 'You are a careful personal finance consultant. Give short, practical money advice.' },
  { id: 'health', name: 'Health Consultant', icon: '💪', sys: 'You are a friendly health coach. Give general wellness advice, never diagnose.' },
  { id: 'career', name: 'Career Consultant', icon: '🎯', sys: 'You are a career coach. Give short, practical career advice.' },
  { id: 'study', name: 'Study Consultant', icon: '📚', sys: 'You are a patient study coach. Explain clearly and simply.' },
  { id: 'tech', name: 'Tech Consultant', icon: '💻', sys: 'You are a helpful tech consultant. Explain technology simply and practically.' },
  { id: 'life', name: 'Life Consultant', icon: '🌿', sys: 'You are a warm, practical life coach. Give short, kind, useful advice.' },
];
const KBOTS = [
  { id: 'homework-bot', name: 'Homework Bot', icon: '📖', sys: 'You are Homework Bot. Explain every question step by step, simply, in Bengali or English as the user writes.' },
  { id: 'shopping-bot', name: 'Shopping Bot', icon: '🛍️', sys: 'You are Shopping Bot. Help compare products, make lists and suggest good prices.' },
  { id: 'travel-bot', name: 'Travel Bot', icon: '✈️', sys: 'You are Travel Bot. Plan trips day by day with places, food and budget tips.' },
];
const TUTORS = ['Math', 'Physics', 'Chemistry', 'Biology', 'English'];
const INTEGRATIONS = [
  { id: 'google', name: 'Google', icon: '🔍' }, { id: 'gmail', name: 'Gmail', icon: '✉️' },
  { id: 'drive', name: 'Google Drive', icon: '💾' }, { id: 'gcal', name: 'Google Calendar', icon: '📅' },
  { id: 'slack', name: 'Slack', icon: '💬' }, { id: 'notion', name: 'Notion', icon: '📝' },
  { id: 'jewel', name: 'Jewel — your personal agent', icon: '💎', link: 'https://muse.ai' },
];
const SOCIALS = [
  { id: 'linkedin', name: 'LinkedIn', cls: 'background:#e8f0fe;color:#0a66c2' },
  { id: 'instagram', name: 'Instagram', cls: 'background:#fce4ec;color:#c13584' },
  { id: 'tiktok', name: 'TikTok', cls: 'background:#e0f2f1;color:#00897b' },
  { id: 'x', name: 'X', cls: 'background:#eceff1;color:#141a33' },
];

/* ---------- Connectors directory (100 services, 10 categories) ----------
   kind: 'google' = real Google OAuth (reuses the existing sign-in flow);
   'key' = API key saved on this device only; 'link' = opens the official site.
   Connection state lives in localStorage under kira_connectors_v1 as
   { [id]: 'google' | 'key' | 'opened' }. Google entries read the live
   token state (kira_google_tokens) instead of that store. */
const CONNECTOR_CATS = [
  'Social Media ও Facebook Management',
  'AI ও Automation',
  'Office ও Productivity',
  'Design ও Video Editing',
  'Freelancing ও Online Business',
  'Communication ও Meeting',
  'File, Storage ও Document',
  'Website ও Development',
  'Marketing ও Analytics',
  'Payment ও Daily Utilities',
];
const CONNECTORS = [
  // 1. Social Media ও Facebook Management
  { id: 'facebook', name: 'Facebook', icon: '📘', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.facebook.com' },
  { id: 'facebook-messenger', name: 'Facebook Messenger', icon: '💬', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.messenger.com' },
  { id: 'instagram', name: 'Instagram', icon: '📸', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.instagram.com' },
  { id: 'whatsapp', name: 'WhatsApp', icon: '📱', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://web.whatsapp.com' },
  { id: 'youtube', name: 'YouTube', icon: '▶️', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.youtube.com' },
  { id: 'tiktok', name: 'TikTok', icon: '🎵', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.tiktok.com' },
  { id: 'linkedin', name: 'LinkedIn', icon: '💼', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.linkedin.com' },
  { id: 'x-twitter', name: 'X (Twitter)', icon: '✖️', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://x.com' },
  { id: 'pinterest', name: 'Pinterest', icon: '📌', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.pinterest.com' },
  { id: 'reddit', name: 'Reddit', icon: '🤖', cat: CONNECTOR_CATS[0], kind: 'link', url: 'https://www.reddit.com' },
  // 2. AI ও Automation
  { id: 'chatgpt', name: 'ChatGPT', icon: '🤖', cat: CONNECTOR_CATS[1], kind: 'key', url: 'https://chat.openai.com' },
  { id: 'google-gemini', name: 'Google Gemini', icon: '✨', cat: CONNECTOR_CATS[1], kind: 'google', url: 'https://aistudio.google.com' },
  { id: 'claude', name: 'Claude', icon: '🟠', cat: CONNECTOR_CATS[1], kind: 'key', url: 'https://claude.ai' },
  { id: 'microsoft-copilot', name: 'Microsoft Copilot', icon: '🪟', cat: CONNECTOR_CATS[1], kind: 'key', url: 'https://copilot.microsoft.com' },
  { id: 'perplexity', name: 'Perplexity', icon: '🔍', cat: CONNECTOR_CATS[1], kind: 'key', url: 'https://www.perplexity.ai' },
  { id: 'deepseek', name: 'DeepSeek', icon: '🐋', cat: CONNECTOR_CATS[1], kind: 'key', url: 'https://chat.deepseek.com' },
  { id: 'grok', name: 'Grok', icon: '🚀', cat: CONNECTOR_CATS[1], kind: 'key', url: 'https://grok.com' },
  { id: 'n8n', name: 'n8n', icon: '🔄', cat: CONNECTOR_CATS[1], kind: 'link', url: 'https://n8n.io' },
  { id: 'zapier', name: 'Zapier', icon: '⚡', cat: CONNECTOR_CATS[1], kind: 'link', url: 'https://zapier.com' },
  { id: 'make', name: 'Make', icon: '🛠️', cat: CONNECTOR_CATS[1], kind: 'link', url: 'https://www.make.com' },
  // 3. Office ও Productivity
  { id: 'google-drive', name: 'Google Drive', icon: '💾', cat: CONNECTOR_CATS[2], kind: 'google', url: 'https://drive.google.com' },
  { id: 'google-docs', name: 'Google Docs', icon: '📄', cat: CONNECTOR_CATS[2], kind: 'google', url: 'https://docs.google.com' },
  { id: 'google-sheets', name: 'Google Sheets', icon: '📊', cat: CONNECTOR_CATS[2], kind: 'google', url: 'https://sheets.google.com' },
  { id: 'google-slides', name: 'Google Slides', icon: '📽️', cat: CONNECTOR_CATS[2], kind: 'google', url: 'https://slides.google.com' },
  { id: 'google-calendar', name: 'Google Calendar', icon: '📅', cat: CONNECTOR_CATS[2], kind: 'google', url: 'https://calendar.google.com' },
  { id: 'gmail', name: 'Gmail', icon: '✉️', cat: CONNECTOR_CATS[2], kind: 'google', url: 'https://mail.google.com' },
  { id: 'microsoft-word', name: 'Microsoft Word', icon: '📝', cat: CONNECTOR_CATS[2], kind: 'link', url: 'https://www.office.com' },
  { id: 'microsoft-excel', name: 'Microsoft Excel', icon: '📈', cat: CONNECTOR_CATS[2], kind: 'link', url: 'https://www.office.com' },
  { id: 'microsoft-powerpoint', name: 'Microsoft PowerPoint', icon: '📊', cat: CONNECTOR_CATS[2], kind: 'link', url: 'https://www.office.com' },
  { id: 'microsoft-outlook', name: 'Microsoft Outlook', icon: '📧', cat: CONNECTOR_CATS[2], kind: 'link', url: 'https://outlook.live.com' },
  // 4. Design ও Video Editing
  { id: 'canva', name: 'Canva', icon: '🎨', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.canva.com' },
  { id: 'adobe-photoshop', name: 'Adobe Photoshop', icon: '🖼️', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.adobe.com/products/photoshop.html' },
  { id: 'adobe-illustrator', name: 'Adobe Illustrator', icon: '✏️', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.adobe.com/products/illustrator.html' },
  { id: 'adobe-premiere-pro', name: 'Adobe Premiere Pro', icon: '🎬', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.adobe.com/products/premierepro.html' },
  { id: 'capcut', name: 'CapCut', icon: '✂️', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.capcut.com' },
  { id: 'figma', name: 'Figma', icon: '🎛️', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.figma.com' },
  { id: 'adobe-express', name: 'Adobe Express', icon: '✨', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://www.adobe.com/express/' },
  { id: 'invideo', name: 'InVideo', icon: '🎥', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://invideo.io' },
  { id: 'runway', name: 'Runway', icon: '🎞️', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://runwayml.com' },
  { id: 'elevenlabs', name: 'ElevenLabs', icon: '🔊', cat: CONNECTOR_CATS[3], kind: 'link', url: 'https://elevenlabs.io' },
  // 5. Freelancing ও Online Business
  { id: 'fiverr', name: 'Fiverr', icon: '💚', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.fiverr.com' },
  { id: 'upwork', name: 'Upwork', icon: '💼', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.upwork.com' },
  { id: 'freelancer-com', name: 'Freelancer.com', icon: '👷', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.freelancer.com' },
  { id: 'peopleperhour', name: 'PeoplePerHour', icon: '⏰', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.peopleperhour.com' },
  { id: 'behance', name: 'Behance', icon: '🎨', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.behance.net' },
  { id: 'dribbble', name: 'Dribbble', icon: '🏀', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://dribbble.com' },
  { id: 'shopify', name: 'Shopify', icon: '🛍️', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.shopify.com' },
  { id: 'woocommerce', name: 'WooCommerce', icon: '🛒', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://woocommerce.com' },
  { id: 'etsy', name: 'Etsy', icon: '🧶', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://www.etsy.com' },
  { id: 'amazon-seller-central', name: 'Amazon Seller Central', icon: '📦', cat: CONNECTOR_CATS[4], kind: 'link', url: 'https://sellercentral.amazon.com' },
  // 6. Communication ও Meeting
  { id: 'zoom', name: 'Zoom', icon: '📹', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://zoom.us' },
  { id: 'google-meet', name: 'Google Meet', icon: '🎥', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://meet.google.com' },
  { id: 'microsoft-teams', name: 'Microsoft Teams', icon: '👥', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://teams.microsoft.com' },
  { id: 'slack', name: 'Slack', icon: '💬', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://slack.com' },
  { id: 'discord', name: 'Discord', icon: '🎮', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://discord.com' },
  { id: 'telegram', name: 'Telegram', icon: '✈️', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://web.telegram.org' },
  { id: 'skype', name: 'Skype', icon: '📞', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://www.skype.com' },
  { id: 'viber', name: 'Viber', icon: '📲', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://www.viber.com' },
  { id: 'wechat', name: 'WeChat', icon: '💬', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://www.wechat.com' },
  { id: 'google-voice', name: 'Google Voice', icon: '☎️', cat: CONNECTOR_CATS[5], kind: 'link', url: 'https://voice.google.com' },
  // 7. File, Storage ও Document
  { id: 'dropbox', name: 'Dropbox', icon: '📦', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://www.dropbox.com' },
  { id: 'onedrive', name: 'OneDrive', icon: '☁️', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://onedrive.live.com' },
  { id: 'box', name: 'Box', icon: '📁', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://www.box.com' },
  { id: 'notion', name: 'Notion', icon: '📝', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://www.notion.so' },
  { id: 'evernote', name: 'Evernote', icon: '🐘', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://evernote.com' },
  { id: 'obsidian', name: 'Obsidian', icon: '💎', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://obsidian.md' },
  { id: 'adobe-acrobat', name: 'Adobe Acrobat', icon: '📕', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://www.adobe.com/acrobat.html' },
  { id: 'docusign', name: 'DocuSign', icon: '✍️', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://www.docusign.com' },
  { id: 'wetransfer', name: 'WeTransfer', icon: '📤', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://wetransfer.com' },
  { id: 'google-keep', name: 'Google Keep', icon: '📌', cat: CONNECTOR_CATS[6], kind: 'link', url: 'https://keep.google.com' },
  // 8. Website ও Development
  { id: 'github', name: 'GitHub', icon: '🐙', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://github.com' },
  { id: 'gitlab', name: 'GitLab', icon: '🦊', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://gitlab.com' },
  { id: 'bitbucket', name: 'Bitbucket', icon: '🪣', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://bitbucket.org' },
  { id: 'vercel', name: 'Vercel', icon: '▲', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://vercel.com' },
  { id: 'netlify', name: 'Netlify', icon: '🌐', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://www.netlify.com' },
  { id: 'wordpress', name: 'WordPress', icon: '📰', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://wordpress.com' },
  { id: 'webflow', name: 'Webflow', icon: '🕸️', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://webflow.com' },
  { id: 'wix', name: 'Wix', icon: '🧩', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://www.wix.com' },
  { id: 'cloudflare', name: 'Cloudflare', icon: '☁️', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://www.cloudflare.com' },
  { id: 'firebase', name: 'Firebase', icon: '🔥', cat: CONNECTOR_CATS[7], kind: 'link', url: 'https://firebase.google.com' },
  // 9. Marketing ও Analytics
  { id: 'google-analytics', name: 'Google Analytics', icon: '📈', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://analytics.google.com' },
  { id: 'google-search-console', name: 'Google Search Console', icon: '🔎', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://search.google.com/search-console' },
  { id: 'google-ads', name: 'Google Ads', icon: '📢', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://ads.google.com' },
  { id: 'meta-ads-manager', name: 'Meta Ads Manager', icon: '📣', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://adsmanager.facebook.com' },
  { id: 'meta-business-suite', name: 'Meta Business Suite', icon: '💼', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://business.facebook.com' },
  { id: 'mailchimp', name: 'Mailchimp', icon: '🐵', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://mailchimp.com' },
  { id: 'brevo', name: 'Brevo', icon: '✉️', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://www.brevo.com' },
  { id: 'hubspot', name: 'HubSpot', icon: '🧲', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://www.hubspot.com' },
  { id: 'buffer', name: 'Buffer', icon: '📬', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://buffer.com' },
  { id: 'hootsuite', name: 'Hootsuite', icon: '🦉', cat: CONNECTOR_CATS[8], kind: 'link', url: 'https://www.hootsuite.com' },
  // 10. Payment ও Daily Utilities
  { id: 'paypal', name: 'PayPal', icon: '💳', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://www.paypal.com' },
  { id: 'stripe', name: 'Stripe', icon: '💳', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://stripe.com' },
  { id: 'wise', name: 'Wise', icon: '🌍', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://wise.com' },
  { id: 'payoneer', name: 'Payoneer', icon: '💵', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://www.payoneer.com' },
  { id: 'bkash', name: 'bKash', icon: '📱', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://www.bkash.com' },
  { id: 'nagad', name: 'Nagad', icon: '📱', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://www.nagad.com.bd' },
  { id: 'google-maps', name: 'Google Maps', icon: '🗺️', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://maps.google.com' },
  { id: 'google-translate', name: 'Google Translate', icon: '🌐', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://translate.google.com' },
  { id: 'google-news', name: 'Google News', icon: '📰', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://news.google.com' },
  { id: 'weather-com', name: 'Weather.com', icon: '🌤️', cat: CONNECTOR_CATS[9], kind: 'link', url: 'https://weather.com' },
];
/* Connector state helpers. */
function connState() { return store.get('connectors_v1', {}); }
function connSetState(con) { store.set('connectors_v1', con); }
/* Show only first 4 + last 4 chars of an API key — never the full key. */
function maskKey(k) {
  k = String(k || '');
  if (k.length <= 8) return k.slice(0, 2) + '…' + k.slice(-2);
  return k.slice(0, 4) + '…' + k.slice(-4);
}
function connStatus(c, con) {
  if (c.kind === 'google') {
    if (isGoogleSignedIn()) {
      const t = googleTokens();
      return 'Connected · ' + ((t && t.email) || 'Google account');
    }
    return 'Not connected';
  }
  if (c.kind === 'key') {
    const k = store.get('key_' + c.id, '');
    return k ? 'Connected · key ' + maskKey(k) : 'Not connected · needs API key';
  }
  return con[c.id] === 'opened' ? 'Opened' : 'Open in browser';
}
function openConnUrl(url) {
  if (isNativeApp()) { try { Browser.open({ url }); } catch {} }
  else { try { window.open(url, '_blank'); } catch {} }
}
function connCard(c, con) {
  const st = connStatus(c, con);
  const hay = (c.name + ' ' + c.cat + ' ' + c.id).toLowerCase();
  let btn = '', extra = '';
  if (c.kind === 'google') {
    btn = isGoogleSignedIn()
      ? `<button class="btn ghost small" data-act="conn-google" data-v="${c.id}">Disconnect</button>`
      : `<button class="btn small" data-act="conn-google" data-v="${c.id}">Connect</button>`;
  } else if (c.kind === 'key') {
    const k = store.get('key_' + c.id, '');
    btn = k
      ? `<button class="btn ghost small" data-act="conn-key-del" data-v="${c.id}">Remove key</button>`
      : `<button class="btn small" data-act="conn-key-open" data-v="${c.id}">Add key</button>`;
    if (state.connKeyFor === c.id) {
      extra = `<form id="f-conn-key" data-conn="${c.id}" data-conn-name="${esc(hay)}" style="margin-top:8px">
        <label class="lbl">API key for ${esc(c.name)} — saved only on this device</label>
        <input class="field" type="password" name="key" placeholder="Paste your ${esc(c.name)} API key" required>
        <button class="btn small" type="submit">Save key</button></form>`;
    }
  } else {
    btn = `<button class="btn small" data-act="conn-open" data-v="${c.id}">Open</button>`;
  }
  return `<div class="list-item" data-conn="${c.id}" data-conn-name="${esc(hay)}"><div><div class="t">${c.icon} ${esc(c.name)}</div><div class="s">${esc(st)}</div></div>
    <div style="display:flex;gap:6px;align-items:center">${btn}</div></div>${extra}`;
}
/* Live search filter for the Connectors module — filters rows in place so the
   search input never loses focus (a full re-render would drop the cursor). */
function filterConnectorRows() {
  const q = (state.connSearch || '').trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll('[data-conn]').forEach(row => {
    const hay = row.getAttribute('data-conn-name') || '';
    const show = !q || hay.includes(q);
    row.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.querySelectorAll('[data-conn-cat]').forEach(sec => {
    const anyVisible = [...sec.querySelectorAll('[data-conn]')].some(r => r.style.display !== 'none');
    sec.style.display = anyVisible ? '' : 'none';
  });
  const count = document.querySelector('#connCount');
  if (count) count.textContent = visible + ' of 100 connectors';
}

if (typeof window !== 'undefined') {
  window.__kira = { state, MODELS, store, callGemini, templateReply,
    CONNECTORS, CONNECTOR_CATS, maskKey, connStatus,
    pkceChallenge, makeVerifier, googleClientId, googleClientSecret, resolveGoogleSecret,
    isGoogleConfigured, isGoogleSignedIn, googleTokens, exchangeGoogleCode,
    googleSignOut, refreshGoogleToken, buildGoogleAuthUrl, GOOGLE_REDIRECT_URI, GOOGLE_IDS };
}

/* ---------- shell & router ---------- */
const app = document.querySelector('#app');
const NAV = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'chats', label: 'Chats', icon: '💬' },
  { id: 'voice', label: 'Voice', icon: 'orb' },
  { id: 'automate', label: 'Automate', icon: '⚡' },
  { id: 'more', label: 'More', icon: '☰' },
];
function goTab(tab) {
  state.tab = tab; state.module = null; state.sheet = null;
  if (tab === 'automate') state.sheet = 'automate';
  if (tab === 'more') state.sheet = 'more';
  render();
}
function openModule(id) {
  state.module = id; state.sheet = null; state.drawer = false;
  bumpTools(); render(); window.scrollTo(0, 0);
}
function closeModule() { state.module = null; render(); }
function openSheet(name) { state.sheet = name; render(); }
function closeSheet() { state.sheet = null; render(); }

function render() {
  const mod = state.module ? MODULES[state.module] : null;
  let body = '';
  if (mod) {
    body = `<div class="screen"><button class="back-btn" data-act="back">← Back</button>
      <h1>${mod.icon} ${mod.title}</h1>${mod.hint ? `<p class="sub">${mod.hint}</p>` : ''}
      <div id="module-body">${mod.render()}</div></div>`;
  } else if (state.tab === 'home') body = homeScreen();
  else if (state.tab === 'chats') body = chatsScreen();
  else if (state.tab === 'voice') body = voiceScreen();
  else body = `<div class="screen"><h1>${state.tab === 'automate' ? 'Automate' : 'More'}</h1>
    <p class="sub">Tap a tool below to open it.</p></div>`;

  app.innerHTML = `
    <header class="app-header">
      <div class="logo">Kira ai <small>✦</small></div>
      <div class="hicons">
        <button class="icon-btn" data-act="open-settings" title="Settings">⚙️</button>
        <button class="icon-btn" data-act="open-notifs" title="Notifications">🔔</button>
        <div class="avatar-dot">a</div>
      </div>
    </header>
    ${body}
    ${state.drawer ? drawerHTML() : ''}
    ${state.sheet === 'automate' ? automateSheet() : ''}
    ${state.sheet === 'more' ? moreSheet() : ''}
    ${state.toast ? `<div id="toast" style="position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#141a33;color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;z-index:80;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:88vw;text-align:center">${esc(state.toast)}</div>` : ''}
    <nav class="bottom-nav">
      ${NAV.map(n => n.icon === 'orb'
        ? `<button class="nav-orb ${state.tab === 'voice' ? 'active' : ''}" data-nav="voice" title="Voice" aria-label="Voice"></button>`
        : `<button class="nav-item ${state.tab === n.id ? 'active' : ''}" data-nav="${n.id}"><span class="ic">${n.icon}</span>${n.label}</button>`).join('')}
    </nav>
    <p class="footer-note">Kira clone — your data stays on this device.<br>Booking, payments and real calls are planning only.</p>`;
  afterRender();
}
function afterRender() {
  if (state.tab === 'home' && !state.module) drawBrain();
  if (state.tab === 'chats' && !state.module) { const m = $('#chatMsgs'); if (m) m.scrollTop = m.scrollHeight; }
  if (state.tab === 'voice' && !state.module) tickClock();
}

/* ---------- HOME ---------- */
function morningBrief() {
  const evs = store.get('events', []).filter(e => e.date === todayStr());
  const rems = store.get('reminders', []);
  const tasks = store.get('tasks', []).filter(t => !t.done);
  const d = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  if (!evs.length && !rems.length && !tasks.length) return `Good morning, abdur — ${d}. Nothing scheduled yet today. Add an event, a reminder or a task to get started.`;
  const parts = [`Good morning, abdur — ${d}.`];
  if (evs.length) parts.push(`Today: ${evs.map(e => e.title + (e.time ? ' at ' + e.time : '')).join(', ')}.`);
  if (tasks.length) parts.push(`${tasks.length} open task${tasks.length > 1 ? 's' : ''}.`);
  if (rems.length) parts.push(`${rems.length} reminder${rems.length > 1 ? 's' : ''} set.`);
  return parts.join(' ');
}
function homeScreen() {
  const cover = store.get('cover', false);
  const pinnedTiles = state.pinned.map(id => MODULES[id]).filter(Boolean);
  return `<div class="screen">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:20px">☀️</span><h1 style="margin:0">Morning brief</h1>
      <button class="icon-btn" style="margin-left:auto" data-act="search-brief" title="Search">🔍</button>
    </div>
    <div class="card" style="margin-top:10px"><div class="story">${esc(morningBrief())}</div></div>
    <div class="chiprow">
      <button class="chip ${cover ? 'active' : ''}" data-act="toggle-cover">☂️ Cover me ${cover ? '· On' : ''}</button>
      <button class="chip" data-open="reminders">🔔 Reminders</button>
      <button class="chip" data-open="task-runner">⚡ Task runner</button>
    </div>
    <div class="brain-wrap"><canvas id="brainCanvas" width="380" height="380"></canvas>
      <div class="brain-center"><div class="b-ic">🧠</div><div class="b-t">AI Brain</div></div>
    </div>
    <button class="chip" data-act="pin-menu" style="margin:6px 0 12px">＋ Pin menu</button>
    <div class="chiprow">
      <button class="chip" data-open="messages">💬 Messages</button>
      <button class="chip" data-open="receptionist">📞 Receptionist</button>
      <button class="chip" data-open="new-web">🌐 New Web</button>
    </div>
    ${pinnedTiles.length ? `<h2>Pinned</h2><div class="chiprow">${pinnedTiles.map(m => `<button class="chip small" data-open="${m.id}">${m.icon} ${m.title}</button>`).join('')}</div>` : ''}
    <h2>Quick tools</h2>
    <div class="grid2">
      <button class="tile" data-open="smart-calendar">📅 Smart Calendar</button>
      <button class="tile" data-open="meal-planner">🍽️ Meal Planner</button>
      <button class="tile" data-open="travel-planner">✈️ Travel Planner</button>
      <button class="tile" data-open="image-gen">✨ Image Gen</button>
    </div>
  </div>`;
}
function drawBrain() {
  const cv = $('#brainCanvas');
  if (!cv) return;
  let ctx = null;
  try { ctx = cv.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return;
  const W = 380, H = 380, cx = 190, cy = 190;
  ctx.clearRect(0, 0, W, H);
  const clusters = [
    { color: '#8b5cf6', label: 'Memory', lx: 190, ly: 108, a: -1.2, r: [60, 110] },
    { color: '#22c55e', label: 'Perception', lx: 268, ly: 165, a: -0.2, r: [60, 115] },
    { color: '#eab308', label: 'People', lx: 246, ly: 262, a: 0.8, r: [60, 110] },
    { color: '#ec4899', label: 'Goals', lx: 140, ly: 268, a: 1.9, r: [60, 110] },
    { color: '#3b82f6', label: 'Reasoning', lx: 112, ly: 158, a: 2.9, r: [60, 115] },
  ];
  const pts = [];
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  clusters.forEach(c => {
    for (let i = 0; i < 26; i++) {
      const ang = c.a + (rnd() - 0.5) * 1.5;
      const rad = c.r[0] + rnd() * (c.r[1] - c.r[0]);
      const x = cx + Math.cos(ang) * rad * 1.15, y = cy + Math.sin(ang) * rad;
      pts.push({ x, y, color: c.color });
    }
  });
  ctx.strokeStyle = 'rgba(120,120,180,0.18)';
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < 4 && i + j < pts.length; j++) {
      const q = pts[(i + j * 7) % pts.length];
      const dx = pts[i].x - q.x, dy = pts[i].y - q.y;
      if (dx * dx + dy * dy < 5200) { ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    }
  }
  pts.forEach(p => { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 7); ctx.fill(); });
  ctx.font = '700 15px sans-serif'; ctx.textAlign = 'center';
  clusters.forEach(c => { ctx.fillStyle = c.color; ctx.fillText(c.label, c.lx, c.ly); });
}

/* ---------- CHATS ---------- */
function chatsScreen() {
  const hist = state.chatHist;
  const persona = state.persona ? `<div class="msg sys">Chatting as ${esc(state.persona.name)} — tap ✕ to go back to Kira. <button data-act="clear-persona" style="font-weight:700;color:#2f4bff">✕</button></div>` : '';
  return `<div class="screen">
    <div style="display:flex;align-items:center;gap:10px">
      <button class="icon-btn" data-act="open-drawer" title="Menu">☰</button>
      <h1 style="margin:0;flex:1">AI Chat</h1>
      <button class="icon-btn" data-act="open-notifs" title="Notifications">🔔</button>
      <div class="avatar-dot">a</div>
    </div>
    ${hist.length === 0 ? `<div class="chat-welcome">
      <div class="orb"></div><h1>Welcome abdur</h1></div>` : `<div class="orb small" style="margin:10px auto"></div>`}
    <div class="askcard">
      <form id="chatForm"><div class="askline">
        <button type="button" class="plus-btn" data-act="chat-attach" title="Attach">＋</button>
        <input type="text" id="chatInput" name="chatInput" placeholder="Ask Kira to" autocomplete="off">
        <button type="button" class="mic-btn" data-act="voice-mic" title="Speak">🎙️</button>
        <button type="submit" class="voice-btn" title="Send">🎙️</button>
      </div></form>
      <div class="model-pick">▦ <select id="modelPick" data-act-change="model-pick" style="border:none;background:transparent;font-weight:700">
        ${MODELS.map(m => `<option ${GEMINI_MODEL() === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select> ⌄</div>
    </div>
    <div class="msgs" id="chatMsgs">
      ${persona}
      ${hist.map(m => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')}
      ${state.chatBusy ? '<div class="typing">Kira is thinking…</div>' : ''}
    </div>
    ${!GEMINI_KEY() ? `<div class="note">💡 Full AI answers need a free Gemini API key (get one at Google AI Studio). Add it in Settings — or keep chatting with built-in replies.
      <form id="keyForm" style="margin-top:8px"><input class="field" name="gemini_key" type="password" placeholder="Paste Gemini API key" required>
      <button class="btn small" type="submit">Save key</button></form></div>` : ''}
    <div class="chiprow">
      <button class="chip small" data-act="chip-goals">🎯 Goals</button>
      <button class="chip small" data-act="chip-docs">📄 Analyse Documents</button>
      <button class="chip small" data-act="chip-spark">💡 Creativity Spark</button>
      <button class="chip small" data-act="chip-knowme">👤 Get to know me</button>
      <button class="chip small" data-act="chip-research">🌐 Web Research</button>
    </div>
  </div>`;
}
function drawerHTML() {
  const chats = state.chatHist.filter(m => m.role === 'user').slice(-5).reverse();
  return `<div class="drawer-backdrop" data-act="close-drawer"></div>
  <aside class="drawer">
    <div class="dtab">
      <button class="${state.drawerTab === 'chat' ? 'on' : ''}" data-act="drawer-tab" data-v="chat">💬 Chat</button>
      <button class="${state.drawerTab === 'code' ? 'on' : ''}" data-act="drawer-tab" data-v="code">⌨️ Kira Code</button>
    </div>
    <button class="drawer-item" data-act="new-chat">🗨️ New Chat</button>
    <button class="drawer-item" data-act="search-chats">🔍 Search</button>
    <button class="drawer-item" data-act="open-settings">🧳 Customize</button>
    <button class="drawer-item" data-open="task-runner">⚡ Task runner</button>
    <h4>Recent <span>Date ⇅</span></h4>
    <div class="muted" style="padding:0 8px">TODAY</div>
    ${chats.length ? chats.map(m => `<button class="drawer-item" data-act="load-chat" data-v="${esc(m.text.slice(0, 40))}">💬 ${esc(m.text.slice(0, 34))}</button>`).join('') : '<div class="muted" style="padding:8px">No chats yet today.</div>'}
    <button class="drawer-item" data-open="my-workspace">📄 Notepad</button>
    <button class="drawer-item" data-act="chip-research">🧭 Deep Research</button>
  </aside>`;
}
async function sendChat(text) {
  text = (text || '').trim();
  if (!text || state.chatBusy) return;
  state.chatHist.push({ role: 'user', text });
  state.stats.turns++; saveStats(); saveChat();
  state.chatBusy = true; render();
  const input = $('#chatInput');
  try {
    let reply;
    if (GEMINI_KEY()) {
      const sys = state.persona ? state.persona.sys + ' Keep answers short and useful.' : 'You are Kira, a warm personal AI assistant for abdur. Answer briefly and helpfully, in the language the user writes (Bengali or English).';
      const r = await callGemini(text, sys);
      reply = r.text;
    } else {
      await new Promise(r => setTimeout(r, 350));
      reply = templateReply(text);
    }
    state.chatHist.push({ role: 'ai', text: reply });
  } catch (e) {
    state.chatHist.push({ role: 'ai', text: 'Sorry, the AI call failed (' + (e.message || 'error') + '). Check your Gemini key in Settings, or try again.' });
  }
  state.chatBusy = false; saveChat(); render();
}
function chipAction(kind) {
  if (kind === 'goals') { openModule('goals'); return; }
  if (kind === 'docs') { openModule('analyse-docs'); return; }
  if (kind === 'research') { openModule('deep-research'); return; }
  if (kind === 'knowme') { openModule('get-to-know-me'); return; }
  if (kind === 'spark') {
    state.chatHist.push({ role: 'user', text: 'Give me 3 creative ideas' });
    render();
    (async () => {
      state.chatBusy = true; render();
      let reply;
      try {
        reply = GEMINI_KEY()
          ? (await callGemini('Give abdur 3 fresh creative ideas for his Fiverr design work and daily content, one line each with a short why.', 'You are Kira.')).text
          : '3 ideas for you:\n1. "Before / after" design reels — show a plain thumbnail vs your redesigned one.\n2. A weekly free tip post for new YouTubers (thumbnail mistakes) — builds trust and brings orders.\n3. A small logo-pack gig add-on: logo + social avatar + cover, one price.';
      } catch { reply = 'Could not reach Gemini right now — try again in a moment.'; }
      state.chatHist.push({ role: 'ai', text: reply });
      state.chatBusy = false; saveChat(); render();
    })();
  }
}

/* ---------- VOICE ---------- */
function tickClock() {
  const el = $('#voiceClock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-GB');
  const d = $('#voiceDate');
  if (d) d.textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
setInterval(tickClock, 1000);
function voiceScreen() {
  const mems = store.get('memories', []);
  const notes = store.get('notes', []);
  const people = store.get('people', []);
  const tasks = store.get('tasks', []);
  const evs = store.get('events', []).filter(e => e.date === todayStr());
  const bars = [10, 16, 22, 12, 26, 18, 30, 14, 20, 9, 24, 15, 27, 11, 19, 8, 23, 13, 28, 16, 10, 21, 14, 25, 12, 18, 9, 22, 15, 26];
  return `<div class="screen">
    <div style="display:flex;align-items:flex-start;gap:8px">
      <div><h1 style="margin:0">Kira Voice Comm…</h1><div class="muted">Ready</div></div>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="icon-btn" data-act="voice-mic" title="Speak">🎙️</button>
        <button class="icon-btn" data-act="open-notifs" title="Notifications">🔔</button>
        <div class="avatar-dot">a</div>
      </div>
    </div>
    <div class="card" style="margin-top:10px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="chip small active">🟣 Kira 1</span><span class="chip small">🟢 Kira 2</span><span class="chip small">🔴</span>
        <button class="chip small" data-act="voice-graph" style="background:#141a33;color:#fff">🔗 Graph</button>
        <button class="chip small" data-act="voice-avatar" style="color:#2e7d32">👤 Avatar</button>
      </div>
      <div style="position:relative;text-align:center;padding:8px 0 0">
        <div class="orb" style="width:120px;height:120px"></div>
      </div>
      <div class="voice-grid" style="margin-top:6px">
        <div class="mini-card"><div class="k">SYSTEM</div>
          <div class="big" id="voiceClock">--:--:--</div>
          <div class="row"><span>Date</span><b id="voiceDate">—</b></div>
          <div class="row"><span>Kira AI</span><b>online</b></div>
        </div>
        <div class="mini-card"><div class="k">TELEMETRY</div>
          <div class="row"><span>Turns</span><b>${state.stats.turns}</b></div>
          <div class="row"><span>Median</span><b>—</b></div>
          <div class="row"><span>Tools</span><b>${state.stats.toolsUsed}</b></div>
        </div>
        <div class="mini-card"><div class="k">TEMPERATURE</div>
          <div class="big">23°C <span style="font-size:14px;color:#6b7194">Humidity 83%</span></div>
          <div class="muted">Dhaka (default)</div>
        </div>
        <div class="mini-card"><div class="k">PLAN</div>
          <div class="row"><span>●</span><b>Free</b><span class="muted">Inactive</span></div>
          <div class="muted">Upgrade in Kira Cloud</div>
        </div>
        <div class="mini-card"><div class="k">BRAIN</div>
          <div class="row"><span>Memories</span><b>${mems.length}</b></div>
          <div class="row"><span>Sources</span><b>${notes.length + people.length}</b></div>
          <div class="row"><span>Tasks</span><b>${tasks.length}</b></div>
        </div>
        <div class="mini-card"><div class="k">TODAY'S AGENDA</div>
          ${evs.length ? evs.map(e => `<div class="row"><span>${esc(e.title)}</span><b>${esc(e.time || '')}</b></div>`).join('') : '<div class="muted">Nothing scheduled today.</div>'}
        </div>
      </div>
    </div>
    <div class="card"><div class="switch-row">
      <div><b>${state.listening ? 'Listening…' : 'Tap to speak'}</b><div class="muted">Voice commands: "open calendar", "add task …", "what is my agenda"</div></div>
      <button class="toggle ${state.listening ? 'on' : ''}" data-act="voice-mic" aria-label="Hands-free"></button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
      <div class="wave">${bars.map(h => `<span style="height:${h}px"></span>`).join('')}</div>
      <span class="chip small" style="margin-left:auto">HANDS-FREE</span>
    </div>
    <div id="voiceResult" class="muted" style="margin-top:8px">${state.lastVoice ? 'Heard: "' + esc(state.lastVoice) + '"' : ''}</div>
    </div>
    <div class="card"><b>› WATCHLIST</b> <span class="muted">4 pinned · idle — open to load live data</span>
      <div class="chiprow" style="margin-top:8px">
        <span class="chip small">📈 Fiverr orders</span><span class="chip small">💬 Inbox</span>
        <span class="chip small">🌦️ Dhaka weather</span><span class="chip small">📰 Tech news</span>
      </div>
    </div>
  </div>`;
}
let recognition = null;
function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice recognition is not supported in this browser. Try Chrome.'); return; }
  if (state.listening && recognition) { try { recognition.stop(); } catch {} state.listening = false; render(); return; }
  recognition = new SR();
  recognition.lang = state.voiceLang;
  recognition.interimResults = false;
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    state.lastVoice = text; state.listening = false;
    handleVoiceCommand(text);
  };
  recognition.onerror = () => { state.listening = false; render(); };
  recognition.onend = () => { if (state.listening) { state.listening = false; render(); } };
  try { recognition.start(); state.listening = true; render(); } catch { state.listening = false; }
}
function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = state.voiceLang === 'bn-BD' ? 'bn-BD' : 'en-US';
    window.speechSynthesis.speak(u);
  } catch {}
}
function handleVoiceCommand(text) {
  const t = text.toLowerCase();
  let reply = '';
  const open = (id) => { openModule(id); };
  if (t.includes('calendar') || t.includes('ক্যালেন্ডার')) { open('smart-calendar'); reply = 'Opening Smart Calendar.'; }
  else if (t.includes('meal') || t.includes('খাবার')) { open('meal-planner'); reply = 'Opening Meal Planner.'; }
  else if (t.includes('travel') || t.includes('ভ্রমণ')) { open('travel-planner'); reply = 'Opening Travel Planner.'; }
  else if (t.includes('homework') || t.includes('হোমওয়ার্ক')) { open('homework'); reply = 'Opening Homework.'; }
  else if (t.includes('image') || t.includes('ছবি')) { open('image-gen'); reply = 'Opening Image Gen.'; }
  else if (t.includes('agenda') || t.includes('আজ')) { const evs = store.get('events', []).filter(e => e.date === todayStr()); reply = evs.length ? 'Today: ' + evs.map(e => e.title).join(', ') : 'Nothing scheduled today.'; state.tab = 'chats'; state.chatHist.push({ role: 'user', text }, { role: 'ai', text: reply }); saveChat(); }
  else if (t.startsWith('add task') || t.includes('add task') || t.includes('টাস্ক')) {
    const title = text.replace(/add task/i, '').trim() || 'Voice task';
    const tasks = store.get('tasks', []); tasks.push({ id: uid(), title, done: false }); store.set('tasks', tasks);
    reply = 'Added task: ' + title;
  }
  else if (t.includes('hello') || t.includes('hi') || t.includes('সালাম')) { reply = 'Hello abdur, I am listening.'; }
  else { reply = 'I heard: "' + text + '". Try "open calendar", "add task buy milk", or "what is my agenda".'; }
  state.lastVoice = text;
  speak(reply);
  if (state.tab !== 'voice') render(); else render();
}

/* ---------- AUTOMATE + MORE SHEETS ---------- */
const AUTOMATE_ITEMS = [
  { id: 'email-agent', icon: '✉️', title: 'Email Agent' },
  { id: 'call-agents', icon: '📞', title: 'AI Call Agents' },
  { id: 'messaging', icon: '💬', title: 'Messaging' },
  { id: 'integrations', icon: '🔌', title: 'Integrations' },
  { id: 'workflows', icon: '🗂️', title: 'Workflows' },
  { id: 'leadgen', icon: '🍁', title: 'MapleLeaf LeadGen' },
];
function automateSheet() {
  return `<div class="sheet-backdrop" data-act="close-sheet"></div>
  <div class="sheet"><div class="grab"></div>
    <h3>AUTOMATE <span>6 pages</span></h3>
    <div class="sheet-list">
      ${AUTOMATE_ITEMS.map(a => `<button data-open="${a.id}"><span class="ic">${a.icon}</span>${a.title}</button>`).join('')}
    </div>
    <p class="muted" style="margin-top:14px">All caught up &nbsp;·&nbsp; Esc to close</p>
  </div>`;
}
const MORE_ITEMS = [
  { id: 'chats', icon: '💬', title: 'Chats', tab: true },
  { id: 'agent-link', icon: '🤖', title: 'Agent Link' },
  { id: 'kbots', icon: '🤖', title: 'Kbots' },
  { id: 'kira-lens', icon: '🔍', title: 'Kira Lens' },
  { id: 'homework', icon: '📖', title: 'Homework' },
  { id: 'story-teller', icon: '✨', title: 'Story Teller' },
  { id: 'business-card', icon: '🪪', title: 'AI Business Card' },
  { id: 'image-gen', icon: '✨', title: 'Image Gen' },
  { id: 'social-media', icon: '🔗', title: 'Social Media' },
  { id: 'connectors', icon: '🔗', title: 'Connectors' },
  { id: 'meetings', icon: '📹', title: 'Meetings' },
  { id: 'vision-board', icon: '👁️', title: 'Vision Board' },
  { id: 'locked-pro', icon: '🔒', title: 'Unlocks after the first task', locked: true },
  { id: 'events-planner', icon: '🎉', title: 'Events Planner' },
  { id: 'smart-calendar', icon: '📅', title: 'Smart Calendar' },
  { id: 'meal-planner', icon: '🍽️', title: 'Meal Planner' },
  { id: 'ai-shopping', icon: '🛍️', title: 'AI Shopping' },
  { id: 'travel-planner', icon: '🌐', title: 'Travel Planner' },
  { id: 'my-brain', icon: '🧠', title: 'My Brain' },
  { id: 'people', icon: '👥', title: 'People' },
  { id: 'kira-cloud', icon: '☁️', title: 'Kira Cloud' },
  { id: 'my-workspace', icon: '🖥️', title: 'My Workspace' },
  { id: 'tutors', icon: '🎓', title: 'Tutors' },
  { id: 'agent-force', icon: '🕸️', title: 'Agent Force' },
  { id: 'ai-lawyer', icon: '⚖️', title: 'AI Lawyer' },
  { id: 'ai-consultants', icon: '👤', title: 'AI Consultants' },
  { id: 'newbie', icon: '○', title: 'Newbie' },
];
function moreSheet() {
  return `<div class="sheet-backdrop" data-act="close-sheet"></div>
  <div class="sheet"><div class="grab"></div>
    <h3>MORE <span>All of Kira</span></h3>
    <div class="grid2">
      ${MORE_ITEMS.map(m => m.locked
        ? `<button class="tile locked" data-act="locked-tile"><span class="ic">${m.icon}</span>${m.title}</button>`
        : m.tab
          ? `<button class="tile" data-nav="chats"><span class="ic">${m.icon}</span>${m.title}</button>`
          : `<button class="tile" data-open="${m.id}"><span class="ic">${m.icon}</span>${m.title}</button>`).join('')}
    </div>
    <p class="muted" style="margin-top:14px">All of Kira &nbsp;·&nbsp; Esc to close</p>
  </div>`;
}

/* ---------- MODULES ---------- */
function delBtn(key, id) { return `<button class="btn ghost small" data-act="del" data-key="${key}" data-id="${id}">Delete</button>`; }
function emptyNote(t) { return `<p class="muted">${t}</p>`; }

const MODULES = {
  'smart-calendar': {
    id: 'smart-calendar', icon: '📅', title: 'Smart Calendar', hint: 'Events are saved on this device and feed Today\'s Agenda and the Morning brief.',
    render() {
      const evs = store.get('events', []).slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
      return `<div class="card"><form id="f-cal-add">
        <label class="lbl">Event title</label><input class="field" name="title" placeholder="e.g. Client call" required>
        <label class="lbl">Date</label><input class="field" type="date" name="date" value="${todayStr()}" required>
        <label class="lbl">Time (optional)</label><input class="field" type="time" name="time">
        <button class="btn" type="submit">＋ Add event</button></form></div>
      <div class="card"><h3>Upcoming</h3>
        ${evs.length ? evs.map(e => `<div class="list-item"><div><div class="t">${esc(e.title)}</div><div class="s">${fmtDate(e.date)}${e.time ? ' · ' + esc(e.time) : ''}</div></div>${delBtn('events', e.id)}</div>`).join('') : emptyNote('No events yet.')}
      </div>`;
    },
  },
  reminders: {
    id: 'reminders', icon: '🔔', title: 'Reminders', hint: 'Reminders live on this device.',
    render() {
      const rems = store.get('reminders', []);
      return `<div class="card"><form id="f-rem-add">
        <label class="lbl">Reminder</label><input class="field" name="text" placeholder="e.g. Reply to buyer" required>
        <label class="lbl">Time</label><input class="field" type="time" name="time">
        <button class="btn" type="submit">＋ Add reminder</button></form></div>
      <div class="card"><h3>Your reminders</h3>
        ${rems.length ? rems.map(r => `<div class="list-item"><div><div class="t">${esc(r.text)}</div><div class="s">${esc(r.time || 'No time set')}</div></div>${delBtn('reminders', r.id)}</div>`).join('') : emptyNote('No reminders yet.')}
      </div>`;
    },
  },
  'task-runner': {
    id: 'task-runner', icon: '⚡', title: 'Task runner', hint: 'Add tasks, then Run to step through them one by one.',
    render() {
      const tasks = store.get('tasks', []);
      return `<div class="card"><form id="f-task-add">
        <input class="field" name="title" placeholder="New task…" required>
        <button class="btn" type="submit">＋ Add task</button></form></div>
      <div class="card"><h3>Tasks</h3>
        ${tasks.length ? tasks.map(t => `<div class="list-item"><div><div class="t" style="${t.done ? 'text-decoration:line-through;color:#6b7194' : ''}">${esc(t.title)}</div><div class="s">${t.done ? 'Done ✓' : 'Pending'}</div></div>
        <div style="display:flex;gap:6px"><button class="btn small" data-act="run-task" data-id="${t.id}">${t.done ? 'Again' : 'Run'}</button>${delBtn('tasks', t.id)}</div></div>`).join('') : emptyNote('No tasks yet.')}
      </div>
      <div class="card"><h3>Run status</h3><div id="runStatus" class="muted">${state.stats.tasksRun} task${state.stats.tasksRun === 1 ? '' : 's'} run so far.</div>
      <div class="btnrow"><button class="btn ghost" data-act="run-all-tasks">▶ Run all pending</button></div></div>`;
    },
  },
  goals: {
    id: 'goals', icon: '🎯', title: 'Goals', hint: 'Track goals with progress. Saved on this device.',
    render() {
      const goals = store.get('goals', []);
      return `<div class="card"><form id="f-goal-add">
        <input class="field" name="title" placeholder="Goal — e.g. Reach Fiverr Level 1" required>
        <button class="btn" type="submit">＋ Add goal</button></form></div>
      ${goals.length ? goals.map(g => `<div class="card"><div class="list-item" style="border:none;padding:0"><div><div class="t">${esc(g.title)}</div><div class="s">${g.progress}% complete</div></div>${delBtn('goals', g.id)}</div>
        <div class="progress"><div style="width:${g.progress}%"></div></div>
        <input type="range" min="0" max="100" value="${g.progress}" data-act-change="goal-progress" data-id="${g.id}" style="width:100%">
      </div>`).join('') : `<div class="card">${emptyNote('No goals yet.')}</div>`}`;
    },
  },
  messages: {
    id: 'messages', icon: '💬', title: 'Messages', hint: 'Demo inbox on this device. Cover me can auto-draft replies.',
    render() {
      const cover = store.get('cover', false);
      const threads = store.get('threads', [
        { id: 't1', name: 'Fiverr buyer', last: 'Hi! Can you design a thumbnail for my video?', replies: [] },
        { id: 't2', name: 'Rahim (friend)', last: 'Are we meeting tomorrow?', replies: [] },
        { id: 't3', name: 'Kira', last: 'Your morning brief is ready.', replies: [] },
      ]);
      return `${cover ? '<div class="note">☂️ Cover me is ON — replies are drafted automatically for new messages.</div>' : ''}
      ${threads.map(t => `<div class="card"><div class="list-item" style="border:none;padding:0"><div><div class="t">${esc(t.name)}</div><div class="s">${esc(t.last)}</div></div></div>
        ${t.replies.map(r => `<div class="msg ai" style="margin:6px 0">${esc(r)}</div>`).join('')}
        <form class="reply-form" data-thread="${t.id}"><input class="field" name="reply" placeholder="Reply…" required>
        <button class="btn small" type="submit">Send</button></form>
        ${cover ? `<button class="btn ghost small" data-act="auto-draft" data-id="${t.id}">✨ Auto-draft reply</button>` : ''}
      </div>`).join('')}`;
    },
  },
  receptionist: {
    id: 'receptionist', icon: '📞', title: 'Receptionist', hint: 'Auto-reply drafts for when you are busy.',
    render() {
      const tpl = store.get('receptionist_tpl', 0);
      const templates = [
        'Hi! Thanks for your message. I am busy right now and will reply within an hour. — abdur',
        'Hello! I received your message. I will get back to you today. — abdur',
        'Thanks for reaching out! For design orders, please share your details and I will reply with a quote. — abdur',
      ];
      return `<div class="card"><h3>Auto-reply template</h3>
        ${templates.map((t, i) => `<label style="display:block;padding:8px 0"><input type="radio" name="rtpl" data-act-change="receptionist-tpl" data-v="${i}" ${tpl === i ? 'checked' : ''}> ${esc(t)}</label>`).join('')}
        <div class="note">Receptionist drafts replies locally. It never sends messages by itself.</div></div>
      <div class="card"><h3>Preview</h3><div class="msg ai">${esc(templates[tpl])}</div></div>`;
    },
  },
  'new-web': {
    id: 'new-web', icon: '🌐', title: 'New Web', hint: 'Browse inside Kira. Some sites block embedding — use the external link then.',
    render() {
      const url = state.browserUrl || 'https://example.com';
      return `<div class="card"><form id="f-web-open"><div style="display:flex;gap:8px">
        <input class="field" name="url" value="${esc(url)}" style="margin:0" required>
        <button class="btn" type="submit">Go</button></div></form>
      <div class="btnrow"><button class="btn ghost small" data-act="web-open" data-v="https://www.google.com">Google</button>
      <button class="btn ghost small" data-act="web-open" data-v="https://www.fiverr.com">Fiverr</button>
      <button class="btn ghost small" data-act="web-open" data-v="https://www.youtube.com">YouTube</button></div></div>
      <div class="card" style="padding:8px"><iframe id="webFrame" src="${esc(url)}" style="width:100%;height:420px;border:none;border-radius:14px" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
      <div class="btnrow"><a class="btn ghost small" href="${esc(url)}" target="_blank" rel="noopener">↗️ Open externally</a></div></div>`;
    },
  },
  'email-agent': {
    id: 'email-agent', icon: '✉️', title: 'Email Agent', hint: 'Drafts are saved locally. Real sending needs a Gmail connection.',
    render() {
      const drafts = store.get('emails', []);
      return `<div class="card"><form id="f-email">
        <label class="lbl">To</label><input class="field" type="email" name="to" placeholder="name@example.com" required>
        <label class="lbl">Subject</label><input class="field" name="subject" placeholder="Subject" required>
        <label class="lbl">Body</label><textarea class="field" name="body" rows="5" placeholder="Write your email…" required></textarea>
        <div class="btnrow"><button class="btn" type="submit">Save draft</button>
        <button class="btn ghost" type="button" data-act="email-send-note">Send</button></div></form></div>
      <div class="card"><h3>Drafts (${drafts.length})</h3>
        ${drafts.length ? drafts.map(d => `<div class="list-item"><div><div class="t">${esc(d.subject)}</div><div class="s">To ${esc(d.to)} · draft</div></div>${delBtn('emails', d.id)}</div>`).join('') : emptyNote('No drafts yet.')}
      </div>
      <div class="warn">Real email sending is not connected. Connect Gmail in Integrations first — until then, drafts stay on this device.</div>`;
    },
  },
  'call-agents': {
    id: 'call-agents', icon: '📞', title: 'AI Call Agents', hint: 'Schedule a call and preview its script. Real calls need a paid telephony API.',
    render() {
      const calls = store.get('calls', []);
      return `<div class="card"><form id="f-call">
        <label class="lbl">Name</label><input class="field" name="name" placeholder="Who to call" required>
        <label class="lbl">Phone</label><input class="field" name="phone" placeholder="+880…" required>
        <label class="lbl">Purpose</label><input class="field" name="purpose" placeholder="e.g. Confirm delivery" required>
        <label class="lbl">When</label><input class="field" type="datetime-local" name="when">
        <button class="btn" type="submit">＋ Schedule call</button></form></div>
      ${calls.length ? calls.map(c => `<div class="card"><div class="t"><b>${esc(c.name)}</b> · ${esc(c.phone)}</div>
        <div class="s">${esc(c.purpose)}${c.when ? ' · ' + esc(c.when.replace('T', ' ')) : ''}</div>
        <div class="note" style="margin-top:8px">"Hello, this is Kira calling for abdur. I am calling about: ${esc(c.purpose)}. Is now a good time to talk?"</div>
        ${delBtn('calls', c.id)}</div>`).join('') : `<div class="card">${emptyNote('No scheduled calls.')}</div>`}
      <div class="warn">This is a plan + script only. Real phone calls need a paid telephony service — Kira cannot call anyone from this app alone.</div>`;
    },
  },
  messaging: {
    id: 'messaging', icon: '💬', title: 'Messaging', hint: 'Connect WhatsApp / Telegram (demo — token stays on this device).',
    render() {
      const con = store.get('msg_conn', {});
      const saved = store.get('msg_saved', []);
      return `<div class="card"><h3>Connect</h3>
        ${['WhatsApp', 'Telegram'].map(p => `<div class="list-item"><div><div class="t">${p}</div><div class="s">${con[p] ? 'Connected (demo)' : 'Not connected'}</div></div>
        <button class="btn ${con[p] ? 'ghost' : ''} small" data-act="msg-connect" data-v="${p}">${con[p] ? 'Disconnect' : 'Connect'}</button></div>`).join('')}
        <div class="note">Demo connect only — paste any token or tap Connect; it is stored locally and never sent anywhere.</div></div>
      <div class="card"><form id="f-msg">
        <label class="lbl">Platform</label><select class="field" name="platform"><option>WhatsApp</option><option>Telegram</option></select>
        <label class="lbl">Message</label><textarea class="field" name="body" rows="3" placeholder="Type a message…" required></textarea>
        <button class="btn" type="submit">Save message</button></form></div>
      <div class="card"><h3>Saved messages (${saved.length})</h3>
        ${saved.length ? saved.map(m => `<div class="list-item"><div><div class="t">${esc(m.platform)}</div><div class="s">${esc(m.body)}</div></div>${delBtn('msg_saved', m.id)}</div>`).join('') : emptyNote('Nothing saved yet.')}
      </div>`;
    },
  },
  integrations: {
    id: 'integrations', icon: '🔌', title: 'Integrations', hint: 'Google sign-in is real — Slack and Notion are demo.',
    render() {
      const con = store.get('integrations', {});
      const gt = googleTokens();
      return `<div class="card">${INTEGRATIONS.map(i => {
        if (i.link) {
          return `<div class="list-item"><div><div class="t">${i.icon} ${i.name}</div><div class="s">Your personal AI agent — tap to open chat</div></div>
        <button class="btn small" data-act="int-open" data-v="${i.id}">Open</button></div>`;
        }
        const isGoogle = GOOGLE_IDS.includes(i.id);
        const real = isGoogle && con[i.id] === 'google' && gt;
        const demo = con[i.id] === 'demo';
        const status = real ? 'Connected · ' + esc(gt.email || 'Google account') : demo ? 'Connected (demo)' : 'Not connected';
        const btn = real || demo ? 'Disconnect' : 'Connect';
        return `<div class="list-item"><div><div class="t">${i.icon} ${i.name}</div><div class="s">${status}</div></div>
        <button class="btn ${real || demo ? 'ghost' : ''} small" data-act="int-connect" data-v="${i.id}">${btn}</button></div>`;
      }).join('')}</div>
      <div class="note">Google, Gmail, Drive and Calendar sign you in with your real Google account (read-only scopes). Tokens stay on this device. Slack and Notion are demo connections — real access would need their official OAuth. Jewel opens your personal agent chat (muse.ai) — the app that solves the problems this app cannot.</div>`;
    },
  },
  workflows: {
    id: 'workflows', icon: '🗂️', title: 'Workflows', hint: 'Simple if-this-then-that automations, saved locally.',
    render() {
      const wfs = store.get('workflows', []);
      return `<div class="card"><form id="f-wf">
        <label class="lbl">When (trigger)</label><select class="field" name="trigger"><option>New message arrives</option><option>Morning (8 AM)</option><option>Task completed</option><option>New calendar event</option></select>
        <label class="lbl">Then (action)</label><select class="field" name="action"><option>Draft a reply</option><option>Send a reminder</option><option>Add a task</option><option>Show a notification</option></select>
        <button class="btn" type="submit">＋ Create workflow</button></form></div>
      <div class="card"><h3>Your workflows</h3>
        ${wfs.length ? wfs.map(w => `<div class="list-item"><div><div class="t">${esc(w.trigger)} → ${esc(w.action)}</div><div class="s">${w.on ? 'On' : 'Off'}</div></div>
        <div style="display:flex;gap:6px"><button class="toggle ${w.on ? 'on' : ''}" data-act="wf-toggle" data-id="${w.id}" aria-label="Toggle"></button>${delBtn('workflows', w.id)}</div></div>`).join('') : emptyNote('No workflows yet.')}
      </div>`;
    },
  },
  leadgen: {
    id: 'leadgen', icon: '🍁', title: 'MapleLeaf LeadGen', hint: 'Capture leads, saved on this device.',
    render() {
      const leads = store.get('leads', []);
      return `<div class="card"><form id="f-lead">
        <label class="lbl">Name</label><input class="field" name="name" placeholder="Lead name" required>
        <label class="lbl">Email</label><input class="field" type="email" name="email" placeholder="Email" required>
        <label class="lbl">Interest</label><input class="field" name="interest" placeholder="e.g. Logo design">
        <button class="btn" type="submit">＋ Add lead</button></form></div>
      <div class="card"><h3>Leads (${leads.length})</h3>
        ${leads.length ? leads.map(l => `<div class="list-item"><div><div class="t">${esc(l.name)}</div><div class="s">${esc(l.email)}${l.interest ? ' · ' + esc(l.interest) : ''}</div></div>${delBtn('leads', l.id)}</div>`).join('') : emptyNote('No leads yet.')}
      </div>`;
    },
  },
  connectors: {
    id: 'connectors', icon: '🔗', title: 'Connectors', hint: '১০০টি সার্ভিস — Google সাইন-ইন, API key, বা সরাসরি খুলুন। চাবি আর টোকেন শুধু এই ডিভাইসেই থাকে।',
    render() {
      const q = (state.connSearch || '').trim().toLowerCase();
      const list = q
        ? CONNECTORS.filter(c => (c.name + ' ' + c.cat + ' ' + c.id).toLowerCase().includes(q))
        : CONNECTORS;
      const con = connState();
      const cats = CONNECTOR_CATS.map(cat => ({ cat, items: list.filter(c => c.cat === cat) })).filter(g => g.items.length);
      return `<div class="card">
        <label class="lbl">Search connectors</label>
        <input class="field" id="connSearch" data-act-input="conn-search" placeholder="Search — e.g. Facebook, Fiverr, Gemini…" value="${esc(state.connSearch || '')}">
        <div class="s" id="connCount" style="margin-top:6px">${list.length} of 100 connectors</div>
      </div>
      ${cats.map(g => `<div class="card" data-conn-cat="${esc(g.cat)}"><h3>${esc(g.cat)} (${g.items.length})</h3>
        ${g.items.map(c => connCard(c, con)).join('')}
      </div>`).join('') || emptyNote('No connectors match your search.')}
      <div class="note">Google services use your real Google sign-in (read-only scopes). AI provider keys are saved only on this device and never shown in full. Other services open their official site in the browser.</div>`;
    },
  },
};

Object.assign(MODULES, {
  'social-media': {
    id: 'social-media', icon: '🔗', title: 'Social Media', hint: 'Dashboard — everything the agent did while you were away.',
    render() {
      const con = store.get('social_conn', {});
      const posts = store.get('social_posts', []);
      const agentRunning = store.get('social_agent', 'paused') === 'running';
      return `<div class="card" style="display:flex;align-items:center;gap:10px">
        <span class="tag ${agentRunning ? 'green' : 'grey'}">● AGENT ${agentRunning ? 'RUNNING' : 'PAUSED'}</span>
        <button class="btn small" style="margin-left:auto" data-act="social-resume">▶ ${agentRunning ? 'Pause agent' : 'Resume agent'}</button></div>
      ${SOCIALS.map(s => `<div class="card"><div class="list-item" style="border:none;padding:0"><div>
        <span class="tag" style="${s.cls}">${s.name}</span>
        <div class="s" style="margin-top:6px">Kira can't see or send anything here.</div></div>
        <span class="tag ${con[s.id] ? 'green' : 'grey'}">● ${con[s.id] ? 'Connected (demo)' : 'Not connected'}</span></div>
        <div class="btnrow"><button class="btn small" data-act="social-connect" data-v="${s.id}">${con[s.id] ? 'Disconnect' : 'Connect ' + s.name}</button></div></div>`).join('')}
      <div class="card"><h3>Post composer (saves locally)</h3>
        <form id="f-social"><select class="field" name="platform">${SOCIALS.map(s => `<option>${s.name}</option>`).join('')}</select>
        <textarea class="field" name="body" rows="3" placeholder="Write a post…" required></textarea>
        <button class="btn" type="submit">Save post</button></form>
        <div class="note">Demo only — nothing is published to the platform. Real posting needs the platform's official API approval.</div></div>
      <div class="card"><h3>Saved posts (${posts.length})</h3>
        ${posts.length ? posts.map(p => `<div class="list-item"><div><div class="t">${esc(p.platform)}</div><div class="s">${esc(p.body)}</div></div>${delBtn('social_posts', p.id)}</div>`).join('') : emptyNote('No saved posts yet.')}
      </div>`;
    },
  },
  'meal-planner': {
    id: 'meal-planner', icon: '🍽️', title: 'Meal Planner', hint: 'A 7-day Bengali-friendly meal plan. Uses Gemini when a key is saved.',
    render() {
      const plan = store.get('meal_plan', null);
      const days = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      return `<div class="card"><form id="f-meal">
        <label class="lbl">Food type</label><select class="field" name="type"><option>Non-veg</option><option>Veg</option><option>Mixed</option></select>
        <label class="lbl">Budget / day (৳)</label><input class="field" type="number" name="budget" value="300" min="50">
        <button class="btn" type="submit">🍽️ Make my 7-day plan</button></form></div>
      <div id="mealOut">${plan ? `<div class="card"><h3>Your 7-day plan (${esc(plan.type)} · ৳${esc(plan.budget)}/day)</h3>
        ${plan.days.map((d, i) => `<div class="list-item"><div><div class="t">${days[i]}</div><div class="s">${esc(d)}</div></div></div>`).join('')}</div>` : ''}</div>`;
    },
  },
  'travel-planner': {
    id: 'travel-planner', icon: '🌐', title: 'Travel Planner', hint: 'Day-wise itinerary. Uses Gemini when a key is saved.',
    render() {
      const trip = store.get('trip_plan', null);
      return `<div class="card"><form id="f-trip">
        <label class="lbl">Destination</label><input class="field" name="dest" placeholder="e.g. Cox's Bazar" required>
        <label class="lbl">Days</label><input class="field" type="number" name="days" value="3" min="1" max="14">
        <label class="lbl">Budget (৳)</label><input class="field" type="number" name="budget" value="15000" min="500">
        <button class="btn" type="submit">✈️ Build itinerary</button></form></div>
      <div id="tripOut">${trip ? `<div class="card"><h3>${esc(trip.dest)} — ${trip.days} days · ৳${esc(trip.budget)}</h3>
        <div class="story">${esc(trip.text).split('\n').map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}</div>
      <div class="note">Planning only — this app cannot book flights or hotels. Real booking needs a travel booking service.</div>`;
    },
  },
  'ai-shopping': {
    id: 'ai-shopping', icon: '🛍️', title: 'AI Shopping', hint: 'Shopping list + simple price compare.',
    render() {
      const items = store.get('shop', []);
      return `<div class="card"><form id="f-shop">
        <label class="lbl">Item</label><input class="field" name="item" placeholder="e.g. Headphones" required>
        <label class="lbl">Price (৳)</label><input class="field" type="number" name="price" placeholder="0">
        <label class="lbl">Shop</label><input class="field" name="shop" placeholder="e.g. Daraz">
        <button class="btn" type="submit">＋ Add item</button></form></div>
      <div class="card"><h3>Your list</h3>
        ${items.length ? items.map(i => `<div class="list-item"><div><div class="t">${esc(i.item)}</div><div class="s">${esc(i.shop || '—')} · ৳${esc(i.price || 0)}</div></div>${delBtn('shop', i.id)}</div>`).join('') : emptyNote('List is empty.')}
        ${items.length > 1 ? `<div class="note">Cheapest: <b>${esc(items.slice().sort((a, b) => (+a.price || 0) - (+b.price || 0))[0].item)}</b> — compare prices before buying.</div>` : ''}
      </div>`;
    },
  },
  homework: {
    id: 'homework', icon: '📖', title: 'Homework', hint: 'Ask any question — Kira explains step by step.',
    render() {
      const subj = state.hwSubject || '';
      const ans = state.hwAnswer || '';
      return `<div class="card"><form id="f-hw">
        <label class="lbl">Subject</label><select class="field" name="subject">${TUTORS.map(s => `<option ${s === subj ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <label class="lbl">Your question</label><textarea class="field" name="q" rows="3" placeholder="e.g. Solve 2x² − 7x + 3 = 0" required></textarea>
        <button class="btn" type="submit">✏️ Explain step by step</button></form></div>
      ${ans ? `<div class="card"><h3>Answer</h3><div class="story">${esc(ans).split('\n').map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}`;
    },
  },
  'image-gen': {
    id: 'image-gen', icon: '✨', title: 'Image Gen', hint: 'Free image generation (Pollinations, no key needed).',
    render() {
      const img = state.genImage || null;
      return `<div class="card"><form id="f-img">
        <label class="lbl">Describe the image</label><input class="field" name="prompt" placeholder="e.g. A golden-hour portrait, cinematic" required>
        <button class="btn" type="submit">✨ Generate image</button></form></div>
      ${img ? `<div class="card"><div class="img-frame"><img class="kb" id="genImg" src="${esc(img.url)}" alt="Generated image"></div>
        <div class="btnrow"><a class="btn small" href="${esc(img.url)}" target="_blank" rel="noopener">⬇️ Download / open</a>
        <button class="btn ghost small" data-act="img-motion">▶ Motion (Ken Burns)</button></div>
        <div class="note">Motion here is a zoom/pan effect on your image. Real AI motion video is not available — no free video API exists. For true AI video, try Kling or Veo 3 in Google AI Studio (free tier).</div></div>` : ''}`;
    },
  },
  'story-teller': {
    id: 'story-teller', icon: '✨', title: 'Story Teller', hint: 'A short story on any topic. Uses Gemini when a key is saved.',
    render() {
      const story = state.storyText || '';
      return `<div class="card"><form id="f-story">
        <label class="lbl">Story topic</label><input class="field" name="topic" placeholder="e.g. A boy and his kite in Dhaka" required>
        <button class="btn" type="submit">✨ Tell me a story</button></form></div>
      ${story ? `<div class="card"><div class="story">${esc(story).split('\n').map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}`;
    },
  },
  'kira-lens': {
    id: 'kira-lens', icon: '🔍', title: 'Kira Lens', hint: 'Upload a photo — Kira looks at it and describes it (needs a Gemini key).',
    render() {
      const lens = state.lens || null;
      return `<div class="card"><form id="f-lens">
        <label class="lbl">Choose a photo</label><input class="field" type="file" name="photo" accept="image/*" required>
        <button class="btn" type="submit">🔍 Look at this</button></form></div>
      ${lens ? `<div class="card"><img src="${esc(lens.dataUrl)}" style="max-width:100%;border-radius:16px" alt="Uploaded photo">
        <div class="story" style="margin-top:10px">${esc(lens.desc)}</div></div>` : ''}`;
    },
  },
  kbots: {
    id: 'kbots', icon: '🤖', title: 'Kbots', hint: 'Specialist bots — tap one to chat with it.',
    render() {
      return KBOTS.map(b => `<div class="card"><div class="list-item" style="border:none;padding:0"><div><div class="t">${b.icon} ${b.name}</div><div class="s">Specialist assistant</div></div>
        <button class="btn small" data-act="chat-persona" data-v="${b.id}">Chat</button></div></div>`).join('');
    },
  },
  'business-card': {
    id: 'business-card', icon: '🪪', title: 'AI Business Card', hint: 'Fill the form — your card previews live.',
    render() {
      const c = store.get('bizcard', { name: 'abdur Razzak', role: 'Graphic Designer', phone: '+880 1609-610063', email: 'razzakar133@gmail.com' });
      return `<div class="card" style="background:linear-gradient(135deg,#2f4bff,#7b5cff);color:#fff">
        <div style="font-size:20px;font-weight:800">${esc(c.name)}</div>
        <div style="opacity:.9">${esc(c.role)}</div>
        <div style="margin-top:10px;font-size:14px">${esc(c.phone)}<br>${esc(c.email)}</div>
        <div style="margin-top:10px;font-size:12px;opacity:.8">Kira Business Card</div></div>
      <div class="card"><form id="f-bizcard">
        <label class="lbl">Name</label><input class="field" name="name" value="${esc(c.name)}" required>
        <label class="lbl">Role</label><input class="field" name="role" value="${esc(c.role)}">
        <label class="lbl">Phone</label><input class="field" name="phone" value="${esc(c.phone)}">
        <label class="lbl">Email</label><input class="field" type="email" name="email" value="${esc(c.email)}">
        <button class="btn" type="submit">Save card</button></form></div>`;
    },
  },
  meetings: {
    id: 'meetings', icon: '📹', title: 'Meetings', hint: 'Notes + action items for every meeting.',
    render() {
      const ms = store.get('meetings', []);
      return `<div class="card"><form id="f-meeting">
        <label class="lbl">Meeting title</label><input class="field" name="title" placeholder="e.g. Team sync" required>
        <label class="lbl">Notes</label><textarea class="field" name="notes" rows="3" placeholder="What was discussed…"></textarea>
        <label class="lbl">Action items (one per line)</label><textarea class="field" name="actions" rows="2" placeholder="Send the file&#10;Reply to buyer"></textarea>
        <button class="btn" type="submit">＋ Save meeting</button></form></div>
      ${ms.map(m => `<div class="card"><div class="t"><b>${esc(m.title)}</b></div><div class="s">${esc(m.notes || '')}</div>
        ${m.actions.map((a, i) => `<label style="display:block;padding:5px 0"><input type="checkbox" data-act-change="meeting-action" data-id="${m.id}" data-v="${i}" ${a.done ? 'checked' : ''}> <span style="${a.done ? 'text-decoration:line-through;color:#6b7194' : ''}">${esc(a.text)}</span></label>`).join('')}
        ${delBtn('meetings', m.id)}</div>`).join('')}`;
    },
  },
  'vision-board': {
    id: 'vision-board', icon: '👁️', title: 'Vision Board', hint: 'Pin images that show your goals.',
    render() {
      const pins = store.get('vision', []);
      return `<div class="card"><form id="f-vision">
        <label class="lbl">Image URL</label><input class="field" name="url" type="url" placeholder="https://…/image.jpg" required>
        <label class="lbl">Caption</label><input class="field" name="caption" placeholder="e.g. My dream studio">
        <button class="btn" type="submit">＋ Pin to board</button></form></div>
      <div class="grid2">${pins.map(p => `<div class="card" style="margin:0;padding:8px"><img src="${esc(p.url)}" style="width:100%;border-radius:12px" alt="Vision pin"><div class="s" style="padding:6px 2px">${esc(p.caption || '')}</div>${delBtn('vision', p.id)}</div>`).join('')}</div>
      ${pins.length ? '' : `<div class="card">${emptyNote('Board is empty — pin your first image.')}</div>`}`;
    },
  },
  'events-planner': {
    id: 'events-planner', icon: '🎉', title: 'Events Planner', hint: 'Plan an event with a checklist.',
    render() {
      const evs = store.get('planned_events', []);
      return `<div class="card"><form id="f-event">
        <label class="lbl">Event name</label><input class="field" name="name" placeholder="e.g. Birthday party" required>
        <label class="lbl">Date</label><input class="field" type="date" name="date" value="${todayStr()}">
        <label class="lbl">Budget (৳)</label><input class="field" type="number" name="budget" placeholder="5000">
        <button class="btn" type="submit">＋ Plan event</button></form></div>
      ${evs.map(e => `<div class="card"><div class="t"><b>${esc(e.name)}</b> · ${fmtDate(e.date)}</div><div class="s">Budget ৳${esc(e.budget || '—')}</div>
        ${['Venue booked', 'Guests invited', 'Food arranged', 'Budget checked'].map((c, i) => `<label style="display:block;padding:5px 0"><input type="checkbox" data-act-change="event-check" data-id="${e.id}" data-v="${i}" ${(e.checks || [])[i] ? 'checked' : ''}> ${c}</label>`).join('')}
        ${delBtn('planned_events', e.id)}</div>`).join('')}`;
    },
  },
  'my-brain': {
    id: 'my-brain', icon: '🧠', title: 'My Brain', hint: 'Everything Kira remembers about you — stored locally.',
    render() {
      const mems = store.get('memories', []);
      const goals = store.get('goals', []);
      const people = store.get('people', []);
      return `<div class="card"><div class="voice-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="mini-card"><div class="k">MEMORIES</div><div class="big">${mems.length}</div></div>
        <div class="mini-card"><div class="k">GOALS</div><div class="big">${goals.length}</div></div>
        <div class="mini-card"><div class="k">PEOPLE</div><div class="big">${people.length}</div></div></div></div>
      <div class="card"><form id="f-memory"><input class="field" name="text" placeholder="Remember this… (e.g. I like tea, not coffee)" required>
        <button class="btn" type="submit">＋ Add memory</button></form></div>
      <div class="card"><h3>Memories</h3>
        ${mems.length ? mems.map(m => `<div class="list-item"><div><div class="t">${esc(m.text)}</div><div class="s">${m.kind} · ${new Date(m.at).toLocaleDateString('en-GB')}</div></div>${delBtn('memories', m.id)}</div>`).join('') : emptyNote('No memories yet. Use "Get to know me" in Chats to add some.')}
      </div>`;
    },
  },
  people: {
    id: 'people', icon: '👥', title: 'People', hint: 'People Kira knows about.',
    render() {
      const ps = store.get('people', []);
      return `<div class="card"><form id="f-people">
        <label class="lbl">Name</label><input class="field" name="name" placeholder="e.g. Rahim" required>
        <label class="lbl">Relation</label><input class="field" name="relation" placeholder="e.g. Friend, Client">
        <label class="lbl">Note</label><input class="field" name="note" placeholder="e.g. Likes logo work">
        <button class="btn" type="submit">＋ Add person</button></form></div>
      <div class="card"><h3>People (${ps.length})</h3>
        ${ps.length ? ps.map(p => `<div class="list-item"><div><div class="t">${esc(p.name)}</div><div class="s">${esc(p.relation || '')}${p.note ? ' · ' + esc(p.note) : ''}</div></div>${delBtn('people', p.id)}</div>`).join('') : emptyNote('No people added yet.')}
      </div>`;
    },
  },
  'kira-cloud': {
    id: 'kira-cloud', icon: '☁️', title: 'Kira Cloud', hint: 'Backup and storage — everything is local on this device.',
    render() {
      let bytes = 0;
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); bytes += (localStorage.getItem(k) || '').length + (k || '').length; } } catch {}
      const kb = Math.max(1, Math.round(bytes / 1024));
      const pct = Math.min(100, Math.round((kb / 5120) * 100));
      return `<div class="card"><h3>Storage used</h3>
        <div class="progress"><div style="width:${pct}%"></div></div>
        <div class="s">${kb} KB of ~5 MB local storage used (${pct}%)</div></div>
      <div class="card"><h3>Backup</h3>
        <div class="btnrow"><button class="btn" data-act="cloud-export">⬇️ Export backup (JSON)</button>
        <label class="btn ghost" style="cursor:pointer">⬆️ Import backup<input type="file" accept="application/json" data-act-change="cloud-import" style="display:none"></label></div>
        <div class="note">Backup contains your chats, events, tasks, goals, notes and memories — all from this device only.</div></div>
      <div class="card"><h3>Plan</h3><div class="list-item" style="border:none;padding:0"><div><div class="t">Free</div><div class="s">Inactive · local only</div></div><span class="tag grey">Free</span></div></div>`;
    },
  },
  'my-workspace': {
    id: 'my-workspace', icon: '🖥️', title: 'My Workspace', hint: 'Notes and documents, saved locally.',
    render() {
      const notes = store.get('notes', []);
      return `<div class="card"><form id="f-note">
        <label class="lbl">Title</label><input class="field" name="title" placeholder="Note title" required>
        <label class="lbl">Body</label><textarea class="field" name="body" rows="4" placeholder="Write here…"></textarea>
        <button class="btn" type="submit">＋ Save note</button></form></div>
      ${notes.map(n => `<div class="card"><div class="list-item" style="border:none;padding:0"><div><div class="t">${esc(n.title)}</div><div class="s">${esc(n.body || '').slice(0, 120)}</div></div>${delBtn('notes', n.id)}</div></div>`).join('') || `<div class="card">${emptyNote('No notes yet.')}</div>`}`;
    },
  },
  tutors: {
    id: 'tutors', icon: '🎓', title: 'Tutors', hint: 'Pick a subject — Kira tutors you step by step.',
    render() {
      return `<div class="grid2">${TUTORS.map(s => `<button class="tile" data-act="tutor-open" data-v="${s}">🎓 ${s}</button>`).join('')}</div>
      <div class="note">Tutors open Homework with the subject ready. Full AI tutoring needs a Gemini key in Settings.</div>`;
    },
  },
  'agent-force': {
    id: 'agent-force', icon: '🕸️', title: 'Agent Force', hint: 'A 3-agent team: Researcher, Writer, Planner.',
    render() {
      const run = state.agentRun || null;
      return `<div class="card"><form id="f-agentforce">
        <label class="lbl">Task for the team</label><input class="field" name="task" placeholder="e.g. Plan a Fiverr promo week" required>
        <button class="btn" type="submit">▶ Run agent team</button></form></div>
      ${run ? `<div class="card"><h3>${esc(run.task)}</h3>
        ${['🔍 Researcher — gathered facts', '✍️ Writer — drafted the plan', '🗓️ Planner — ordered the steps'].map((s, i) => `<div class="list-item"><div class="t">${s}</div><span class="tag ${i < run.step ? 'green' : 'grey'}">${i < run.step ? 'Done ✓' : 'Waiting'}</span></div>`).join('')}
        ${run.step >= 3 ? `<div class="note">Result: ${esc(run.result)}</div>` : '<div class="muted">Working…</div>'}
      </div>` : ''}`;
    },
  },
  'ai-lawyer': {
    id: 'ai-lawyer', icon: '⚖️', title: 'AI Lawyer', hint: 'General legal information — not legal advice.',
    render() {
      const ans = state.lawyerAnswer || '';
      return `<div class="warn">⚠️ Kira is not a lawyer. Answers here are general information only — for real legal matters, consult a licensed lawyer.</div>
      <div class="card"><form id="f-lawyer">
        <label class="lbl">Your question</label><textarea class="field" name="q" rows="3" placeholder="e.g. What should a freelance contract include?" required></textarea>
        <button class="btn" type="submit">⚖️ Ask</button></form></div>
      ${ans ? `<div class="card"><div class="story">${esc(ans).split('\n').map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}`;
    },
  },
  'ai-consultants': {
    id: 'ai-consultants', icon: '👤', title: 'AI Consultants', hint: 'Seven specialist consultants — tap one to chat.',
    render() {
      return CONSULTANTS.map(c => `<div class="card"><div class="list-item" style="border:none;padding:0"><div><div class="t">${c.icon} ${c.name}</div><div class="s">Specialist advice</div></div>
        <button class="btn small" data-act="chat-persona" data-v="${c.id}">Chat</button></div></div>`).join('');
    },
  },
  'agent-link': {
    id: 'agent-link', icon: '🤖', title: 'Agent Link', hint: 'Share a link to your Kira agent.',
    render() {
      const link = 'https://kira.clone/a/abdur';
      return `<div class="card"><h3>Your agent link</h3>
        <input class="field" id="agentLinkField" value="${link}" readonly>
        <div class="btnrow"><button class="btn" data-act="copy-link" data-v="${link}">📋 Copy link</button></div>
        <div class="note">This is a local demo link for the clone. The real Kira app generates a live link on its own servers.</div></div>`;
    },
  },
  newbie: {
    id: 'newbie', icon: '○', title: 'Newbie', hint: 'New here? Start with the basics.',
    render() {
      return `<div class="card"><h3>Welcome to Kira 👋</h3><div class="story">
        <p>1. Add your free Gemini API key in Settings (gear icon) to unlock full AI chat.</p>
        <p>2. Try the quick chips in Chats — Goals, Creativity Spark, Web Research.</p>
        <p>3. Open Smart Calendar and add your first event.</p>
        <p>4. Ask Kira anything by voice — tap the glowing orb.</p></div></div>`;
    },
  },
  'cover-me': {
    id: 'cover-me', icon: '☂️', title: 'Cover me', hint: 'While you are away, Kira drafts replies for you.',
    render() {
      const cover = store.get('cover', false);
      return `<div class="card"><div class="switch-row"><div><b>Cover me</b><div class="muted">Auto-draft replies to new messages while you are away.</div></div>
        <button class="toggle ${cover ? 'on' : ''}" data-act="toggle-cover" aria-label="Cover me"></button></div>
        <div class="note" style="margin-top:12px">Status: <b>${cover ? 'ON — Kira is covering you' : 'Off'}</b>. Drafts are saved in Messages; nothing is sent automatically.</div></div>`;
    },
  },
  settings: {
    id: 'settings', icon: '⚙️', title: 'Settings', hint: 'Your key stays on this device only.',
    render() {
      return `<div class="card"><form id="f-settings">
        <label class="lbl">Gemini API key (free, from Google AI Studio)</label>
        <input class="field" type="password" name="gemini_key" value="${esc(GEMINI_KEY())}" placeholder="Paste your key">
        <label class="lbl">Preferred model</label>
        <select class="field" name="gemini_model">${MODELS.map(m => `<option ${GEMINI_MODEL() === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
        <label class="lbl">Voice language</label>
        <select class="field" name="voice_lang"><option value="bn-BD" ${state.voiceLang === 'bn-BD' ? 'selected' : ''}>Bengali (bn-BD)</option><option value="en-US" ${state.voiceLang === 'en-US' ? 'selected' : ''}>English (en-US)</option></select>
        <label class="lbl">Google OAuth client ID (Web application client)</label>
        <input class="field" name="google_client_id" value="${esc(googleClientId() === GOOGLE_CLIENT_ID_DEFAULT ? '' : googleClientId())}" placeholder="…apps.googleusercontent.com">
        <label class="lbl">Google client secret (optional, stays on this device)</label>
        <input class="field" type="password" name="google_client_secret" value="${esc(store.get('google_client_secret', '') || '')}" placeholder="GOCSPX-…">
        <div class="note">Create it in Google Cloud → Credentials → OAuth client ID → Web application, redirect URI https://razzakar133-cell.github.io/kira-clone/oauth.html. The client secret is normally injected at build time from the repo secret${googleBuiltInSecretActive() ? ' (built-in secret is active)' : ''}; the field above is only needed if this install was built without it. Without the ID + secret, Google sign-in shows "not configured".</div>
        <button class="btn" type="submit">Save settings</button></form></div>
      <div class="card"><h3>Google account</h3>
        ${isGoogleSignedIn() ? `<div class="list-item"><div><div class="t">👤 ${esc((googleTokens().name || 'Google account'))}</div><div class="s">${esc(googleTokens().email || '')} · read-only scopes</div></div>
        <button class="btn ghost small" data-act="google-signout">Sign out</button></div>`
        : `<div class="s">Not signed in.</div><div class="btnrow" style="margin-top:8px"><button class="btn small" data-act="google-signin">Sign in with Google</button></div>`}
      </div>
      <div class="card"><h3>Data</h3><div class="btnrow">
        <button class="btn ghost" data-act="cloud-export">⬇️ Export backup</button>
        <button class="btn danger" data-act="clear-all">🗑️ Clear all data</button></div></div>
      <div class="note">Kira clone v1.0 · Models: ${MODELS.join(', ')} · No passwords or OTPs are ever handled by this app.</div>`;
    },
  },
  'google-signin': {
    id: 'google-signin', icon: '🔍', title: 'Sign in with Google', hint: 'Paste the code from the Google redirect page.',
    render() {
      const url = state.googleManualUrl || '';
      return `<div class="card"><p class="s">Sign in with Google in the browser that just opened:</p>
      <label class="lbl">1. The Google sign-in link</label>
      <div class="field" style="word-break:break-all;white-space:normal">${esc(url)}</div>
      <div class="btnrow"><button class="btn small" data-act="copy-link" data-v="${esc(url)}">Copy link</button></div>
      <p class="s">2. After signing in, Google opens a page that shows your authorization code. Copy the code from that page and paste it below.</p>
      <form id="f-google-code"><label class="lbl">3. Paste the authorization code</label>
      <input class="field" name="code" placeholder="4/0A…" required>
      <button class="btn" type="submit">Complete sign-in</button></form></div>
      <div class="note">Your Google account is used read-only (Gmail, Drive, Calendar). Tokens stay on this device.</div>`;
    },
  },
  notifications: {
    id: 'notifications', icon: '🔔', title: 'Notifications', hint: 'Recent activity.',
    render() {
      const items = [
        { t: 'Morning brief is ready', s: 'Today · 8:00 AM' },
        { t: 'Kira is online', s: 'Your assistant is ready' },
        { t: 'Free plan active', s: '5,000,000 tokens · one-time (demo)' },
      ];
      return items.map(n => `<div class="card"><div class="t"><b>${esc(n.t)}</b></div><div class="s">${esc(n.s)}</div></div>`).join('');
    },
  },
  'analyse-docs': {
    id: 'analyse-docs', icon: '📄', title: 'Analyse Documents', hint: 'Paste text — Kira summarises it (needs a Gemini key for AI summary).',
    render() {
      const out = state.docSummary || '';
      return `<div class="card"><form id="f-doc">
        <label class="lbl">Paste document text</label><textarea class="field" name="text" rows="6" placeholder="Paste the document here…" required></textarea>
        <button class="btn" type="submit">📄 Summarise</button></form></div>
      ${out ? `<div class="card"><h3>Summary</h3><div class="story">${esc(out).split('\n').map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}`;
    },
  },
  'get-to-know-me': {
    id: 'get-to-know-me', icon: '👤', title: 'Get to know me', hint: 'Answer 3 questions — Kira remembers.',
    render() {
      return `<div class="card"><form id="f-knowme">
        <label class="lbl">1. What do you do?</label><input class="field" name="q1" placeholder="e.g. Graphic designer on Fiverr" required>
        <label class="lbl">2. What is your main goal right now?</label><input class="field" name="q2" placeholder="e.g. Reach Fiverr Level 1" required>
        <label class="lbl">3. One thing you like?</label><input class="field" name="q3" placeholder="e.g. Tea, football, design" required>
        <button class="btn" type="submit">💾 Remember me</button></form></div>
      <div class="note">Answers are saved as memories in My Brain, on this device only.</div>`;
    },
  },
  'deep-research': {
    id: 'deep-research', icon: '🧭', title: 'Deep Research', hint: 'A research outline on any topic. Uses Gemini when a key is saved.',
    render() {
      const out = state.researchOut || '';
      return `<div class="card"><form id="f-research">
        <label class="lbl">Research topic</label><input class="field" name="topic" placeholder="e.g. Best free AI video tools" required>
        <button class="btn" type="submit">🧭 Research</button></form></div>
      ${out ? `<div class="card"><div class="story">${esc(out).split('\n').map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}
      <div class="note">Honest note: this app has no live web search — the outline comes from the AI model itself, not fresh web pages.</div>`;
    },
  },
});

/* ---------- search (local data) ---------- */
MODULES.search = {
  id: 'search', icon: '🔍', title: 'Search', hint: 'Searches your events, tasks, goals, notes, memories and people — on this device.',
  render() {
    const q = (state.searchQ || '').toLowerCase();
    const hits = [];
    const push = (kind, text) => { if (!q || text.toLowerCase().includes(q)) hits.push({ kind, text }); };
    store.get('events', []).forEach(e => push('Event', e.title + ' · ' + fmtDate(e.date)));
    store.get('tasks', []).forEach(t => push('Task', t.title));
    store.get('goals', []).forEach(g => push('Goal', g.title));
    store.get('notes', []).forEach(n => push('Note', n.title + ' — ' + (n.body || '')));
    store.get('memories', []).forEach(m => push('Memory', m.text));
    store.get('people', []).forEach(p => push('Person', p.name + ' · ' + (p.relation || '')));
    return `<div class="card"><form id="f-search"><input class="field" name="q" placeholder="Search Kira…" value="${esc(state.searchQ || '')}">
      <button class="btn" type="submit">Search</button></form></div>
      <div class="card"><h3>${q ? 'Results for "' + esc(state.searchQ) + '"' : 'Everything'} (${hits.length})</h3>
      ${hits.length ? hits.map(h => `<div class="list-item"><span class="tag">${h.kind}</span><div style="flex:1">${esc(h.text)}</div></div>`).join('') : emptyNote(q ? 'Nothing found.' : 'Type something to search.')}
      </div>`;
  },
};

/* ---------- toast ---------- */
function toast(msg) {
  state.toast = msg; render();
  setTimeout(() => { state.toast = ''; const t = $('#toast'); if (t) t.remove(); }, 2600);
}

/* ---------- form handlers ---------- */
function fd(form) { return new FormData(form); }
const FORMS = {
  'chatForm'(f) { sendChat(f.get('chatInput') || ''); },
  'keyForm'(f) { const k = (f.get('gemini_key') || '').trim(); if (k) { store.set('gemini_key', k); toast('Gemini key saved on this device.'); render(); } },
  'f-conn-key'(f, form) {
    const id = form && form.dataset ? form.dataset.conn : '';
    const k = (f.get('key') || '').trim();
    if (!id || !k) return;
    store.set('key_' + id, k);
    const con = connState(); con[id] = 'key'; connSetState(con);
    state.connKeyFor = null;
    toast('API key saved on this device.');
    render();
  },
  'f-settings'(f) {
    const k = (f.get('gemini_key') || '').trim();
    store.set('gemini_key', k);
    store.set('gemini_model', f.get('gemini_model') || MODELS[0]);
    store.set('google_client_id', (f.get('google_client_id') || '').trim());
    store.set('google_client_secret', (f.get('google_client_secret') || '').trim());
    state.voiceLang = f.get('voice_lang') || 'bn-BD'; store.set('voice_lang', state.voiceLang);
    toast('Settings saved.'); render();
  },
  'f-google-code'(f) {
    const code = (f.get('code') || '').trim();
    if (!code) return;
    exchangeGoogleCode(code).then(() => {
      const t = googleTokens();
      toast('Signed in with Google' + (t && t.email ? ' as ' + t.email : '') + '.');
      closeModule();
    }).catch(() => toast('That code did not work — try signing in again.'));
  },
  'f-cal-add'(f) { const evs = store.get('events', []); evs.push({ id: uid(), title: f.get('title').trim(), date: f.get('date'), time: f.get('time') || '' }); store.set('events', evs); render(); },
  'f-rem-add'(f) { const r = store.get('reminders', []); r.push({ id: uid(), text: f.get('text').trim(), time: f.get('time') || '' }); store.set('reminders', r); render(); },
  'f-task-add'(f) { const t = store.get('tasks', []); t.push({ id: uid(), title: f.get('title').trim(), done: false }); store.set('tasks', t); render(); },
  'f-goal-add'(f) { const g = store.get('goals', []); g.push({ id: uid(), title: f.get('title').trim(), progress: 0 }); store.set('goals', g); render(); },
  'f-email'(f) { const d = store.get('emails', []); d.push({ id: uid(), to: f.get('to').trim(), subject: f.get('subject').trim(), body: f.get('body') }); store.set('emails', d); toast('Draft saved.'); render(); },
  'f-call'(f) { const c = store.get('calls', []); c.push({ id: uid(), name: f.get('name').trim(), phone: f.get('phone').trim(), purpose: f.get('purpose').trim(), when: f.get('when') || '' }); store.set('calls', c); render(); },
  'f-msg'(f) { const m = store.get('msg_saved', []); m.push({ id: uid(), platform: f.get('platform'), body: f.get('body').trim() }); store.set('msg_saved', m); toast('Message saved locally.'); render(); },
  'f-wf'(f) { const w = store.get('workflows', []); w.push({ id: uid(), trigger: f.get('trigger'), action: f.get('action'), on: true }); store.set('workflows', w); render(); },
  'f-lead'(f) { const l = store.get('leads', []); l.push({ id: uid(), name: f.get('name').trim(), email: f.get('email').trim(), interest: f.get('interest') || '' }); store.set('leads', l); render(); },
  'f-social'(f) { const p = store.get('social_posts', []); p.push({ id: uid(), platform: f.get('platform'), body: f.get('body').trim() }); store.set('social_posts', p); toast('Post saved locally (not published).'); render(); },
  'f-shop'(f) { const s = store.get('shop', []); s.push({ id: uid(), item: f.get('item').trim(), price: f.get('price') || '0', shop: f.get('shop') || '' }); store.set('shop', s); render(); },
  'f-people'(f) { const p = store.get('people', []); p.push({ id: uid(), name: f.get('name').trim(), relation: f.get('relation') || '', note: f.get('note') || '' }); store.set('people', p); render(); },
  'f-memory'(f) { addMemory(f.get('text').trim(), 'note'); toast('Memory saved.'); render(); },
  'f-note'(f) { const n = store.get('notes', []); n.push({ id: uid(), title: f.get('title').trim(), body: f.get('body') || '' }); store.set('notes', n); render(); },
  'f-bizcard'(f) { store.set('bizcard', { name: f.get('name').trim(), role: f.get('role') || '', phone: f.get('phone') || '', email: f.get('email') || '' }); toast('Card saved.'); render(); },
  'f-vision'(f) { const v = store.get('vision', []); v.push({ id: uid(), url: f.get('url').trim(), caption: f.get('caption') || '' }); store.set('vision', v); render(); },
  'f-event'(f) { const e = store.get('planned_events', []); e.push({ id: uid(), name: f.get('name').trim(), date: f.get('date'), budget: f.get('budget') || '', checks: [false, false, false, false] }); store.set('planned_events', e); render(); },
  'f-meeting'(f) {
    const actions = (f.get('actions') || '').split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ text, done: false }));
    const m = store.get('meetings', []); m.push({ id: uid(), title: f.get('title').trim(), notes: f.get('notes') || '', actions }); store.set('meetings', m); render();
  },
  'f-knowme'(f) {
    addMemory('I am ' + f.get('q1').trim(), 'about');
    addMemory('My main goal: ' + f.get('q2').trim(), 'goal');
    addMemory('I like: ' + f.get('q3').trim(), 'like');
    toast('Saved to My Brain.'); openModule('my-brain');
  },
  'f-search'(f) { state.searchQ = f.get('q') || ''; render(); },
  'f-web-open'(f) { let u = (f.get('url') || '').trim(); if (!/^https?:\/\//i.test(u)) u = 'https://' + u; state.browserUrl = u; render(); },
  'f-img'(f) {
    const prompt = f.get('prompt').trim();
    state.genImage = { url: `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&seed=${Math.floor(Math.random() * 100000)}`, prompt };
    render();
  },
  async 'f-meal'(f) {
    const type = f.get('type'), budget = f.get('budget') || '300';
    const out = $('#mealOut'); if (out) out.innerHTML = '<div class="card"><div class="typing">Making your plan…</div></div>';
    let days;
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      const r = await callGemini(`Make a 7-day ${type.toLowerCase()} Bengali-friendly meal plan (lunch + dinner each day), budget ৳${budget} per day. One short line per day.`, 'You are Kira meal planner.');
      days = r.text.split('\n').map(s => s.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean).slice(0, 7);
      while (days.length < 7) days.push('Rice, dal, vegetables and egg curry.');
    } catch {
      const veg = ['Rice, dal, mixed vegetables, salad', 'Khichuri with vegetables and egg', 'Rice, vegetable curry, dal, salad', 'Vegetable biryani with raita', 'Rice, dal, potato curry, salad', 'Khichuri, vegetables, papad', 'Rice, mixed veg, dal, fruit'];
      const nonveg = ['Rice, chicken curry, dal, salad', 'Beef bhuna, rice, dal', 'Fish curry, rice, vegetables', 'Chicken biryani with salad', 'Rice, fish fry, dal, vegetables', 'Egg curry, rice, salad', 'Mutton curry, rice, dal'];
      days = type === 'Veg' ? veg : type === 'Non-veg' ? nonveg : veg.map((v, i) => (i % 2 ? nonveg[i] : v));
    }
    store.set('meal_plan', { type, budget, days }); render();
  },
  async 'f-trip'(f) {
    const dest = f.get('dest').trim(), days = +f.get('days') || 3, budget = f.get('budget') || '15000';
    const out = $('#tripOut'); if (out) out.innerHTML = '<div class="card"><div class="typing">Planning your trip…</div></div>';
    let text;
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      text = (await callGemini(`Build a ${days}-day trip itinerary for ${dest}, Bangladesh, budget ৳${budget} total. Day by day: places, food, transport, cost. Keep it short.`, 'You are Kira travel planner.')).text;
    } catch {
      const lines = [];
      for (let i = 1; i <= days; i++) lines.push(`Day ${i}: Explore ${dest} — morning sightseeing, local lunch, afternoon rest, evening walk and local food. Budget about ৳${Math.round(budget / days)} for the day.`);
      text = lines.join('\n');
    }
    store.set('trip_plan', { dest, days, budget, text }); render();
  },
  async 'f-hw'(f) {
    const q = f.get('q').trim(), subject = f.get('subject');
    state.hwSubject = subject;
    state.hwAnswer = 'Thinking…'; render();
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      state.hwAnswer = (await callGemini(q, `You are Homework Bot. Explain this ${subject} question step by step, simply, in the language the user writes.`)).text;
    } catch {
      state.hwAnswer = 'To explain this step by step I need your free Gemini API key (Settings). Quick start: 1) Read the question carefully. 2) Write down what is given and what to find. 3) Pick the right formula or rule. 4) Solve one small step at a time. 5) Check your answer. Paste the question again after adding the key and I will solve it fully.';
    }
    render();
  },
  async 'f-story'(f) {
    const topic = f.get('topic').trim();
    state.storyText = 'Writing your story…'; render();
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      state.storyText = (await callGemini(`Write a short, warm story (about 200 words) about: ${topic}.`, 'You are Kira Story Teller.')).text;
    } catch {
      state.storyText = `Once, in a small town, there was a dreamer who loved ${topic}. Every morning they worked a little, learned a little, and helped someone a little. Slowly, step by step, the dream grew — not because of one big moment, but because of many small ones. And that is how every good story begins: with a first small step, taken today.`;
    }
    render();
  },
  async 'f-lawyer'(f) {
    const q = f.get('q').trim();
    state.lawyerAnswer = 'Thinking…'; render();
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      state.lawyerAnswer = (await callGemini(q, 'You are an AI legal-information assistant. Give general information only, in simple words, and remind the user this is not legal advice.')).text;
    } catch {
      state.lawyerAnswer = 'General information: a freelance contract should usually include the scope of work, price and payment terms, delivery time, revision limits, and who owns the final files. This is general information, not legal advice — for a real matter, please consult a licensed lawyer. (Add a Gemini key in Settings for fuller answers.)';
    }
    render();
  },
  async 'f-doc'(f) {
    const text = f.get('text').trim();
    state.docSummary = 'Summarising…'; render();
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      state.docSummary = (await callGemini('Summarise this document in 5 short bullet points:\n\n' + text, 'You are Kira. Summarise clearly.')).text;
    } catch {
      const sents = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      state.docSummary = 'Quick summary (without AI key):\n' + sents.slice(0, 3).map(s => '• ' + s).join('\n') + `\n\n(${sents.length} sentences, ${text.length} characters.) Add a Gemini key for a full AI summary.`;
    }
    render();
  },
  async 'f-research'(f) {
    const topic = f.get('topic').trim();
    state.researchOut = 'Researching…'; render();
    try {
      if (!GEMINI_KEY()) throw new Error('no-key');
      state.researchOut = (await callGemini(`Make a research outline about: ${topic}. Include: key facts, pros and cons, practical steps, and what to check next.`, 'You are Kira Deep Research.')).text;
    } catch {
      state.researchOut = `Research outline: ${topic}\n\n1. What it is — key facts and background.\n2. Main options — compare the top 3-4 choices.\n3. Pros and cons of each.\n4. Practical first steps for abdur.\n5. What to verify next (prices and limits change often).\n\n(Add a Gemini key in Settings for a full AI research brief. Note: this app has no live web search.)`;
    }
    render();
  },
  'f-lens'(f) {
    const file = f.get('photo');
    if (!file || !file.name) { toast('Choose a photo first.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      state.lens = { dataUrl: reader.result, desc: `Photo: ${file.name} (${Math.round(file.size / 1024)} KB, ${file.type || 'image'}). ${GEMINI_KEY() ? 'AI description needs a vision call — the key is saved, but this build describes photos from file info only.' : 'Add a Gemini key in Settings for an AI description of the photo.'}` };
      render();
    };
    try { reader.readAsDataURL(file); } catch { toast('Could not read the photo.'); }
  },
  'f-agentforce'(f) {
    const task = f.get('task').trim();
    state.agentRun = { task, step: 0, result: '' };
    render();
    const steps = [1, 2, 3];
    steps.forEach((s, i) => setTimeout(() => {
      state.agentRun.step = s;
      if (s === 3) state.agentRun.result = `Done: ${task} — research gathered, draft written, steps ordered. Next: pick the first step and do it today.`;
      render();
    }, 600 * (i + 1)));
  },
};

/* ---------- click actions ---------- */
const ACTS = {
  back() { closeModule(); },
  'open-settings'() { openModule('settings'); },
  'open-notifs'() { openModule('notifications'); },
  'open-drawer'() { state.drawer = true; render(); },
  'close-drawer'() { state.drawer = false; render(); },
  'drawer-tab'(el) { state.drawerTab = el.dataset.v; render(); },
  'new-chat'() { state.chatHist = []; state.persona = null; saveChat(); state.drawer = false; render(); },
  'search-chats'() { state.drawer = false; openModule('search'); },
  'load-chat'(el) { state.drawer = false; state.tab = 'chats'; render(); const inp = $('#chatInput'); if (inp) { inp.value = el.dataset.v; inp.focus(); } },
  'clear-persona'() { state.persona = null; render(); },
  'chat-attach'() { openModule('kira-lens'); },
  'voice-mic'() { startVoice(); },
  'voice-graph'() { goTab('home'); },
  'voice-avatar'() { toast('Avatar calls are a Kira premium feature — this clone shows the Voice screen instead.'); },
  'chip-goals'() { chipAction('goals'); },
  'chip-docs'() { chipAction('docs'); },
  'chip-spark'() { chipAction('spark'); },
  'chip-knowme'() { chipAction('knowme'); },
  'chip-research'() { chipAction('research'); },
  'toggle-cover'() { const v = !store.get('cover', false); store.set('cover', v); toast(v ? 'Cover me is ON.' : 'Cover me is off.'); render(); },
  'pin-menu'() {
    const extra = ['homework', 'ai-shopping', 'travel-planner', 'image-gen'].filter(id => !state.pinned.includes(id));
    if (extra.length) { state.pinned.push(extra[0]); toast(MODULES[extra[0]].title + ' pinned to Home.'); }
    else { state.pinned = ['messages', 'smart-calendar', 'meal-planner']; toast('Pinned menu reset.'); }
    store.set('pinned', state.pinned); render();
  },
  'search-brief'() { openModule('search'); },
  'close-sheet'() { closeSheet(); },
  'locked-tile'() { toast('This unlocks after you finish your first task.'); },
  'run-task'(el) {
    const tasks = store.get('tasks', []); const t = tasks.find(x => x.id === el.dataset.id);
    if (t) { t.done = !t.done; if (t.done) state.stats.tasksRun++; saveStats(); store.set('tasks', tasks); }
    render();
  },
  'run-all-tasks'() {
    const tasks = store.get('tasks', []); let n = 0;
    tasks.forEach(t => { if (!t.done) { t.done = true; n++; } });
    state.stats.tasksRun += n; saveStats(); store.set('tasks', tasks);
    toast(n ? n + ' task(s) completed.' : 'No pending tasks.'); render();
  },
  'auto-draft'(el) {
    const threads = store.get('threads', []); const th = threads.find(x => x.id === el.dataset.id);
    const tpl = ['Hi! Thanks for your message. I am busy right now and will reply within an hour. — abdur', 'Hello! I received your message. I will get back to you today. — abdur', 'Thanks for reaching out! For design orders, please share your details and I will reply with a quote. — abdur'][store.get('receptionist_tpl', 0)];
    if (th) { th.replies = th.replies || []; th.replies.push(tpl); store.set('threads', threads); toast('Draft reply added.'); render(); }
  },
  'web-open'(el) { state.browserUrl = el.dataset.v; render(); },
  'email-send-note'() { toast('Real sending needs Gmail connected in Integrations. Draft is saved locally.'); },
  'msg-connect'(el) { const c = store.get('msg_conn', {}); const p = el.dataset.v; if (c[p]) delete c[p]; else c[p] = 'demo'; store.set('msg_conn', c); render(); },
  'int-connect'(el) {
    const id = el.dataset.v;
    if (GOOGLE_IDS.includes(id)) {
      const con = store.get('integrations', {});
      if (con[id] === 'google' && isGoogleSignedIn()) { googleSignOut(); return; }
      startGoogleSignIn();
      return;
    }
    const c = store.get('integrations', {}); if (c[id]) delete c[id]; else c[id] = 'demo'; store.set('integrations', c); render();
  },
  'int-open'(el) {
    const it = INTEGRATIONS.find(x => x.id === el.dataset.v);
    if (!it || !it.link) return;
    toast('Opening Jewel — your personal agent.');
    if (isNativeApp()) { Browser.open({ url: it.link }).catch(() => {}); }
    else { try { window.open(it.link, '_blank'); } catch {} }
  },
  'conn-google'(el) {
    // Google-kind connectors reuse the existing real Google OAuth flow.
    if (isGoogleSignedIn()) { googleSignOut(); return; }
    startGoogleSignIn();
  },
  'conn-open'(el) {
    const c = CONNECTORS.find(x => x.id === el.dataset.v);
    if (!c) return;
    const con = connState(); con[c.id] = 'opened'; connSetState(con);
    openConnUrl(c.url);
    toast('Opened ' + c.name + '.');
    render();
  },
  'conn-key-open'(el) { state.connKeyFor = el.dataset.v; render(); },
  'conn-key-del'(el) {
    const id = el.dataset.v;
    store.del('key_' + id);
    const con = connState(); delete con[id]; connSetState(con);
    if (state.connKeyFor === id) state.connKeyFor = null;
    toast('API key removed.');
    render();
  },
  'google-signin'() { startGoogleSignIn(); },
  'google-signout'() { googleSignOut(); },
  'wf-toggle'(el) { const w = store.get('workflows', []); const it = w.find(x => x.id === el.dataset.id); if (it) { it.on = !it.on; store.set('workflows', w); render(); } },
  'social-resume'() { const cur = store.get('social_agent', 'paused'); store.set('social_agent', cur === 'paused' ? 'running' : 'paused'); toast(cur === 'paused' ? 'Agent resumed (demo).' : 'Agent paused.'); render(); },
  'social-connect'(el) { const c = store.get('social_conn', {}); const id = el.dataset.v; if (c[id]) delete c[id]; else c[id] = 'demo'; store.set('social_conn', c); render(); },
  'img-motion'() { const img = $('#genImg'); if (img) { img.classList.toggle('kb'); toast('Motion effect on — Ken Burns zoom/pan.'); } },
  'chat-persona'(el) {
    const bot = KBOTS.find(b => b.id === el.dataset.v);
    const con = CONSULTANTS.find(c => c.id === el.dataset.v);
    const p = bot || con;
    if (p) { state.persona = { name: p.name, sys: p.sys }; state.tab = 'chats'; state.module = null; render(); }
  },
  'tutor-open'(el) { state.hwSubject = el.dataset.v; openModule('homework'); },
  'copy-link'(el) {
    const v = el.dataset.v;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(() => toast('Link copied.')).catch(() => toast('Link: ' + v));
    else toast('Link: ' + v);
  },
  'cloud-export'() {
    const data = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('kira_')) data[k] = localStorage.getItem(k); } } catch {}
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'kira-backup.json'; a.click();
    toast('Backup downloaded.');
  },
  'clear-all'() {
    try { Object.keys(localStorage).filter(k => k.startsWith('kira_')).forEach(k => localStorage.removeItem(k)); } catch {}
    state.chatHist = []; state.persona = null; state.pinned = ['messages', 'smart-calendar', 'meal-planner'];
    toast('All Kira data cleared.'); render();
  },
  del(el) {
    const items = store.get(el.dataset.key, []);
    store.set(el.dataset.key, items.filter(x => x.id !== el.dataset.id));
    render();
  },
};

/* ---------- change actions ---------- */
const CHANGES = {
  'model-pick'(el) { store.set('gemini_model', el.value); toast('Model: ' + el.value); },
  'goal-progress'(el) {
    const g = store.get('goals', []); const it = g.find(x => x.id === el.dataset.id);
    if (it) { it.progress = +el.value; store.set('goals', g); render(); }
  },
  'receptionist-tpl'(el) { store.set('receptionist_tpl', +el.dataset.v); render(); },
  'meeting-action'(el) {
    const ms = store.get('meetings', []); const m = ms.find(x => x.id === el.dataset.id);
    if (m && m.actions[+el.dataset.v]) { m.actions[+el.dataset.v].done = el.checked; store.set('meetings', ms); render(); }
  },
  'event-check'(el) {
    const evs = store.get('planned_events', []); const e = evs.find(x => x.id === el.dataset.id);
    if (e) { e.checks = e.checks || [false, false, false, false]; e.checks[+el.dataset.v] = el.checked; store.set('planned_events', evs); render(); }
  },
  'cloud-import'(el) {
    const file = el.files && el.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        Object.keys(data).forEach(k => { if (k.startsWith('kira_')) localStorage.setItem(k, data[k]); });
        toast('Backup imported.'); render();
      } catch { toast('Invalid backup file.'); }
    };
    reader.readAsText(file);
  },
};

/* ---------- input actions (live, no submit) ---------- */
const INPUTS = {
  'conn-search'(el) {
    state.connSearch = el.value || '';
    filterConnectorRows();
  },
};

/* ---------- global listeners ---------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { goTab(nav.dataset.nav); return; }
  const open = e.target.closest('[data-open]');
  if (open) { openModule(open.dataset.open); return; }
  const actEl = e.target.closest('[data-act]');
  if (actEl && ACTS[actEl.dataset.act]) { ACTS[actEl.dataset.act](actEl, e); }
});
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.classList && f.classList.contains('reply-form')) {
    e.preventDefault();
    const threads = store.get('threads', []);
    const th = threads.find(x => x.id === f.dataset.thread);
    const input = f.querySelector('[name=reply]');
    if (th && input && input.value.trim()) { th.replies = th.replies || []; th.replies.push(input.value.trim()); store.set('threads', threads); render(); }
    return;
  }
  if (FORMS[f.id]) { e.preventDefault(); FORMS[f.id](new FormData(f), f); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act-change]');
  if (el && CHANGES[el.dataset.actChange]) CHANGES[el.dataset.actChange](el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-act-input]');
  if (el && INPUTS[el.dataset.actInput]) INPUTS[el.dataset.actInput](el, e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { state.sheet = null; state.drawer = false; render(); } });

/* ---------- boot ---------- */
render();
