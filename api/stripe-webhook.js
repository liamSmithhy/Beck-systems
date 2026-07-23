// Stripe webhook: when a Checkout payment completes, mark the invoice paid.
// Configure this URL in Stripe (Dashboard -> Developers -> Webhooks):
//   https://www.becksystems.studio/api/stripe-webhook   event: checkout.session.completed
const { adminClient } = require('./_lib');

// We need the RAW request body to verify Stripe's signature.
function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end('Method not allowed'); return; }
  const key = process.env.STRIPE_SECRET_KEY;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !whSecret) { res.status(500).end('Stripe not configured'); return; }

  const stripe = require('stripe')(key);
  let event;
  try {
    const buf = await rawBody(req);
    event = stripe.webhooks.constructEvent(buf, req.headers['stripe-signature'], whSecret);
  } catch (err) {
    res.status(400).end(`Webhook signature check failed: ${err.message}`);
    return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const invoiceId = (session.metadata && session.metadata.invoice_id) || session.client_reference_id;
      if (invoiceId) {
        const admin = adminClient();
        await admin.from('invoices').update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          stripe_payment_intent: session.payment_intent || null
        }).eq('id', invoiceId);
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    res.status(500).end('Handler error');
  }
};

// Tell Vercel not to pre-parse the body so signature verification works.
module.exports.config = { api: { bodyParser: false } };
