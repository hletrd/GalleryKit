/**
 * US-P54: Stripe client wrapper.
 *
 * Justification for stripe dep: the official Stripe Node.js SDK is the only
 * safe way to interact with Stripe — it handles signature verification for
 * webhooks (stripe.webhooks.constructEvent) using a constant-time HMAC
 * comparison, manages checkout session creation, and exposes strongly-typed
 * responses. Rolling our own HTTP client would risk signature verification
 * bugs and miss retry/idempotency semantics. The SDK is MIT-licensed and
 * well-maintained by Stripe.
 *
 * STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required at runtime only
 * when any image has license_tier != 'none'. Both are validated lazily so
 * the server starts without them in dev (no paid images configured).
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
    if (!_stripe) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) {
            throw new Error('STRIPE_SECRET_KEY is not set. Required when license_tier != none images exist.');
        }
        _stripe = new Stripe(key, {
            apiVersion: '2026-04-22.dahlia',
            typescript: true,
        });
    }
    return _stripe;
}

export function getStripeWebhookSecret(): string {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not set. Required for webhook signature verification.');
    }
    return secret;
}

/**
 * Verify a Stripe webhook signature and return the event.
 * Throws if the signature is invalid or the secret is missing.
 */
export function constructStripeEvent(payload: string, signature: string): Stripe.Event {
    const stripe = getStripe();
    const webhookSecret = getStripeWebhookSecret();
    // stripe.webhooks.constructEvent uses constant-time HMAC comparison.
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
