const express = require("express");
const crypto = require("crypto");
const QRCode = require("qrcode");
const db = require("./database");

const router = express.Router();

function generateTransactionId() {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
}

function generateUniqueCode() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `PRA-${datePart}-${randomPart}`;
}

function validateSale(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Request body must be a JSON object");
  }

  const requiredFields = [
    "POSTID",
    "USIN",
    "DateTime",
    "TotalSaleValue",
    "TotalTaxCharged",
    "PaymentMode"
  ];

  const missing = requiredFields.filter(
    (field) => !Object.prototype.hasOwnProperty.call(data, field)
  );

  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  for (const field of ["POSTID", "USIN", "PaymentMode"]) {
    if (typeof data[field] !== "string" || !data[field].trim()) {
      throw new Error(`${field} must be a non-empty string`);
    }
  }

  const numeric = (value, field, fallback) => {
    const actual = value === undefined || value === null ? fallback : value;
    if (actual === "" || !Number.isFinite(Number(actual))) {
      throw new Error(`${field} must be numeric`);
    }
    const number = Number(actual);
    if (number < 0) throw new Error(`${field} cannot be negative`);
    return number;
  };

  return {
    POSTID: data.POSTID,
    USIN: data.USIN,
    DateTime: String(data.DateTime),
    TotalSaleValue: numeric(data.TotalSaleValue, "TotalSaleValue"),
    TotalTaxCharged: numeric(data.TotalTaxCharged, "TotalTaxCharged"),
    Discount: numeric(data.Discount, "Discount", 0),
    PaymentMode: data.PaymentMode,
    BuyerName: data.BuyerName ?? null,
    BuyerPNTN_CNIC: data.BuyerPNTN_CNIC ?? null,
    RefUSIN: data.RefUSIN ?? null
  };
}

router.get("/health", async (req, res) => {
  try {
    await db.checkHealth();
    return res.json({
      success: true,
      status: "online",
      database: "connected",
      service: "PRA/FBR Simulator",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("[HEALTH CHECK]", error.message);
    return res.status(503).json({
      success: false,
      status: "degraded",
      database: "unavailable",
      service: "PRA/FBR Simulator"
    });
  }
});

router.post("/api/v1/sale", async (req, res) => {
  let sale;

  try {
    sale = validateSale(req.body);
  } catch (error) {
    return res.status(400).json({
      success: false,
      response_code: "01",
      message: error.message
    });
  }

  try {
    // The database UNIQUE constraint on USIN is the authoritative
    // duplicate check, including simultaneous requests.
    const transactionId = generateTransactionId();
    const uniqueCode = generateUniqueCode();
    const qrPayload = uniqueCode;

    // Keep the old API's QRCode format: Base64 PNG, without a data URI prefix.
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      type: "image/png",
      errorCorrectionLevel: "L",
      margin: 4,
      scale: 10
    });
    const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");

    const transaction = await db.createTransaction({
      transaction_id: transactionId,
      unique_code: uniqueCode,
      ...sale,
      QR_payload: qrPayload,
      status: "ACCEPTED"
    });

    return res.status(200).json({
      success: true,
      response_code: "00",
      message: "Transaction processed successfully",
      transaction_id: transaction.transaction_id,
      unique_code: transaction.unique_code,
      QRCode: qrBase64,
      QRCodeFormat: "PNG/Base64",
      invoice: {
        POSTID: transaction.POSTID,
        USIN: transaction.USIN,
        DateTime: transaction.DateTime,
        TotalSaleValue: transaction.TotalSaleValue,
        TotalTaxCharged: transaction.TotalTaxCharged,
        Discount: transaction.Discount,
        PaymentMode: transaction.PaymentMode,
        BuyerName: transaction.BuyerName,
        BuyerPNTN_CNIC: transaction.BuyerPNTN_CNIC,
        RefUSIN: transaction.RefUSIN
      },
      authority: {
        name: "PRA/FBR SIMULATOR",
        status: "ACCEPTED",
        verification_code: transaction.unique_code
      }
    });
  } catch (error) {
    if (error.code === "23505" && error.constraint?.includes("usin")) {
      return res.status(409).json({
        success: false,
        response_code: "02",
        message: "Duplicate USIN",
        USIN: sale.USIN
      });
    }

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        response_code: "03",
        message: "Duplicate transaction identifier; please retry"
      });
    }

    console.error("[SALE PROCESSING ERROR]", error);
    return res.status(500).json({
      success: false,
      response_code: "99",
      message: "Unable to process transaction"
    });
  }
});

router.get("/api/v1/verify/:unique_code", async (req, res) => {
  try {
    const transaction = await db.findByUniqueCode(req.params.unique_code);

    if (!transaction) {
      return res.status(404).json({
        success: true,
        verified: false,
        status: "INVALID",
        message: "Invalid verification code"
      });
    }

    return res.json({
      success: true,
      verified: true,
      status: "VALID",
      message: "Transaction verified successfully",
      transaction_id: transaction.transaction_id,
      unique_code: transaction.unique_code,
      USIN: transaction.USIN,
      POSTID: transaction.POSTID,
      DateTime: transaction.DateTime,
      TotalSaleValue: transaction.TotalSaleValue,
      TotalTaxCharged: transaction.TotalTaxCharged,
      PaymentMode: transaction.PaymentMode
    });
  } catch (error) {
    console.error("[VERIFY ERROR]", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify transaction"
    });
  }
});

router.get("/api/v1/transaction/:transaction_id", async (req, res) => {
  try {
    const transaction = await db.findByTransactionId(
      req.params.transaction_id
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }

    // Match the original simulator's transaction lookup response.
    const qrDataUrl = await QRCode.toDataURL(transaction.QR_payload, {
      type: "image/png",
      errorCorrectionLevel: "L",
      margin: 4,
      scale: 10
    });
    const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, "");

    return res.json({
      success: true,
      transaction: {
        ...transaction,
        QR_base64: qrBase64
      }
    });
  } catch (error) {
    console.error("[TRANSACTION LOOKUP ERROR]", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve transaction"
    });
  }
});

module.exports = router;
