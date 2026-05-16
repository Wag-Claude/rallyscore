// ============================================================
// Vercel serverless function: POST /api/stripe-webhook
// ============================================================
// Receives Stripe events and syncs them into the `subscriptions` table.
// Configure: in Stripe Dashboard → Developers → Webhooks → "Add endpoint"
//   URL:    https://rallyscore.vercel.app/api/stripe-webhook
//   Events: checkout.session.completed,
//           customer.subscription.created,
//           customer.subscription.updated,
//           customer.subscription.deleted,
//           invoice.payment_succeeded,
//           invoice.payment_failed
// Copy the signing secret and set STRIPE_WEBHOOK_SECRET in Vercel.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY  (NOT the anon key — this bypasses RLS)
// ============================================================

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Vercel needs the raw body to verify the signature
export const config = {
  api: { bodyParser: false }
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const body = await buffer(req);
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.user_id;
        if (!userId) break;
        await supabase.from('subscriptions').upsert({
          user_id: userId,
          tier: 'family',
          status: 'trialing',
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription,
        }, { onConflict: 'stripe_subscription_id' });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        if (!userId) break;
        await supabase.from('subscriptions').upsert({
          user_id: userId,
          tier: sub.metadata?.tier || 'family',
          status: sub.status,
          stripe_customer_id: sub.customer,
          stripe_subscription_id: sub.id,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'stripe_subscription_id' });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await supabase.from('subscriptions')
            .update({ status: 'past_due', updated_at: new Date().toISOString() })
            .eq('stripe_subscription_id', invoice.subscription);
        }
        break;
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
