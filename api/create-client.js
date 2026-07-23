// Owner-only: create a new client login + profile.
// The owner sets the client's email + a starting password; the client can
// change it later. Uses the service-role key so it can create the auth user.
const { requireOwner, readJson, send } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const { admin } = await requireOwner(req);
    const body = await readJson(req);
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const full_name = (body.full_name || '').trim();
    const company = (body.company || '').trim();
    const phone = (body.phone || '').trim();

    if (!email || !password) return send(res, 400, { error: 'Email and a starting password are required.' });
    if (password.length < 6) return send(res, 400, { error: 'Password must be at least 6 characters.' });

    // Create the auth user (auto-confirmed so they can log in immediately).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name, company }
    });
    if (cErr) return send(res, 400, { error: cErr.message });

    // Create their profile row (role = client).
    const { error: pErr } = await admin.from('profiles').insert({
      id: created.user.id, role: 'client', full_name, company, email, phone
    });
    if (pErr) {
      // Roll back the auth user if the profile insert failed.
      await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
      return send(res, 400, { error: pErr.message });
    }

    send(res, 200, { ok: true, id: created.user.id });
  } catch (e) {
    send(res, e.status || 500, { error: e.message || 'Server error' });
  }
};
