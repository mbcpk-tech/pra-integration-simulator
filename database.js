const { Pool } = require("pg");

let pool;
let schemaPromise;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not configured");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon connection strings normally include sslmode=require.
      // Keep the pool small because serverless instances can scale out.
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000
    });

    pool.on("error", (error) => {
      console.error("[POSTGRES POOL ERROR]", error);
    });
  }

  return pool;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getPool();

      await db.query(`
        CREATE TABLE IF NOT EXISTS transactions (
          id BIGSERIAL PRIMARY KEY,
          transaction_id VARCHAR(64) NOT NULL UNIQUE,
          unique_code VARCHAR(64) NOT NULL UNIQUE,
          postid TEXT NOT NULL,
          usin TEXT NOT NULL UNIQUE,
          invoice_datetime TEXT NOT NULL,
          total_sale_value NUMERIC(14, 2) NOT NULL,
          total_tax_charged NUMERIC(14, 2) NOT NULL,
          discount NUMERIC(14, 2) NOT NULL DEFAULT 0,
          payment_mode TEXT NOT NULL,
          buyer_name TEXT,
          buyer_pntn_cnic TEXT,
          ref_usin TEXT,
          qr_payload TEXT NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'ACCEPTED',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })().catch((error) => {
      // Allow a later request to retry schema initialization.
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}

function toTransaction(row) {
  if (!row) return null;

  return {
    transaction_id: row.transaction_id,
    unique_code: row.unique_code,
    POSTID: row.postid,
    USIN: row.usin,
    DateTime: row.invoice_datetime,
    TotalSaleValue: Number(row.total_sale_value),
    TotalTaxCharged: Number(row.total_tax_charged),
    Discount: Number(row.discount),
    PaymentMode: row.payment_mode,
    BuyerName: row.buyer_name,
    BuyerPNTN_CNIC: row.buyer_pntn_cnic,
    RefUSIN: row.ref_usin,
    QR_payload: row.qr_payload,
    status: row.status,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at
  };
}

async function createTransaction(transaction) {
  await ensureSchema();

  const query = `
    INSERT INTO transactions (
      transaction_id, unique_code, postid, usin, invoice_datetime,
      total_sale_value, total_tax_charged, discount, payment_mode,
      buyer_name, buyer_pntn_cnic, ref_usin, qr_payload, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *
  `;

  const values = [
    transaction.transaction_id,
    transaction.unique_code,
    transaction.POSTID,
    transaction.USIN,
    transaction.DateTime,
    transaction.TotalSaleValue,
    transaction.TotalTaxCharged,
    transaction.Discount,
    transaction.PaymentMode,
    transaction.BuyerName,
    transaction.BuyerPNTN_CNIC,
    transaction.RefUSIN,
    transaction.QR_payload,
    transaction.status
  ];

  const result = await getPool().query(query, values);
  return toTransaction(result.rows[0]);
}

async function findByUniqueCode(uniqueCode) {
  await ensureSchema();
  const result = await getPool().query(
    "SELECT * FROM transactions WHERE unique_code = $1 LIMIT 1",
    [uniqueCode]
  );
  return toTransaction(result.rows[0]);
}

async function findByTransactionId(transactionId) {
  await ensureSchema();
  const result = await getPool().query(
    "SELECT * FROM transactions WHERE transaction_id = $1 LIMIT 1",
    [transactionId]
  );
  return toTransaction(result.rows[0]);
}

async function checkHealth() {
  await getPool().query("SELECT 1");
  return true;
}

module.exports = {
  ensureSchema,
  createTransaction,
  findByUniqueCode,
  findByTransactionId,
  checkHealth
};
