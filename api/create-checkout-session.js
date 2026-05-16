// ============================================================
// Vercel serverless function: POST /api/create-checkout-session
// ============================================================
// Required environment variables (set in Vercel dashboard):
//   STRIPE_SECRET_KEY              sk_test_... or sk_live_...
//   STRIPE_FAMILY_PRICE_ID         price_xxx (monthly $4.99)
//   STRIPE_FAMILY_YEARLY_PRICE_ID  price_xxx (yearly $39.99)
//   PUBLIC_SITE_URL                https://rallyscore.vercel.app
//
// Install in Vercel: in your repo root, run `npm i stripe` and add:
//   { "dependencies": { "stripe": "^14.0.0" } } to package.json
// Then `vercel --prod`.
// ============================================================

import Stripe from 'stripe';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!stripe) {
    return res.status(500).json({
      error: 'Stripe not configured. Set STRIPE_SECRET_KEY in environment variables.'
    });
  }

  try {
    const { plan, userId, email } = req.body;

    const priceId = plan === 'yearly'
      ? process.env.STRIPE_FAMILY_YEARLY_PRICE_ID
      : process.env.STRIPE_FAMILY_PRICE_ID;

    if (!priceId) {
      return res.status(500).json({
        error: `Missing price ID for plan "${plan}". Set STRIPE_FAMILY_PRICE_ID and STRIPE_FAMILY_YEARLY_PRICE_ID.`
      });
    }

    const baseUrl = process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: userId, // we use this in the webhook
      subscription_data: {
        trial_period_days: 7,
        metadata: { user_id: userId, tier: 'family' },
      },
      success_url: `${baseUrl}/account.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?checkout=cancelled`,
      allow_promotion_codes: true,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[create-checkout-session] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
