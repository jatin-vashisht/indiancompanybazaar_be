const express = require("express");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Payment = require("../models/payments");
const router = express.Router();

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
    const { amount, currency = "INR", receipt, notes } = req.body;

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
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
      // Record the successful payment for the buyer's payment history.
      // userId/businessId/amount are sent by the checkout page.
      const { userId, businessId, amount } = req.body;
      if (userId && businessId) {
        try {
          await Payment.create({
            user: userId,
            business: businessId,
            amount,
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
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, error: "userId is required" });

    const payments = await Payment.find({ user: userId, status: "success" })
      .sort({ createdAt: -1 })
      .populate("business", "companyName CIN registeredAddress");

    res.json({ success: true, count: payments.length, payments });
  } catch (error) {
    console.error("Fetch payments error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch payments" });
  }
});

module.exports = router;
