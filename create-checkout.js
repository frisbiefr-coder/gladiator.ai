import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter: { credits: 20, amount: 299, name: 'Starter — 20 crédits' },
  pro:     { credits: 60, amount: 699, name: 'Pro — 60 crédits' },
  ultra:   { credits: 150, amount: 1499, name: 'Ultra — 150 crédits' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan, userId, email } = req.body;
  if (!plan || !userId || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  const selectedPlan = PLANS[plan];
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Gladiator AI — ${selectedPlan.name}` },
          unit_amount: selectedPlan.amount
        },
        quantity: 1
      }],
      metadata: { userId, plan, credits: selectedPlan.credits.toString() },
      success_url: `${baseUrl}/?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/?cancelled=true`
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: 'Payment error' });
  }
}
