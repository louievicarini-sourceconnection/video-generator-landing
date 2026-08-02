const Stripe = require('stripe');
const getRawBody = require('raw-body');
const { getPool } = require('./_lib/db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const N8N_WEBHOOK_URL = 'https://primary-production-2c95.up.railway.app/webhook/video-submission';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const rawBody = await getRawBody(req);
  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true });
  }

  const session = event.data.object;
  const pool = getPool();

  // Atomically claim this order so concurrent Stripe retries can't both
  // call the n8n webhook. Only orders still "pending_payment" get claimed;
  // anything already completed or mid-flight is a no-op here.
  const claim = await pool.query(
    `UPDATE video_orders SET status = 'processing'
     WHERE stripe_session_id = $1 AND status = 'pending_payment'
     RETURNING *`,
    [session.id]
  );

  if (claim.rowCount === 0) {
    return res.status(200).json({ received: true });
  }

  const order = claim.rows[0];

  try {
    const n8nRes = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        occasion: order.occasion,
        story: order.story,
        characters: order.characters,
        style: order.style,
        dialogue: order.dialogue,
        duration_seconds: order.duration_seconds,
        delivery: {
          method: order.delivery_method,
          email: order.delivery_email,
          phone: order.delivery_phone,
        },
        payment_status: 'paid',
        stripe_session_id: session.id,
      }),
    });

    if (!n8nRes.ok) {
      throw new Error(`n8n webhook responded ${n8nRes.status}`);
    }

    await pool.query(
      `UPDATE video_orders SET status = 'completed', completed_at = now() WHERE stripe_session_id = $1`,
      [session.id]
    );

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('stripe-webhook processing failed:', err);
    // Release the claim so the next Stripe retry can try calling n8n again.
    await pool
      .query(
        `UPDATE video_orders SET status = 'pending_payment' WHERE stripe_session_id = $1 AND status = 'processing'`,
        [session.id]
      )
      .catch((e) => console.error('failed to revert order status:', e));
    return res.status(500).json({ error: 'Processing failed.' });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
