/* ============================================================================
   BECK SYSTEMS — Client & Project Portal (front-end app)
   Talks to Supabase (data + auth, protected by row-level security) and to the
   serverless API for admin actions and Stripe. No secrets live in this file.
   ============================================================================ */
(function () {
  'use strict';

  var OWNER_USERNAME = 'BeckSystems';
  var OWNER_EMAIL = 'owner@becksystems.studio';

  var db = null;          // supabase client
  var session = null;     // current auth session
  var me = null;          // my profile row
  var app = document.getElementById('app');

  /* ---------- tiny helpers ---------- */
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(cents, cur) { return (cur === 'usd' || !cur ? '$' : '') + (Number(cents || 0) / 100).toFixed(2); }
  function fdate(d) { if (!d) return '—'; try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return d; } }
  function h(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function toast(msg, bad) {
    var t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
    document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 400); }, 2800);
  }
  function statusChip(status) {
    var map = {
      active: ['info', 'Active'], paused: ['warn', 'Paused'], launched: ['ok', 'Launched'], archived: ['', 'Archived'],
      open: ['warn', 'Open'], in_progress: ['info', 'In progress'], resolved: ['ok', 'Resolved'], closed: ['ok', 'Closed'],
      done: ['ok', 'Done'], pending: ['', 'Pending'],
      draft: ['', 'Draft'], sent: ['warn', 'Sent'], paid: ['ok', 'Paid'], void: ['bad', 'Void'], signed: ['ok', 'Signed'],
      live: ['ok', 'Live'], building: ['warn', 'Building'], not_deployed: ['', 'Not deployed'], error: ['bad', 'Error']
    };
    var m = map[status] || ['', status || '—'];
    return '<span class="chip ' + m[0] + '">' + esc(m[1]) + '</span>';
  }
  function typeChip(t) {
    var m = { feedback: ['info', 'Feedback'], copy: ['uv', 'Copy change'], bug: ['bad', 'Bug'] }[t] || ['', t];
    return '<span class="chip ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  async function authFetch(path, body) {
    var res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (session ? session.access_token : '') },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ---------- boot ---------- */
  async function boot() {
    var cfg;
    try {
      cfg = await (await fetch('/api/public-config')).json();
      if (cfg.error) throw new Error(cfg.error);
    } catch (e) {
      app.innerHTML = '<div class="auth-wrap"><div class="auth-card"><h1>Almost there</h1>' +
        '<p class="auth-sub">The portal backend isn\'t connected yet.</p>' +
        '<p class="muted">' + esc(e.message || 'Set the Supabase environment variables in Vercel, then reload.') + '</p>' +
        '<p class="auth-foot"><a href="/">← Back to site</a></p></div></div>';
      return;
    }
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    var s = await db.auth.getSession();
    session = s.data.session;
    if (!session) return renderLogin();
    await afterLogin();
  }

  async function afterLogin() {
    var { data: profile } = await db.from('profiles').select('*').eq('id', session.user.id).single();
    me = profile;
    if (!me) { // authenticated but no profile row yet
      app.innerHTML = '<div class="auth-wrap"><div class="auth-card"><h1>Account pending</h1>' +
        '<p class="auth-sub">Your login works, but your profile hasn\'t been set up yet.</p>' +
        '<p class="muted">If you\'re the owner, run the seed step in SETUP.md. Otherwise contact Beck Systems.</p>' +
        '<button class="btn btn--ghost" id="so" style="margin-top:16px">Sign out</button></div></div>';
      document.getElementById('so').onclick = signOut; return;
    }
    if (me.role === 'owner') renderOwner(); else renderClient();
  }

  /* ---------- login ---------- */
  function renderLogin() {
    app.innerHTML = '';
    app.appendChild(document.getElementById('tpl-login').content.cloneNode(true));
    var form = document.getElementById('loginForm');
    var note = document.getElementById('loginNote');
    var btn = document.getElementById('loginBtn');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      note.className = 'auth-note'; note.textContent = '';
      var id = document.getElementById('loginId').value.trim();
      var pw = document.getElementById('loginPw').value;
      var email = id.toLowerCase() === OWNER_USERNAME.toLowerCase() ? OWNER_EMAIL : id;
      btn.disabled = true; btn.textContent = 'Signing in…';
      var { data, error } = await db.auth.signInWithPassword({ email: email, password: pw });
      if (error) { note.textContent = error.message || 'Sign in failed.'; btn.disabled = false; btn.textContent = 'Sign in'; return; }
      session = data.session; await afterLogin();
    });
  }

  async function signOut() { await db.auth.signOut(); session = null; me = null; renderLogin(); }

  /* ---------- shared shell ---------- */
  function shell(tabs) {
    var roleTag = me.role === 'owner' ? '<span class="pill pill--owner">Owner</span>' : '<span class="pill">Client</span>';
    app.innerHTML =
      '<div class="topbar"><a class="brand" href="/"><svg viewBox="0 0 44 32" width="40" fill="none">' +
      '<circle cx="15" cy="16" r="11" stroke="#100F0C" stroke-width="3.2"/><circle cx="28" cy="16" r="11" stroke="#A98A44" stroke-width="3.2"/>' +
      '</svg><span>Beck Systems</span></a><div class="spacer"></div>' +
      '<div class="who"><b>' + esc(me.full_name || me.email) + '</b>' + (me.company ? esc(me.company) + ' · ' : '') + roleTag + '</div>' +
      '<button class="btn btn--ghost btn--sm" id="signout">Sign out</button></div>' +
      '<div class="wrap"><div class="tabs" id="tabs"></div><div id="content"></div></div>';
    document.getElementById('signout').onclick = signOut;
    var tabsEl = document.getElementById('tabs');
    tabs.forEach(function (t, i) {
      var b = h('<button class="tab' + (i === 0 ? ' active' : '') + '">' + esc(t.label) + '</button>');
      b.onclick = function () {
        [].forEach.call(tabsEl.children, function (c) { c.classList.remove('active'); });
        b.classList.add('active'); t.render(document.getElementById('content'));
      };
      tabsEl.appendChild(b);
    });
    tabs[0].render(document.getElementById('content'));
  }

  /* ========================================================================
     CLIENT APP
     ======================================================================== */
  async function renderClient() {
    shell([
      { label: 'My Project', render: clientOverview },
      { label: 'Feedback & Revisions', render: clientFeedback },
      { label: 'Invoices', render: clientInvoices },
      { label: 'Contracts', render: clientContracts },
      { label: 'Support', render: clientTickets }
    ]);
  }

  async function clientOverview(c) {
    c.innerHTML = '<h2 class="sec">My Project</h2><p class="sec-sub">Live progress of your build.</p><div id="pj">Loading…</div>';
    var { data: projects } = await db.from('projects').select('*').order('created_at');
    var box = document.getElementById('pj');
    if (!projects || !projects.length) { box.innerHTML = '<div class="card"><p class="empty">No project has been set up yet. Beck Systems will add it here soon.</p></div>'; return; }
    box.innerHTML = '';
    for (var i = 0; i < projects.length; i++) {
      var p = projects[i];
      var { data: ms } = await db.from('milestones').select('*').eq('project_id', p.id).order('position');
      var msHtml = (ms && ms.length) ? ms.map(function (m) {
        return '<div class="ms ' + m.status + '"><div class="dot"></div><div><div class="t">' + esc(m.title) + '</div>' +
          (m.detail ? '<div class="d">' + esc(m.detail) + '</div>' : '') +
          '<div class="d">' + statusChip(m.status) + (m.due_date ? ' · due ' + fdate(m.due_date) : '') + '</div></div></div>';
      }).join('') : '<p class="empty">Milestones will appear here.</p>';
      var card = h('<div class="card"></div>');
      card.innerHTML =
        '<div class="row"><h3>' + esc(p.name) + '</h3><div class="spacer"></div>' + statusChip(p.status) + '</div>' +
        (p.summary ? '<p class="muted" style="margin-top:6px">' + esc(p.summary) + '</p>' : '') +
        '<div class="progress"><i style="width:' + (p.progress || 0) + '%"></i></div>' +
        '<div class="row muted"><span>Stage: <b style="color:var(--ink)">' + esc(p.stage) + '</b></span>' +
        '<span class="spacer"></span><span>Deployment: ' + statusChip(p.deploy_status) + '</span>' +
        (p.site_url ? '<a class="chip info" href="' + esc(p.site_url) + '" target="_blank" rel="noopener">Visit site ↗</a>' : '') + '</div>' +
        '<div class="hr"></div><div class="stack">' + msHtml + '</div>';
      box.appendChild(card);
    }
  }

  async function clientFeedback(c) {
    c.innerHTML = '<h2 class="sec">Feedback & Revisions</h2><p class="sec-sub">Request copy changes, log bugs, or leave a note tied to a section of your site.</p>' +
      '<div class="card"><h3>New request</h3><form class="inline-form cols" id="fbForm">' +
      '<label>Which project<select id="fbProject" required></select></label>' +
      '<label>Type<select id="fbType"><option value="feedback">General feedback</option><option value="copy">Copy change</option><option value="bug">Bug / fix</option></select></label>' +
      '<label class="full">Section (optional)<input id="fbSection" placeholder="e.g. Hero, Pricing, Contact" /></label>' +
      '<label class="full">Message<textarea id="fbMsg" required placeholder="Describe the change or issue…"></textarea></label>' +
      '<div class="full"><button class="btn btn--gold" type="submit">Submit request</button></div></form></div>' +
      '<h3 style="font-family:var(--serif);font-weight:500;margin:18px 0 8px">Your requests</h3><div class="card" id="fbList">Loading…</div>';
    var { data: projects } = await db.from('projects').select('id,name').order('created_at');
    var sel = document.getElementById('fbProject');
    if (!projects || !projects.length) { sel.innerHTML = '<option value="">No project yet</option>'; }
    else sel.innerHTML = projects.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');

    document.getElementById('fbForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var project_id = sel.value; if (!project_id) return toast('No project to attach this to yet.', true);
      var payload = { project_id: project_id, author_id: session.user.id, type: document.getElementById('fbType').value,
        section: document.getElementById('fbSection').value.trim() || null, message: document.getElementById('fbMsg').value.trim() };
      var { error } = await db.from('feedback').insert(payload);
      if (error) return toast(error.message, true);
      toast('Request submitted'); document.getElementById('fbForm').reset(); loadClientFeedback();
    });
    loadClientFeedback();
    async function loadClientFeedback() {
      var { data: fb } = await db.from('feedback').select('*').order('created_at', { ascending: false });
      var el = document.getElementById('fbList');
      if (!fb || !fb.length) { el.innerHTML = '<p class="empty">Nothing submitted yet.</p>'; return; }
      el.innerHTML = fb.map(function (f) {
        return '<div class="item"><div class="top">' + typeChip(f.type) + (f.section ? ' <span class="chip">' + esc(f.section) + '</span>' : '') +
          '<span class="spacer"></span>' + statusChip(f.status) + '</div>' +
          '<p class="body">' + esc(f.message) + '</p><div class="meta">' + fdate(f.created_at) + '</div></div>';
      }).join('');
    }
  }

  async function clientInvoices(c) {
    c.innerHTML = '<h2 class="sec">Invoices</h2><p class="sec-sub">Quotes and invoices. Pay securely by card via Stripe.</p><div class="card" id="invList">Loading…</div>';
    var { data: inv } = await db.from('invoices').select('*').order('created_at', { ascending: false });
    var el = document.getElementById('invList');
    if (!inv || !inv.length) { el.innerHTML = '<p class="empty">No invoices yet.</p>'; return; }
    el.innerHTML = inv.map(function (v) {
      var payBtn = (v.status !== 'paid' && v.status !== 'void') ? '<button class="btn btn--gold btn--sm pay" data-id="' + v.id + '">Pay ' + money(v.amount_cents, v.currency) + '</button>' : '';
      return '<div class="item"><div class="top"><div><div style="font-weight:500">' + esc(v.description) + '</div>' +
        '<div class="meta">' + fdate(v.created_at) + (v.paid_at ? ' · paid ' + fdate(v.paid_at) : '') + '</div></div>' +
        '<span class="spacer"></span><div style="text-align:right"><div class="amount">' + money(v.amount_cents, v.currency) + '</div>' + statusChip(v.status) + '</div></div>' +
        '<div class="row" style="margin-top:8px">' + payBtn + '</div></div>';
    }).join('');
    [].forEach.call(el.querySelectorAll('.pay'), function (b) {
      b.onclick = async function () {
        b.disabled = true; b.textContent = 'Redirecting…';
        try { var r = await authFetch('/api/stripe-checkout', { invoice_id: b.dataset.id }); window.location.href = r.url; }
        catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Pay'; }
      };
    });
  }

  async function clientContracts(c) {
    c.innerHTML = '<h2 class="sec">Contracts</h2><p class="sec-sub">Your service agreements.</p><div class="card" id="ctList">Loading…</div>';
    var { data: cts } = await db.from('contracts').select('*').order('created_at', { ascending: false });
    var el = document.getElementById('ctList');
    if (!cts || !cts.length) { el.innerHTML = '<p class="empty">No contracts yet.</p>'; return; }
    el.innerHTML = cts.map(function (t) {
      return '<div class="item"><div class="top"><div><div style="font-weight:500">' + esc(t.title) + '</div>' +
        '<div class="meta">' + fdate(t.created_at) + (t.signed_at ? ' · signed ' + fdate(t.signed_at) : '') + '</div></div>' +
        '<span class="spacer"></span>' + statusChip(t.status) + '</div>' +
        (t.url ? '<div class="row" style="margin-top:8px"><a class="btn btn--ghost btn--sm" href="' + esc(t.url) + '" target="_blank" rel="noopener">View agreement ↗</a></div>' : '') + '</div>';
    }).join('');
  }

  async function clientTickets(c) {
    c.innerHTML = '<h2 class="sec">Support & Maintenance</h2><p class="sec-sub">Submit a quick update request or maintenance ticket.</p>' +
      '<div class="card"><h3>New ticket</h3><form class="inline-form cols" id="tkForm">' +
      '<label>Subject<input id="tkSubject" required placeholder="e.g. Update hours on Contact page" /></label>' +
      '<label>Priority<select id="tkPriority"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option></select></label>' +
      '<label class="full">Details<textarea id="tkBody" placeholder="What needs changing?"></textarea></label>' +
      '<div class="full"><button class="btn btn--gold" type="submit">Submit ticket</button></div></form></div>' +
      '<h3 style="font-family:var(--serif);font-weight:500;margin:18px 0 8px">Your tickets</h3><div class="card" id="tkList">Loading…</div>';
    document.getElementById('tkForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var payload = { client_id: session.user.id, subject: document.getElementById('tkSubject').value.trim(),
        priority: document.getElementById('tkPriority').value, body: document.getElementById('tkBody').value.trim() || null };
      var { error } = await db.from('tickets').insert(payload);
      if (error) return toast(error.message, true);
      toast('Ticket submitted'); document.getElementById('tkForm').reset(); loadTk();
    });
    loadTk();
    async function loadTk() {
      var { data: tk } = await db.from('tickets').select('*').order('created_at', { ascending: false });
      var el = document.getElementById('tkList');
      if (!tk || !tk.length) { el.innerHTML = '<p class="empty">No tickets yet.</p>'; return; }
      el.innerHTML = tk.map(function (t) {
        return '<div class="item"><div class="top"><div style="font-weight:500">' + esc(t.subject) + '</div><span class="spacer"></span>' +
          '<span class="chip ' + (t.priority === 'high' ? 'bad' : t.priority === 'low' ? '' : 'warn') + '">' + esc(t.priority) + '</span>' + statusChip(t.status) + '</div>' +
          (t.body ? '<p class="body">' + esc(t.body) + '</p>' : '') + '<div class="meta">' + fdate(t.created_at) + '</div></div>';
      }).join('');
    }
  }

  /* ========================================================================
     OWNER APP
     ======================================================================== */
  function renderOwner() {
    shell([
      { label: 'Clients', render: ownerClients },
      { label: 'Feedback', render: ownerFeedback },
      { label: 'Tickets', render: ownerTickets },
      { label: 'Invoices', render: ownerInvoices }
    ]);
  }

  async function ownerClients(c) {
    c.innerHTML = '<h2 class="sec">Clients</h2><p class="sec-sub">Everyone you work with. Create logins and open a client to manage their build.</p>' +
      '<div class="card"><h3>Create a client account</h3><form class="inline-form cols" id="ncForm">' +
      '<label>Full name<input id="ncName" placeholder="Jane Appleseed" /></label>' +
      '<label>Company<input id="ncCompany" placeholder="Appleseed Co." /></label>' +
      '<label>Email (their login)<input id="ncEmail" type="email" required placeholder="jane@business.com" /></label>' +
      '<label>Phone<input id="ncPhone" placeholder="(704) 555-0100" /></label>' +
      '<label>Starting password<input id="ncPw" required placeholder="min 6 characters" /></label>' +
      '<div class="full"><button class="btn btn--gold" type="submit" id="ncBtn">Create account</button></div></form>' +
      '<p class="muted" id="ncNote" style="margin-top:8px"></p></div>' +
      '<div id="clientList">Loading…</div>';
    document.getElementById('ncForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = document.getElementById('ncBtn'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await authFetch('/api/create-client', {
          full_name: document.getElementById('ncName').value.trim(),
          company: document.getElementById('ncCompany').value.trim(),
          email: document.getElementById('ncEmail').value.trim(),
          phone: document.getElementById('ncPhone').value.trim(),
          password: document.getElementById('ncPw').value
        });
        toast('Client account created'); document.getElementById('ncForm').reset(); loadClients();
      } catch (err) { toast(err.message, true); }
      btn.disabled = false; btn.textContent = 'Create account';
    });
    loadClients();
    async function loadClients() {
      var { data: clients } = await db.from('profiles').select('*').eq('role', 'client').order('created_at', { ascending: false });
      var el = document.getElementById('clientList');
      if (!clients || !clients.length) { el.innerHTML = '<div class="card"><p class="empty">No clients yet — create one above.</p></div>'; return; }
      el.innerHTML = '<div class="card"><h3>All clients (' + clients.length + ')</h3><div class="stack" style="margin-top:10px" id="clRows"></div></div>';
      var rows = document.getElementById('clRows');
      clients.forEach(function (cl) {
        var r = h('<div class="item" style="cursor:pointer"><div class="top"><div><div style="font-weight:500">' +
          esc(cl.full_name || cl.email) + '</div><div class="meta">' + esc(cl.company || '') + (cl.company ? ' · ' : '') + esc(cl.email) + '</div></div>' +
          '<span class="spacer"></span><span class="chip info">Open →</span></div></div>');
        r.onclick = function () { ownerClientDetail(c, cl); };
        rows.appendChild(r);
      });
    }
  }

  async function ownerClientDetail(c, cl) {
    c.innerHTML = '<span class="back" id="back">← All clients</span>' +
      '<h2 class="sec">' + esc(cl.full_name || cl.email) + '</h2>' +
      '<p class="sec-sub">' + esc(cl.company || '') + (cl.company ? ' · ' : '') + esc(cl.email) + (cl.phone ? ' · ' + esc(cl.phone) : '') + '</p>' +
      '<div class="card"><h3>New project</h3><form class="inline-form cols" id="npForm">' +
      '<label>Project name<input id="npName" required placeholder="Marketing site" /></label>' +
      '<label>Stage<select id="npStage"><option>Discovery</option><option>Design</option><option>Build</option><option>Review</option><option>Launched</option></select></label>' +
      '<label class="full">Summary<input id="npSummary" placeholder="One line about the build" /></label>' +
      '<div class="full"><button class="btn btn--gold" type="submit">Add project</button></div></form></div>' +
      '<div class="hr"></div>' +
      '<div class="grid two"><div class="card"><h3>Add invoice</h3><form class="inline-form" id="niForm">' +
      '<label>Description<input id="niDesc" required placeholder="Website build — 50% deposit" /></label>' +
      '<label>Amount (USD)<input id="niAmt" type="number" min="0" step="0.01" required placeholder="1500.00" /></label>' +
      '<button class="btn btn--gold" type="submit">Create invoice</button></form></div>' +
      '<div class="card"><h3>Add contract</h3><form class="inline-form" id="ncoForm">' +
      '<label>Title<input id="ncoTitle" required placeholder="Service Agreement 2026" /></label>' +
      '<label>Link (PDF / signing URL)<input id="ncoUrl" placeholder="https://…" /></label>' +
      '<button class="btn btn--gold" type="submit">Add contract</button></form></div></div>' +
      '<div id="pjWrap"></div><div id="invWrap"></div><div id="ctWrap"></div>';
    document.getElementById('back').onclick = function () { ownerClients(c); };

    document.getElementById('npForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var { error } = await db.from('projects').insert({ client_id: cl.id, name: document.getElementById('npName').value.trim(),
        stage: document.getElementById('npStage').value, summary: document.getElementById('npSummary').value.trim() || null });
      if (error) return toast(error.message, true);
      toast('Project added'); document.getElementById('npForm').reset(); loadProjects();
    });
    document.getElementById('niForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var cents = Math.round(parseFloat(document.getElementById('niAmt').value) * 100);
      var { error } = await db.from('invoices').insert({ client_id: cl.id, description: document.getElementById('niDesc').value.trim(), amount_cents: cents, status: 'sent' });
      if (error) return toast(error.message, true);
      toast('Invoice created'); document.getElementById('niForm').reset(); loadInvoices();
    });
    document.getElementById('ncoForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var { error } = await db.from('contracts').insert({ client_id: cl.id, title: document.getElementById('ncoTitle').value.trim(), url: document.getElementById('ncoUrl').value.trim() || null });
      if (error) return toast(error.message, true);
      toast('Contract added'); document.getElementById('ncoForm').reset(); loadContracts();
    });

    loadProjects(); loadInvoices(); loadContracts();

    async function loadProjects() {
      var { data: projects } = await db.from('projects').select('*').eq('client_id', cl.id).order('created_at');
      var wrap = document.getElementById('pjWrap');
      wrap.innerHTML = '<div class="hr"></div><h3 style="font-family:var(--serif);font-weight:500;margin-bottom:10px">Projects</h3>';
      if (!projects || !projects.length) { wrap.innerHTML += '<div class="card"><p class="empty">No projects yet.</p></div>'; return; }
      for (var i = 0; i < projects.length; i++) { await renderOwnerProject(wrap, projects[i]); }
    }
    async function renderOwnerProject(wrap, p) {
      var { data: ms } = await db.from('milestones').select('*').eq('project_id', p.id).order('position');
      var card = h('<div class="card"></div>');
      card.innerHTML =
        '<div class="row"><h3>' + esc(p.name) + '</h3><span class="spacer"></span>' + statusChip(p.status) + '</div>' +
        '<div class="inline-form cols" style="margin-top:10px">' +
        '<label>Progress %<input type="number" min="0" max="100" value="' + (p.progress || 0) + '" data-f="progress"></label>' +
        '<label>Stage<input value="' + esc(p.stage) + '" data-f="stage"></label>' +
        '<label>Status<select data-f="status">' + ['active', 'paused', 'launched', 'archived'].map(function (s) { return '<option ' + (p.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label>Deployment<select data-f="deploy_status">' + ['not_deployed', 'building', 'live', 'error'].map(function (s) { return '<option ' + (p.deploy_status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
        '<label class="full">Live URL<input value="' + esc(p.site_url || '') + '" data-f="site_url" placeholder="https://…"></label></div>' +
        '<div class="row" style="margin-top:8px"><button class="btn btn--sm save">Save project</button></div>' +
        '<div class="hr"></div><div class="ms-list"></div>' +
        '<form class="inline-form cols msf" style="margin-top:8px"><label class="full">Milestone<input class="mt" placeholder="e.g. Design approved" required></label>' +
        '<label>Status<select class="msStat"><option value="pending">pending</option><option value="in_progress">in_progress</option><option value="done">done</option></select></label>' +
        '<div><button class="btn btn--sm btn--gold" type="submit">Add milestone</button></div></form>';
      // save project
      card.querySelector('.save').onclick = async function () {
        var upd = {}; [].forEach.call(card.querySelectorAll('[data-f]'), function (i) { upd[i.dataset.f] = i.type === 'number' ? parseInt(i.value || '0', 10) : i.value; });
        var { error } = await db.from('projects').update(upd).eq('id', p.id);
        toast(error ? error.message : 'Saved', !!error);
      };
      var msList = card.querySelector('.ms-list');
      msList.innerHTML = (ms && ms.length) ? ms.map(function (m) {
        return '<div class="ms ' + m.status + '"><div class="dot"></div><div style="flex:1"><div class="t">' + esc(m.title) + '</div>' +
          '<div class="d">' + statusChip(m.status) + '</div></div>' +
          '<select class="mini msu" data-id="' + m.id + '">' + ['pending', 'in_progress', 'done'].map(function (s) { return '<option ' + (m.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>';
      }).join('') : '<p class="empty">No milestones.</p>';
      [].forEach.call(msList.querySelectorAll('.msu'), function (sel) {
        sel.onchange = async function () { var { error } = await db.from('milestones').update({ status: sel.value }).eq('id', sel.dataset.id); toast(error ? error.message : 'Milestone updated', !!error); if (!error) loadProjects(); };
      });
      card.querySelector('.msf').addEventListener('submit', async function (e) {
        e.preventDefault();
        var { error } = await db.from('milestones').insert({ project_id: p.id, title: card.querySelector('.mt').value.trim(), status: card.querySelector('.msStat').value, position: (ms ? ms.length : 0) });
        if (error) return toast(error.message, true);
        toast('Milestone added'); loadProjects();
      });
      wrap.appendChild(card);
    }
    async function loadInvoices() {
      var { data: inv } = await db.from('invoices').select('*').eq('client_id', cl.id).order('created_at', { ascending: false });
      var wrap = document.getElementById('invWrap');
      wrap.innerHTML = '<div class="hr"></div><h3 style="font-family:var(--serif);font-weight:500;margin-bottom:10px">Invoices</h3>';
      var card = h('<div class="card"></div>');
      if (!inv || !inv.length) { card.innerHTML = '<p class="empty">No invoices.</p>'; wrap.appendChild(card); return; }
      card.innerHTML = inv.map(function (v) {
        return '<div class="item"><div class="top"><div><div style="font-weight:500">' + esc(v.description) + '</div><div class="meta">' + fdate(v.created_at) + '</div></div>' +
          '<span class="spacer"></span><div style="text-align:right"><div class="amount">' + money(v.amount_cents, v.currency) + '</div>' + statusChip(v.status) + '</div></div>' +
          '<div class="row" style="margin-top:8px"><select class="mini iu" data-id="' + v.id + '">' + ['draft', 'sent', 'paid', 'void'].map(function (s) { return '<option ' + (v.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div></div>';
      }).join('');
      [].forEach.call(card.querySelectorAll('.iu'), function (sel) {
        sel.onchange = async function () {
          var patch = { status: sel.value }; if (sel.value === 'paid') patch.paid_at = new Date().toISOString();
          var { error } = await db.from('invoices').update(patch).eq('id', sel.dataset.id); toast(error ? error.message : 'Invoice updated', !!error);
        };
      });
      wrap.appendChild(card);
    }
    async function loadContracts() {
      var { data: cts } = await db.from('contracts').select('*').eq('client_id', cl.id).order('created_at', { ascending: false });
      var wrap = document.getElementById('ctWrap');
      wrap.innerHTML = '<div class="hr"></div><h3 style="font-family:var(--serif);font-weight:500;margin-bottom:10px">Contracts</h3>';
      var card = h('<div class="card"></div>');
      if (!cts || !cts.length) { card.innerHTML = '<p class="empty">No contracts.</p>'; wrap.appendChild(card); return; }
      card.innerHTML = cts.map(function (t) {
        return '<div class="item"><div class="top"><div><div style="font-weight:500">' + esc(t.title) + '</div>' +
          (t.url ? '<a class="meta" href="' + esc(t.url) + '" target="_blank" rel="noopener">' + esc(t.url) + '</a>' : '') + '</div>' +
          '<span class="spacer"></span><select class="mini cu" data-id="' + t.id + '">' + ['draft', 'sent', 'signed'].map(function (s) { return '<option ' + (t.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div></div>';
      }).join('');
      [].forEach.call(card.querySelectorAll('.cu'), function (sel) {
        sel.onchange = async function () { var patch = { status: sel.value }; if (sel.value === 'signed') patch.signed_at = new Date().toISOString(); var { error } = await db.from('contracts').update(patch).eq('id', sel.dataset.id); toast(error ? error.message : 'Contract updated', !!error); };
      });
      wrap.appendChild(card);
    }
  }

  async function ownerFeedback(c) {
    c.innerHTML = '<h2 class="sec">Feedback & Revisions</h2><p class="sec-sub">Everything clients have submitted across all projects.</p><div class="card" id="fi">Loading…</div>';
    var { data: fb } = await db.from('feedback').select('*, projects(name, client_id), profiles!feedback_author_id_fkey(full_name)').order('created_at', { ascending: false });
    var el = document.getElementById('fi');
    if (!fb || !fb.length) { el.innerHTML = '<p class="empty">No feedback yet.</p>'; return; }
    el.innerHTML = fb.map(function (f) {
      var who = (f.profiles && f.profiles.full_name) || '';
      var pj = (f.projects && f.projects.name) || '';
      return '<div class="item"><div class="top">' + typeChip(f.type) + (f.section ? ' <span class="chip">' + esc(f.section) + '</span>' : '') +
        '<span class="spacer"></span><select class="mini fu" data-id="' + f.id + '">' + ['open', 'in_progress', 'resolved'].map(function (s) { return '<option ' + (f.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
        '<p class="body">' + esc(f.message) + '</p><div class="meta">' + esc(pj) + (who ? ' · ' + esc(who) : '') + ' · ' + fdate(f.created_at) + '</div></div>';
    }).join('');
    [].forEach.call(el.querySelectorAll('.fu'), function (sel) {
      sel.onchange = async function () { var { error } = await db.from('feedback').update({ status: sel.value }).eq('id', sel.dataset.id); toast(error ? error.message : 'Updated', !!error); };
    });
  }

  async function ownerTickets(c) {
    c.innerHTML = '<h2 class="sec">Maintenance Tickets</h2><p class="sec-sub">Support requests from clients on retainer.</p><div class="card" id="ti">Loading…</div>';
    var { data: tk } = await db.from('tickets').select('*, profiles(full_name, company)').order('created_at', { ascending: false });
    var el = document.getElementById('ti');
    if (!tk || !tk.length) { el.innerHTML = '<p class="empty">No tickets yet.</p>'; return; }
    el.innerHTML = tk.map(function (t) {
      var who = t.profiles ? (t.profiles.full_name || '') + (t.profiles.company ? ' · ' + t.profiles.company : '') : '';
      return '<div class="item"><div class="top"><div style="font-weight:500">' + esc(t.subject) + '</div><span class="spacer"></span>' +
        '<span class="chip ' + (t.priority === 'high' ? 'bad' : t.priority === 'low' ? '' : 'warn') + '">' + esc(t.priority) + '</span>' +
        '<select class="mini tu" data-id="' + t.id + '">' + ['open', 'in_progress', 'closed'].map(function (s) { return '<option ' + (t.status === s ? 'selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
        (t.body ? '<p class="body">' + esc(t.body) + '</p>' : '') + '<div class="meta">' + esc(who) + ' · ' + fdate(t.created_at) + '</div></div>';
    }).join('');
    [].forEach.call(el.querySelectorAll('.tu'), function (sel) {
      sel.onchange = async function () { var { error } = await db.from('tickets').update({ status: sel.value }).eq('id', sel.dataset.id); toast(error ? error.message : 'Updated', !!error); };
    });
  }

  async function ownerInvoices(c) {
    c.innerHTML = '<h2 class="sec">Invoices</h2><p class="sec-sub">Every invoice across all clients.</p><div class="card" id="ai">Loading…</div>';
    var { data: inv } = await db.from('invoices').select('*, profiles(full_name, company)').order('created_at', { ascending: false });
    var el = document.getElementById('ai');
    if (!inv || !inv.length) { el.innerHTML = '<p class="empty">No invoices yet. Create them from a client\'s page.</p>'; return; }
    var total = inv.reduce(function (a, v) { return a + (v.status === 'paid' ? v.amount_cents : 0); }, 0);
    var outstanding = inv.reduce(function (a, v) { return a + (v.status === 'sent' || v.status === 'draft' ? v.amount_cents : 0); }, 0);
    el.innerHTML = '<div class="row" style="margin-bottom:10px"><span class="chip ok">Collected ' + money(total) + '</span><span class="chip warn">Outstanding ' + money(outstanding) + '</span></div>' +
      inv.map(function (v) {
        var who = v.profiles ? (v.profiles.full_name || v.profiles.company || '') : '';
        return '<div class="item"><div class="top"><div><div style="font-weight:500">' + esc(v.description) + '</div><div class="meta">' + esc(who) + ' · ' + fdate(v.created_at) + '</div></div>' +
          '<span class="spacer"></span><div style="text-align:right"><div class="amount">' + money(v.amount_cents, v.currency) + '</div>' + statusChip(v.status) + '</div></div></div>';
      }).join('');
  }

  boot();
})();
