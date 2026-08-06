const express = require("express");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Payment = require("../models/payments");
const Business = require("../models/Business");
const router = express.Router();

// The amount a buyer pays is derived from the listing, NOT from the client:
// starting bid + 10% buyer's premium + 7% taxes/fees. Computing it here stops
// a caller from crafting an order for an arbitrary amount.
async function computeAmountForBusiness(businessId) {
  if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) return null;
  const business = await Business.findById(businessId).select("auctionDetails");
  if (!business) return null;
  const base = business.auctionDetails?.[0]?.startingBidAmount || 0;
  if (!base) return null;
  return Math.round(base * 1.17); // 10% premium + 7% taxes
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * @swagger
 * /api/razorpay/create-order:
 *   post:
 *     summary: Create a Razorpay order
 *     tags: [Payments]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 117000
 *               currency:
 *                 type: string
 *                 default: INR
 *               receipt:
 *                 type: string
 *               notes:
 *                 type: object
 *     responses:
 *       200:
 *         description: Razorpay order created
 *       500:
 *         description: Failed to create order
 */
router.post("/create-order", async (req, res) => {
  try {
    const { currency = "INR", receipt, notes } = req.body;
    // businessId is the source of truth for the amount (top-level or notes).
    const businessId = req.body.businessId || notes?.companyId;

    const amount = await computeAmountForBusiness(businessId);
    if (amount === null) {
      return res.status(400).json({ error: "Invalid business or no auction amount to charge" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency,
      receipt,
      notes,
    });

    res.json(order);
  } catch (error) {
    console.error("Razorpay create order error:", error);
    const message = error?.error?.description || error?.message || "Failed to create order";
    res.status(error?.statusCode || 500).json({ error: message });
  }
});

/**
 * @swagger
 * /api/razorpay/verify-payment:
 *   post:
 *     summary: Verify Razorpay payment signature
 *     tags: [Payments]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpay_order_id, razorpay_payment_id, razorpay_signature]
 *             properties:
 *               razorpay_order_id:
 *                 type: string
 *               razorpay_payment_id:
 *                 type: string
 *               razorpay_signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Payment verified
 *       400:
 *         description: Verification failed
 */
router.post("/verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      // Record the payment against the AUTHENTICATED user, with the amount
      // recomputed server-side — never trusting the client-sent userId/amount.
      const userId = req.user._id;
      const { businessId } = req.body;
      if (businessId) {
        try {
          const amount = await computeAmountForBusiness(businessId);
          await Payment.create({
            user: userId,
            business: businessId,
            amount: amount ?? 0,
            status: "success",
            paymentId: razorpay_payment_id,
          });
        } catch (e) {
          console.error("Failed to record payment:", e.message);
        }
      }

      res.json({
        verified: true,
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
      });
    } else {
      res.status(400).json({ verified: false, error: "Payment verification failed" });
    }
  } catch (error) {
    console.error("Razorpay verify error:", error);
    res.status(500).json({ error: error.message || "Verification failed" });
  }
});

/**
 * GET /api/razorpay/my-payments?userId=...
 * Returns the buyer's successful payments (payment history) with the
 * purchased company details populated.
 */
router.get("/my-payments", async (req, res) => {
  try {
    // Identity comes from the token, NOT a query param — a user can only read
    // their own payment history.
    const userId = req.user._id;

    const payments = await Payment.find({ user: userId, status: "success" })
      .sort({ createdAt: -1 })
      .populate("business", "companyName");

    res.json({ success: true, count: payments.length, payments });
  } catch (error) {
    console.error("Fetch payments error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch payments" });
  }
});

module.exports = router;
