const Stripe = require('stripe');
const { getPool } = require('./_lib/db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// TODO: replace with the real "AI Video - Add 30 Seconds" price id once it
// exists in Stripe (blocked on reconnecting Stripe access as of this build).
// Checkout will fail cleanly with a 500 until this is set correctly.
const EXTENSION_PRICE_ID = 'REPLACE_WITH_ADD_30_SECONDS_PRICE_ID';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const { video_id } = req.body || {};
  if (!video_id) {
    return res.status(400).json({ error: 'video_id is required.' });
  }

  const pool = getPool();

  try {
    const existing = await pool.query(`SELECT id, status FROM videos WHERE id = $1`, [video_id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'No video found for that id.' });
    }
    if (existing.rows[0].status !== 'complete') {
      return res.status(409).json({ error: 'Video is not ready to be extended yet.' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: EXTENSION_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment-issue`,
      allow_promotion_codes: true,
    });

    await pool.query(
      `INSERT INTO video_extension_orders (stripe_session_id, video_id) VALUES ($1, $2)`,
      [session.id, video_id]
    );

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-extension-checkout failed:', err);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
};
