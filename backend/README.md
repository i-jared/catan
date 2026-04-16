# Catan Backend

Production-oriented backend for the base Settlers of Catan ruleset.

## Runtime

- Node 22+
- PostgreSQL 14+

## Environment

- `DATABASE_URL`
  Required in production. When omitted, the backend uses in-memory storage for local development and tests.
- `PORT`
  Optional. Defaults to `8080`.
- `HOST`
  Optional. Defaults to `127.0.0.1`.
- `NODE_ENV`
  Set to `production` in deployed environments.

## Setup

```bash
cd backend
npm install
DATABASE_URL=postgres://... npm run migrate
DATABASE_URL=postgres://... npm run build
DATABASE_URL=postgres://... npm start
```

## Notes

- The server exposes REST endpoints plus a WebSocket endpoint at `/v1/ws`.
- Tokens are stored hashed in the database.
- Command idempotency and optimistic version checks are enforced.
- The backend refuses to start in `production` without `DATABASE_URL`.
