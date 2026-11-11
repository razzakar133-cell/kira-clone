// kira-oauth — Cloudflare Worker for Kira Clone (draft prepared 2026-11-10)
// Paste into the Cloudflare dashboard: Workers & Pages > kira-oauth > Edit code > Deploy.
// NO secrets in this file. Secrets live as Worker env vars (dashboard: Settings > Variables):
//   GH_CLIENT_SECRET  — already set (GitHub OAuth App "Kira Clone"); DO NOT delete/replace.
//   NOTION_TOKEN      — NEW: the "Internal Integration Secret" of the Notion
//                       integration "Kira Clone" in workspace "abdur razzak's Space"
//                       (notion.so/my-integrations). Regenerate it there first —
//                       the old token lived only in the dead 2026-11-09 browser task
//                       and is presumed lost (Notion shows it once).
//   SLACK_BOT_TOKEN   — NEW: the Bot User OAuth Token (xoxb-...) of the Slack
//                       app for Kira Clone (api.slack.com/apps → the app →
//                       OAuth & Permissions → Install App). The bot must be
//                       invited to each channel it should read/post in.
//   DROPBOX_CLIENT_ID, DROPBOX_CLIENT_SECRET, DROPBOX_REFRESH_TOKEN
//                       — the Dropbox OAuth app (dropbox.com/developers → the
//                       app → scoped access, files.content.read). The refresh
//                       token is exchanged server-side for a short-lived
//                       access token; the app never sees any of the three.
//   TELEGRAM_BOT_TOKEN  — NEW: the bot token from BotFather in the user's
//                       Telegram app (t.me/BotFather → /newbot). The bot only
//                       sees messages sent after it was messaged or added to
//                       a group; old history is never visible to it.
//
// App contract (~/workspace/kira-clone/src/main.js):
//   GitHub: POST { provider:'github', code, redirect_uri } -> { access_token, ... }
//           (client_id Ov23licDE7nLwFTa3Tky, redirect
//            https://razzakar133-cell.github.io/kira-clone/oauth.html)
//   Notion: POST { provider:'notion', path, method, body } -> Notion API JSON
//           (app calls /search POST {page_size:10} and /blocks/<id>/children GET;
//            if NOTION_TOKEN is missing, reply { error:'not_configured' } —
//            the app shows its Bengali "not set up yet" state on that string.)
//   Slack:  POST { provider:'slack', path, method, body } -> Slack API JSON
//           (app calls /conversations.list GET, /conversations.history GET,
//            /users.info GET and /chat.postMessage POST; GET params ride in
//            `body` and are turned into a query string server-side;
//            if SLACK_BOT_TOKEN is missing, reply { error:'not_configured' }.)
//   Dropbox: POST { provider:'dropbox', path, method, body } -> Dropbox API JSON
//           (app calls /2/files/list_folder POST {path} and
//            /2/files/get_temporary_link POST {path}; the Worker exchanges
//            DROPBOX_REFRESH_TOKEN for a short-lived access token first
//            (cached in this isolate until shortly before expiry);
//            if any Dropbox env var is missing, reply { error:'not_configured' }.)
//   Telegram: POST { provider:'telegram', path, method, body } -> Telegram Bot API JSON
//           (app calls getUpdates GET {limit:20} and sendMessage POST
//            {chat_id, text}; path is the Bot API method name WITHOUT a
//            leading slash; GET params ride in `body` and are turned into
//            a query string server-side; if TELEGRAM_BOT_TOKEN is missing,
//            reply { error:'not_configured' }.)

const GITHUB_CLIENT_ID = 'Ov23licDE7nLwFTa3Tky';
const NOTION_VERSION = '2022-06-28';

