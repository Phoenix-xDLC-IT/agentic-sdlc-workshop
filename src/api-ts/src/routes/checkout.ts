import express from 'express';
import { createCheckoutSession, getCheckoutStatus, handleStripeWebhook } from '../services/checkout';

/**
 * @swagger
 * /api/checkout/sessions:
 *   post:
 *     summary: Create a secure Stripe Checkout session
 *     tags: [Checkout]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId: { type: integer, minimum: 1 }
 *                     quantity: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       201:
 *         description: Hosted payment URL and session ID
 *       400:
 *         description: Invalid cart
 *       503:
 *         description: Payment provider is not configured
 * /api/checkout/sessions/{id}:
 *   get:
 *     summary: Verify payment and retrieve checkout status
 *     tags: [Checkout]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Payment status and, when paid, order ID
 * /api/checkout/webhook:
 *   post:
 *     summary: Receive signed Stripe Checkout events
 *     tags: [Checkout]
 *     responses:
 *       200:
 *         description: Event accepted
 */

interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

const router = express.Router();

router.post('/sessions', async (req, res, next) => {
  try {
    const session = await createCheckoutSession(req.body?.items);
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const status = await getCheckoutStatus(req.params.id);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.post('/webhook', async (req: RawBodyRequest, res, next) => {
  try {
    if (!req.rawBody) {
      res.status(400).json({ error: { code: 'INVALID_WEBHOOK', message: 'Invalid payment event.' } });
      return;
    }
    await handleStripeWebhook(req.rawBody, req.header('stripe-signature'));
    res.sendStatus(200);
  } catch (error) {
    next(error);
  }
});

export default router;
