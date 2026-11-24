PRA / FBR SIMULATOR — VERCEL VERSION
====================================

Files
-----
app.js        Express application entry point
database.js   PostgreSQL connection and transaction queries
routes.js     Health, sale, verification and transaction endpoints
vercel.json  Vercel deployment routing
package.json  Node.js dependencies

1. Configure Neon
-----------------
Create a PostgreSQL database in Neon and copy its connection string.

In Vercel:
Project > Settings > Environment Variables

Add:
DATABASE_URL = your Neon PostgreSQL connection string

Apply it to the environment(s) you will use, then redeploy.

2. Deploy
---------
Import this project into Vercel from GitHub, or deploy it using the Vercel CLI.

The database table is created automatically on the first database-backed request.
No separate migration command is required.

3. Endpoints
------------
GET  /health
POST /api/v1/sale
GET  /api/v1/verify/{unique_code}
GET  /api/v1/transaction/{transaction_id}

4. Local testing
----------------
npm install
Set DATABASE_URL in your shell environment.
npm start

The local server listens on port 8000 by default.

Important
---------
- Transactions persist in Neon PostgreSQL.
- QR PNG data is regenerated from the stored verification code.
- The QRCode response field is raw Base64 PNG, matching the original Python API.
- This is a simulator. It does not connect to PRA or FBR and cannot obtain
  genuine authority acceptance or verification.
- Protect the deployed API with authentication before exposing it beyond
  controlled integration testing.
