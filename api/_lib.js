// Shared helpers for the serverless API functions.
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Admin client — bypasses RLS. Only ever used server-side, never exposed.
function adminClient() {
  if (!URL || !SERVICE) throw new Error('Supabase env vars are not configured.');
  return createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Read the caller's bearer token, verify it, and return their profile.
// Returns { user, profile } or throws.
async function requireUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) { const e = new Error('Not signed in.'); e.status = 401; throw e; }

  const admin = adminClient();
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData || !userData.user) { const e = new Error('Invalid session.'); e.status = 401; throw e; }

  const { data: profile } = await admin
    .from('profiles').select('*').eq('id', userData.user.id).single();

  return { user: userData.user, profile: profile || null, admin };
}

async function requireOwner(req) {
  const ctx = await requireUser(req);
  if (!ctx.profile || ctx.profile.role !== 'owner') {
    const e = new Error('Owner access required.'); e.status = 403; throw e;
  }
  return ctx;
}

function readJson(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

function send(res, status, obj) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = { adminClient, requireUser, requireOwner, readJson, send, URL, ANON };
