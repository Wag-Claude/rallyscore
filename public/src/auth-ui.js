// ============================================================
// RallyScore — Auth UI (magic link modal) and paywall helpers
// ============================================================

import { supabase, getUser, getProfile, signInWithMagicLink, signOut, hasProAccess, config } from './supabase-client.js';

const STYLE = `
.rs-modal-backdrop {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(5, 6, 13, 0.85);
  backdrop-filter: blur(6px);
  display: grid; place-items: center;
  padding: 20px;
  animation: rs-fade-in 0.2s ease-out;
}
@keyframes rs-fade-in { from { opacity:0 } to { opacity:1 } }
.rs-modal {
  background: #131829;
  border: 1px solid #232A45;
  border-radius: 22px;
  padding: 28px 24px;
  max-width: 380px; width: 100%;
  color: #F4F6FB;
  font-family: 'Inter', system-ui, sans-serif;
  box-shadow: 0 30px 60px rgba(0,0,0,0.5);
}
.rs-modal h2 { margin: 0 0 6px; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
.rs-modal p { margin: 0 0 18px; color: #8A93AD; font-size: 14px; line-height: 1.5; }
.rs-modal label { display: block; font-size: 12px; font-weight: 700; color: #8A93AD; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.rs-modal input[type=email] {
  width: 100%; padding: 14px 14px;
  background: #1B2138; border: 1px solid #232A45;
  border-radius: 12px; color: #fff; font-size: 16px;
  font-family: inherit;
  outline: none; transition: border-color 0.15s;
}
.rs-modal input[type=email]:focus { border-color: #FF4D2E; }
.rs-modal button.primary {
  width: 100%; margin-top: 14px;
  background: linear-gradient(135deg, #FF4D2E 0%, #FF8A00 100%);
  color: white; border: 0;
  padding: 14px; border-radius: 12px;
  font-weight: 700; font-size: 15px;
  cursor: pointer;
  box-shadow: 0 8px 18px rgba(255, 77, 46, 0.35);
  transition: transform 0.1s;
  font-family: inherit;
}
.rs-modal button.primary:hover { transform: translateY(-1px); }
.rs-modal button.primary:disabled { opacity: 0.6; cursor: wait; transform: none; }
.rs-modal button.ghost {
  background: transparent; border: 0; color: #8A93AD;
  padding: 10px; margin-top: 4px; width: 100%;
  font-size: 13px; cursor: pointer; font-family: inherit;
}
.rs-modal .rs-status {
  margin-top: 14px; padding: 12px;
  border-radius: 10px;
  font-size: 13px;
  display: none;
}
.rs-modal .rs-status.success {
  background: rgba(0, 214, 125, 0.12);
  border: 1px solid rgba(0, 214, 125, 0.3);
  color: #00D67D;
  display: block;
}
.rs-modal .rs-status.error {
  background: rgba(255, 77, 46, 0.12);
  border: 1px solid rgba(255, 77, 46, 0.3);
  color: #FF4D2E;
  display: block;
}
.rs-close-x {
  position: absolute; top: 14px; right: 14px;
  background: transparent; border: 0; color: #8A93AD;
  font-size: 20px; cursor: pointer; line-height: 1;
  padding: 6px 10px;
}
.rs-toast {
  position: fixed; bottom: 90px; left: 50%;
  transform: translateX(-50%);
  background: #131829; border: 1px solid #232A45;
  color: white; padding: 10px 16px; border-radius: 999px;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 13px; font-weight: 600;
  z-index: 9999;
  box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  opacity: 0; transition: opacity 0.2s;
}
.rs-toast.show { opacity: 1; }
`;

function injectStyle() {
  if (document.getElementById('rs-auth-style')) return;
  const s = document.createElement('style');
  s.id = 'rs-auth-style';
  s.textContent = STYLE;
  document.head.appendChild(s);
}

export function showToast(msg, ms = 2400) {
  injectStyle();
  let t = document.querySelector('.rs-toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'rs-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms);
}

/**
 * Show a magic-link sign-in modal. Resolves once the user submits the email
 * (we don't wait for them to click the link in their inbox — they leave and
 * come back; the auth state listener handles the post-redirect login).
 */
