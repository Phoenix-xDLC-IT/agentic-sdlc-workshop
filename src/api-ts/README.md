# OctoSupply API (TypeScript)

Express + TypeScript reference implementation of the OctoSupply API. The C#, Python, and Java variants are ports of this service.

## Run

```bash
npm install
npm run dev
```

Default API URL: `http://localhost:3000`

## Environment

- `PORT` (default: `3000`)
- `DB_FILE` (default: `./data/app.db`)
- `API_CORS_ORIGINS` (comma-separated override; optional)
- `DB_ENABLE_WAL` (enable WAL mode; default: `true`)
- `DB_FOREIGN_KEYS` (enforce foreign keys; default: `true`)
- `DB_TIMEOUT` (busy timeout in ms; default: `30000`)
- `PAYMENT_PROVIDER` (`stripe`, default: `stripe`)
- `STRIPE_SECRET_KEY` (required; server-side Stripe API key)
- `STRIPE_WEBHOOK_SECRET` (required to verify Stripe payment events)
- `PAYMENT_CURRENCY` (three-letter currency code; default: `USD`)
- `CHECKOUT_BRANCH_ID` (order branch ID; default: `1`)
- `CHECKOUT_FRONTEND_URL` (frontend origin for checkout redirects; default: `http://localhost:5137`)

Checkout uses Stripe-hosted payment pages; card details are never handled by this API or stored by the application. Configure a Stripe webhook for `/api/checkout/webhook` and subscribe to `checkout.session.completed`, `checkout.session.expired`, and `checkout.session.async_payment_failed`.

## Database

On startup, the API applies SQL migrations from:

- `../database/migrations/*.sql`

and seeds from:

- `../database/seed/*.sql`

## OpenAPI

- OpenAPI JSON: `http://localhost:3000/api-docs.json`
- Swagger UI: `http://localhost:3000/api-docs`

## Tests

Run TypeScript tests from the `src/` directory:

```bash
make test-ts
```
