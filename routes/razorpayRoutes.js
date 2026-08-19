const express = require("express");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const Payment = require("../models/payments");
const Business = require("../models/Business");
const Bid = require("../models/Bid");
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

// Non-refundable token required to place a bid, by bid-amount tier.
// < ₹1L → ₹5k · ₹1–5L → ₹10k · ₹5–25L → ₹25k · > ₹25L → ₹50k.
function tokenForBid(bidAmount) {
  const b = Number(bidAmount);
  if (!Number.isFinite(b) || b <= 0) return 0;
  if (b < 100000) return 5000;
  if (b <= 500000) return 10000;
  if (b <= 2500000) return 25000;
  return 50000;
}

// The lowest acceptable bid for a business: clear the starting price and beat
// the current highest bid.
function minBidForBusiness(business) {
  const starting = business.auctionDetails?.[0]?.startingBidAmount || 0;
  const highest = business.highestBid || 0;
  return Math.max(starting, highest + 1);
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
      receipt: String(receipt || `rcpt_${Date.now()}`).slice(0, 40), // Razorpay caps length
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

/* -------------------------------------------------------------------------- */
/* 🪙 BID TOKEN FLOW — pay a token before a bid is accepted                    */
/* -------------------------------------------------------------------------- */

// Create a Razorpay order for the TOKEN required to place a given bid.
// Validates capability + minimum bid + tier server-side. Does NOT place the bid.
router.post("/create-bid-order", async (req, res) => {
  try {
    if (!req.user.canBuy) {
      return res.status(403).json({ error: "Your account is not enabled to bid. Register to buy first." });
    }
    const { businessId } = req.body;
    const bidAmount = Number(req.body.bidAmount);
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: "Invalid business id" });
    }
    if (!Number.isFinite(bidAmount) || bidAmount <= 0) {
      return res.status(400).json({ error: "Invalid bid amount" });
    }

    const business = await Business.findById(businessId).select("auctionDetails highestBid");
    if (!business) return res.status(404).json({ error: "Business not found" });

    const minBid = minBidForBusiness(business);
    if (bidAmount < minBid) {
      return res.status(400).json({ error: `Your bid must be at least ${minBid}` });
    }

    const token = tokenForBid(bidAmount);
    const order = await razorpay.orders.create({
      amount: Math.round(token * 100), // paise
      currency: "INR",
      receipt: `bt_${Date.now()}`, // Razorpay caps receipt length
      notes: { type: "bid_token", businessId: String(businessId), bidAmount: String(bidAmount) },
    });

    res.json({ order, token, bidAmount, minBid });
  } catch (error) {
    console.error("create-bid-order error:", error);
    const message = error?.error?.description || error?.message || "Failed to create bid order";
    res.status(error?.statusCode || 500).json({ error: message });
  }
});

// Verify the token payment and, only then, place the bid server-side.
router.post("/verify-bid-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, businessId } = req.body;
    const bidAmount = Number(req.body.bidAmount);

    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");
    if (expected !== razorpay_signature) {
      return res.status(400).json({ verified: false, error: "Payment verification failed" });
    }

    // Re-validate everything server-side (never trust the client between steps).
    if (!req.user.canBuy) {
      return res.status(403).json({ error: "Your account is not enabled to bid." });
    }
    if (!mongoose.Types.ObjectId.isValid(businessId) || !Number.isFinite(bidAmount)) {
      return res.status(400).json({ error: "Invalid bid" });
    }
    const business = await Business.findById(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const minBid = minBidForBusiness(business);
    if (bidAmount < minBid) {
      return res.status(400).json({ error: `Your bid must be at least ${minBid}` });
    }

    // Record the (non-refundable) token payment.
    const token = tokenForBid(bidAmount);
    try {
      await Payment.create({
        user: req.user._id,
        business: businessId,
        amount: token,
        status: "success",
        paymentId: razorpay_payment_id,
      });
    } catch (e) {
      console.error("Failed to record token payment:", e.message);
    }

    // Place the bid — this only runs after the token payment is verified.
    const bid = await Bid.create({
      buyer: req.user._id,
      business: businessId,
      amount: bidAmount,
      status: "pending",
    });
    business.highestBid = bidAmount;
    business.highestBidder = req.user._id;
    await business.save();

    res.json({ verified: true, bid, highestBid: business.highestBid });
  } catch (error) {
    console.error("verify-bid-payment error:", error);
    res.status(500).json({ error: error.message || "Verification failed" });
  }
});

module.exports = router;
