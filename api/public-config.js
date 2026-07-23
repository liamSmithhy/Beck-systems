// Returns the PUBLIC Supabase config the browser needs (safe to expose:
// the anon key is designed to be public and is protected by row-level security).
const { URL, ANON, send } = require('./_lib');

module.exports = async (req, res) => {
  if (!URL || !ANON) {
    return send(res, 500, { error: 'Supabase is not configured yet. Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.' });
  }
  send(res, 200, { supabaseUrl: URL, supabaseAnonKey: ANON });
};
