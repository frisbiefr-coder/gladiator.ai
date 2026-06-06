import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  starter_monthly: { credits: 100, amount: 990, name: 'Starter' },
  pro_monthly:     { credits: 225, amount: 1990, name: 'Pro' },
  ultra_monthly:   { credits: 500, amount: 3990, name: 'Ultra' },
  starter_yearly:  { credits: 100, amount: 890, name: 'Starter Annuel' },
  pro_yearly:      { credits: 225, amount: 1790, name: 'Pro Annuel' },
  ultra_yearly:    { credits: 500, amount: 3490, name: 'Ultra Annuel' },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan, userId, email } = req.body;
  const planKey = plan ? plan.toLowerCase() : '';

  if (!plan || !userId || !PLANS[planKey]) {
    return res.status(400).json({ error: 'Paramètres invalides', plan, userId });
  }

  const selectedPlan = PLANS[planKey];
  const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://gladiator-ai-rho.vercel.app';

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Limineo AI — Pack ${selectedPlan.name}`,
            description: `${selectedPlan.credits} crédits IA`
          },
          unit_amount: selectedPlan.amount
        },
        quantity: 1
      }],
      metadata: { userId, credits: selectedPlan.credits, plan: planKey },
      success_url: `${baseUrl}/?success=true`,
      cancel_url: `${baseUrl}/?canceled=true`
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Stripe error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