export function openSignInModal({ title = 'Sign in to RallyScore', subtitle = 'We\'ll email you a magic link — no password needed.' } = {}) {
  injectStyle();

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'rs-modal-backdrop';
    backdrop.innerHTML = `
      <div class="rs-modal" style="position:relative">
        <button class="rs-close-x" aria-label="Close">×</button>
        <h2>${title}</h2>
        <p>${subtitle}</p>
        <label for="rs-email-input">Email address</label>
        <input id="rs-email-input" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email" />
        <button class="primary" id="rs-submit-btn">Send magic link</button>
        <button class="ghost" id="rs-cancel-btn">Continue browsing</button>
        <div class="rs-status" id="rs-status"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('#rs-email-input');
    const submit = backdrop.querySelector('#rs-submit-btn');
    const cancel = backdrop.querySelector('#rs-cancel-btn');
    const close = backdrop.querySelector('.rs-close-x');
    const status = backdrop.querySelector('#rs-status');

    setTimeout(() => input.focus(), 100);

    const cleanup = (result) => {
      backdrop.remove();
      resolve(result);
    };

    submit.addEventListener('click', async () => {
      const email = input.value.trim();
      if (!email || !email.includes('@')) {
        status.className = 'rs-status error';
        status.textContent = 'Please enter a valid email.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Sending…';
      status.className = 'rs-status';
      try {
        const { error } = await signInWithMagicLink(email, window.location.href);
        if (error) throw error;
        status.className = 'rs-status success';
        status.textContent = '✓ Check your inbox — click the link to sign in.';
        submit.textContent = 'Link sent';
        setTimeout(() => cleanup({ email, sent: true }), 1500);
      } catch (e) {
        status.className = 'rs-status error';
        status.textContent = e.message || 'Something went wrong. Try again.';
        submit.disabled = false;
        submit.textContent = 'Send magic link';
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit.click();
    });

    cancel.addEventListener('click', () => cleanup({ cancelled: true }));
    close.addEventListener('click', () => cleanup({ cancelled: true }));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup({ cancelled: true });
    });
  });
}

/**
 * Show a paywall modal — used when a free user tries a Pro feature.
 * Uses Stripe Checkout if configured, otherwise shows a placeholder.
 */
export function openPaywall({ feature = 'live broadcasting' } = {}) {
  injectStyle();

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'rs-modal-backdrop';
    backdrop.innerHTML = `
      <div class="rs-modal" style="position:relative;max-width:420px">
        <button class="rs-close-x" aria-label="Close">×</button>
        <h2>Upgrade to Pro</h2>
        <p>${feature[0].toUpperCase() + feature.slice(1)} is a Pro feature. Try free for 7 days.</p>

        <div style="display:grid;gap:8px;margin-bottom:18px">
          <label style="display:flex;justify-content:space-between;align-items:center;padding:14px;border:2px solid #FF4D2E;background:rgba(255,77,46,0.08);border-radius:14px;cursor:pointer">
            <div>
              <div style="font-weight:700;font-size:15px">Yearly</div>
              <div style="color:#8A93AD;font-size:12px;margin-top:2px">$39.99 / year — save 33%</div>
            </div>
            <div style="text-align:right">
              <input type="radio" name="rs-plan" value="yearly" checked style="accent-color:#FF4D2E;width:20px;height:20px">
            </div>
          </label>
          <label style="display:flex;justify-content:space-between;align-items:center;padding:14px;border:1px solid #232A45;border-radius:14px;cursor:pointer">
            <div>
              <div style="font-weight:700;font-size:15px">Monthly</div>
              <div style="color:#8A93AD;font-size:12px;margin-top:2px">$4.99 / month</div>
            </div>
            <input type="radio" name="rs-plan" value="monthly" style="accent-color:#FF4D2E;width:20px;height:20px">
          </label>
        </div>

        <ul style="list-style:none;padding:0;margin:0 0 18px;font-size:13px;color:#8A93AD">
          <li style="padding:4px 0">✓ Live video broadcasts to family</li>
          <li style="padding:4px 0">✓ Real-time score updates and notifications</li>
          <li style="padding:4px 0">✓ Auto-clipped highlights of your kid's points</li>
          <li style="padding:4px 0">✓ Season stats and league standings</li>
        </ul>

        <button class="primary" id="rs-checkout-btn">Start 7-day free trial</button>
        <button class="ghost" id="rs-cancel-btn">Maybe later</button>
        <div class="rs-status" id="rs-status"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const checkout = backdrop.querySelector('#rs-checkout-btn');
    const cancel = backdrop.querySelector('#rs-cancel-btn');
    const close = backdrop.querySelector('.rs-close-x');
    const status = backdrop.querySelector('#rs-status');

    const cleanup = (result) => {
      backdrop.remove();
      resolve(result);
    };

    checkout.addEventListener('click', async () => {
      const plan = backdrop.querySelector('input[name=rs-plan]:checked').value;
      const stripeReady = config.STRIPE_PUBLISHABLE_KEY && !config.STRIPE_PUBLISHABLE_KEY.includes('YOUR_');

      if (!stripeReady) {
        status.className = 'rs-status success';
        status.textContent = `[Demo mode] Selected ${plan} plan. In production, this opens Stripe Checkout.`;
        setTimeout(() => cleanup({ plan, demoMode: true }), 1800);
        return;
      }

      // Real Stripe Checkout flow:
      checkout.disabled = true;
      checkout.textContent = 'Redirecting…';
      try {
        const user = await getUser();
        if (!user) {
          // Need to sign in first
          cleanup({ needsAuth: true, plan });
          return;
        }
        // Call your serverless endpoint to create the Stripe session.
        // Add this endpoint to your Vercel project as /api/create-checkout-session
        const res = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, userId: user.id, email: user.email })
        });
        const { url, error } = await res.json();
        if (error) throw new Error(error);
        window.location.href = url;
      } catch (e) {
        status.className = 'rs-status error';
        status.textContent = e.message || 'Could not start checkout.';
        checkout.disabled = false;
        checkout.textContent = 'Start 7-day free trial';
      }
    });

    cancel.addEventListener('click', () => cleanup({ cancelled: true }));
    close.addEventListener('click', () => cleanup({ cancelled: true }));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup({ cancelled: true });
    });
  });
}

/** Require the user to be signed in before continuing. */
export async function requireAuth(options) {
  const user = await getUser();
  if (user) return user;
  await openSignInModal(options);
  return null; // user has to come back from the magic link
}

/** Require an active Pro subscription. Returns true if good, false otherwise. */
export async function requirePro(featureName) {
  const user = await getUser();
  if (!user) {
    const r = await openSignInModal();
    if (!r?.sent) return false;
    return false; // they need to come back
  }
  const ok = await hasProAccess();
  if (!ok) {
    await openPaywall({ feature: featureName });
    return false;
  }
  return true;
}

export { signOut, getUser, getProfile };
