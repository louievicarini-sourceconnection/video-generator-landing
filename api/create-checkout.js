const Stripe = require('stripe');
const { getPool } = require('./_lib/db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// price_1TztzJRuNf570lHeBbL1Di4C — "AI Video - 30 Second", $35.00 USD, one-time
const PRICE_ID = 'price_1TztzJRuNf570lHeBbL1Di4C';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const {
    occasion,
    story,
    characters,
    style,
    dialogue,
    delivery_method,
    delivery_email,
    delivery_phone,
    referral_code,
  } = req.body || {};

  if (!occasion || !story || !characters || !style || !delivery_method) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (delivery_method !== 'email' && delivery_method !== 'phone') {
    return res.status(400).json({ error: 'Invalid delivery_method.' });
  }
  if (delivery_method === 'email' && !delivery_email) {
    return res.status(400).json({ error: 'delivery_email is required for email delivery.' });
  }
  if (delivery_method === 'phone' && !delivery_phone) {
    return res.status(400).json({ error: 'delivery_phone is required for phone delivery.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/payment-issue`,
      allow_promotion_codes: true,
    });

    const pool = getPool();
    await pool.query(
      `INSERT INTO video_orders
         (stripe_session_id, occasion, story, characters, style, dialogue,
          duration_seconds, delivery_method, delivery_email, delivery_phone, referral_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        session.id,
        occasion,
        JSON.stringify(story),
        JSON.stringify(characters),
        style,
        !!dialogue,
        30,
        delivery_method,
        delivery_email || null,
        delivery_phone || null,
        referral_code || null,
      ]
    );

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout failed:', err);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
};
