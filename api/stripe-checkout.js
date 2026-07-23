// Create a Stripe Checkout session to pay an invoice.
// Callable by the owner (for any invoice) or the client the invoice belongs to.
const { requireUser, readJson, send, adminClient } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return send(res, 500, { error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in Vercel.' });

  try {
    const stripe = require('stripe')(key);
    const ctx = await requireUser(req);
    const { invoice_id } = await readJson(req);
    if (!invoice_id) return send(res, 400, { error: 'invoice_id is required.' });

    const admin = adminClient();
    const { data: inv, error } = await admin.from('invoices').select('*').eq('id', invoice_id).single();
    if (error || !inv) return send(res, 404, { error: 'Invoice not found.' });

    const isOwner = ctx.profile && ctx.profile.role === 'owner';
    if (!isOwner && inv.client_id !== ctx.user.id) return send(res, 403, { error: 'Not your invoice.' });
    if (inv.status === 'paid') return send(res, 400, { error: 'This invoice is already paid.' });

    const origin = process.env.APP_URL || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: inv.currency || 'usd',
          unit_amount: inv.amount_cents,
          product_data: { name: inv.description || 'Beck Systems invoice' }
        }
      }],
      client_reference_id: inv.id,
      metadata: { invoice_id: inv.id },
      success_url: `${origin}/portal/?paid=1`,
      cancel_url: `${origin}/portal/?canceled=1`
    });

    await admin.from('invoices').update({ stripe_session_id: session.id, status: inv.status === 'draft' ? 'sent' : inv.status }).eq('id', inv.id);
    send(res, 200, { url: session.url });
  } catch (e) {
    send(res, e.status || 500, { error: e.message || 'Server error' });
  }
};