// Dropbox access token cache (module-level, per isolate): the refresh-token
// exchange is only done again once the cached token is about to expire.
let dropboxAccess = null; // { token, expiresAt }
async function dropboxAccessToken(env) {
  const now = Date.now();
  if (dropboxAccess && dropboxAccess.expiresAt > now + 60000) return dropboxAccess.token;
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.DROPBOX_REFRESH_TOKEN,
      client_id: env.DROPBOX_CLIENT_ID,
      client_secret: env.DROPBOX_CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  dropboxAccess = { token: data.access_token, expiresAt: now + (data.expires_in || 14400) * 1000 };
  return dropboxAccess.token;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }
    let payload = {};
    try { payload = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

    if (payload.provider === 'github') {
      if (!env.GH_CLIENT_SECRET) return json({ error: 'not_configured' }, 500);
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: env.GH_CLIENT_SECRET,
          code: payload.code,
          redirect_uri: payload.redirect_uri,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) return json({ error: data.error || 'token-exchange-failed' }, 400);
      return json(data);
    }

    if (payload.provider === 'notion') {
      if (!env.NOTION_TOKEN) return json({ error: 'not_configured' });
      const path = String(payload.path || '/search');
      if (!path.startsWith('/')) return json({ error: 'bad_path' }, 400);
      const res = await fetch('https://api.notion.com/v1' + path, {
        method: payload.method || 'GET',
        headers: {
          Authorization: 'Bearer ' + env.NOTION_TOKEN,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: payload.body ? JSON.stringify(payload.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: data.message || 'notion_error', status: res.status }, res.status);
      return json(data);
    }

    if (payload.provider === 'slack') {
      if (!env.SLACK_BOT_TOKEN) return json({ error: 'not_configured' });
      const path = String(payload.path || '/conversations.list');
      if (!path.startsWith('/')) return json({ error: 'bad_path' }, 400);
      let url = 'https://slack.com/api' + path;
      // GET calls carry their params in `body` — turn them into a query string.
      if ((payload.method || 'GET') === 'GET' && payload.body && typeof payload.body === 'object') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(payload.body)) {
          if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        const s = qs.toString();
        if (s) url += (url.includes('?') ? '&' : '?') + s;
      }
      const res = await fetch(url, {
        method: payload.method || 'GET',
        headers: {
          Authorization: 'Bearer ' + env.SLACK_BOT_TOKEN,
          'Content-Type': 'application/json',
        },
        body: payload.method === 'POST' && payload.body ? JSON.stringify(payload.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: data.error || 'slack_error', status: res.status }, res.status);
      if (data && data.ok === false) return json({ error: data.error || 'slack_error' }, 400);
      return json(data);
    }

    if (payload.provider === 'dropbox') {
      if (!env.DROPBOX_CLIENT_ID || !env.DROPBOX_CLIENT_SECRET || !env.DROPBOX_REFRESH_TOKEN) {
        return json({ error: 'not_configured' });
      }
      const token = await dropboxAccessToken(env);
      if (!token) return json({ error: 'token_refresh_failed' }, 400);
      const path = String(payload.path || '/2/files/list_folder');
      if (!path.startsWith('/')) return json({ error: 'bad_path' }, 400);
      const res = await fetch('https://api.dropboxapi.com' + path, {
        method: payload.method || 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: payload.body ? JSON.stringify(payload.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: (data.error_summary || data.error || 'dropbox_error'), status: res.status }, res.status);
      return json(data);
    }

    if (payload.provider === 'telegram') {
      if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'not_configured' });
      const path = String(payload.path || 'getUpdates');
      if (!path || path.startsWith('/') || path.includes('?') || path.includes('..')) {
        return json({ error: 'bad_path' }, 400);
      }
      let url = 'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + path;
      // GET calls carry their params in `body` — turn them into a query string.
      if ((payload.method || 'GET') === 'GET' && payload.body && typeof payload.body === 'object') {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(payload.body)) {
          if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        const s = qs.toString();
        if (s) url += (url.includes('?') ? '&' : '?') + s;
      }
      const res = await fetch(url, {
        method: payload.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: payload.method === 'POST' && payload.body ? JSON.stringify(payload.body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return json({ error: data.description || 'telegram_error', status: res.status }, res.status);
      if (data && data.ok === false) return json({ error: data.description || 'telegram_error' }, 400);
      return json(data);
    }

    return json({ error: 'unknown_provider' }, 400);
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
