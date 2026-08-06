const express = require("express");
const { authenticate } = require("../middleware/authMiddleware");
const Business = require("../models/Business");
const Bid = require("../models/Bid");
const BuyerWishlist = require("../models/wishlist");
const Payment = require("../models/payments");
const { getCSVCompanies } = require("../controllers/businessController");

const Razorpay = require("razorpay");
const crypto = require("crypto");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Buyer
 *   description: Buyer related operations
 */

/* -------------------------------------------------------------------------- */
/* 🏢 BUSINESS LISTINGS - Get all active listings                             */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/business-listings:
 *   get:
 *     summary: Get all active business listings available for sale
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of active businesses
 */
router.get("/business-listings", authenticate, async (req, res) => {
  try {
    const listings = await Business.find({ verified: true })
      .populate("seller", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: listings.length,
      businesses: listings,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



/* -------------------------------------------------------------------------- */
/* 💸 PLACE A BID                                                             */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/place-bid:
 *   post:
 *     summary: Place a bid on a business
 *     description: |
 *       Allows a **buyer** to place a bid on a business.  
 *       The bid amount must be **greater** than the current highest bid saved in the Business document.
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []   # Requires JWT token
 * 
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - businessId
 *               - amount
 *             properties:
 *               businessId:
 *                 type: string
 *                 example: "6720a80f3f8b3a1d2e1a5b8f"
 *               amount:
 *                 type: number
 *                 example: 25000
 * 
 *     responses:
 *       201:
 *         description: Bid placed successfully, highest bid updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Bid placed successfully"
 *                 highestBid:
 *                   type: number
 *                   example: 25000
 *                 highestBidder:
 *                   type: string
 *                   example: "67089b94ac836a0bca6ad7fb"
 *                 bid:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     buyer:
 *                       type: string
 *                     business:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     status:
 *                       type: string
 *                       example: "pending"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 * 
 *       400:
 *         description: Bid amount is lower than current highest bid
 * 
 *       403:
 *         description: Only buyers can place bids
 * 
 *       404:
 *         description: Business not found
 * 
 *       500:
 *         description: Server error
 */

router.post("/place-bid", authenticate, async (req, res) => {
  try {
    // Gate on the canBuy CAPABILITY, so a seller who registered to buy can bid.
    if (!req.user.canBuy)
      return res.status(403).json({ message: "Your account is not enabled to bid. Register to buy first." });

    const { businessId, amount } = req.body;

    const business = await Business.findById(businessId);

    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    // Compare with business highest bid
    const currentHighest = business.highestBid || 0;

    if (amount <= currentHighest) {
      return res.status(400).json({
        message: `Bid must be greater than current highest bid: ${currentHighest}`,
      });
    }

    // Save new bid entry
    const bid = await Bid.create({
      buyer: req.user._id,
      business: businessId,
      amount,
      status: "pending",
    });

    // Update the highest bid on business
    business.highestBid = amount;
    business.highestBidder = req.user._id;

    await business.save();

    res.status(201).json({
      message: "Bid placed successfully",
      highestBid: business.highestBid,
      highestBidder: business.highestBidder,
      bid,
    });

  } catch (error) {
    console.error("Place bid error:", error);
    res.status(500).json({ message: error.message });
  }
});


/* -------------------------------------------------------------------------- */
/* 📜 VIEW ALL BUYER BIDS                                                     */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/my-bids:
 *   get:
 *     summary: Get all bids placed by the logged-in buyer
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all bids placed by buyer
 */
router.get("/my-bids", authenticate, async (req, res) => {
  try {
    const bids = await Bid.find({ buyer: req.user._id })
      .populate("business", "name category price location")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: bids.length, bids });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* -------------------------------------------------------------------------- */
/* ✏️ UPDATE BID                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/update-bid/{bidId}:
 *   put:
 *     summary: Update a bid
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: bidId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *                 example: 13000000
 *     responses:
 *       200:
 *         description: Bid updated successfully
 */
router.put("/update-bid/:bidId", authenticate, async (req, res) => {
  try {
    const { bidId } = req.params;
    const { amount } = req.body;

    const updatedBid = await Bid.findOneAndUpdate(
      { _id: bidId, buyer: req.user._id },
      { amount },
      { new: true }
    );

    if (!updatedBid)
      return res.status(404).json({ message: "Bid not found or unauthorized" });

    res.status(200).json({ message: "Bid updated successfully", bid: updatedBid });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* -------------------------------------------------------------------------- */
/* 🏆 WON BIDS - Bids where buyer won                                         */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/won-bids:
 *   get:
 *     summary: Get all won bids for the logged-in buyer
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of all won bids
 */
router.get("/won-bids", authenticate, async (req, res) => {
  try {
    const wonBids = await Bid.find({ buyer: req.user._id, status: "won" })
      .populate("business", "name category price location");

    res.status(200).json({ success: true, wonBids });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* -------------------------------------------------------------------------- */
/* ❌ CANCEL BID                                                              */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/cancel-bid/{bidId}:
 *   delete:
 *     summary: Cancel a bid
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: bidId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bid cancelled successfully
 */
router.delete("/cancel-bid/:bidId", authenticate, async (req, res) => {
  try {
    const { bidId } = req.params;

    const deleted = await Bid.findOneAndDelete({ _id: bidId, buyer: req.user._id });
    if (!deleted)
      return res.status(404).json({ message: "Bid not found or unauthorized" });

    res.status(200).json({ message: "Bid cancelled successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* -------------------------------------------------------------------------- */
/* 💳 PAY FOR ACCEPTED BID                                                   */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/pay/{bidId}:
 *   post:
 *     summary: Initiate payment for a winning bid
 *     description: Creates a Razorpay order for the bid amount so the buyer can pay online.
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema:
 *           type: string
 *           example: "6730a9cf4f8b1e1c6a96d333"
 *         description: ID of the bid to be paid
 *     responses:
 *       200:
 *         description: Razorpay order created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 key:
 *                   type: string
 *                   example: rzp_test_abc123xyz
 *                 order_id:
 *                   type: string
 *                   example: order_Fg83jsljf938sL
 *                 amount:
 *                   type: integer
 *                   example: 1500000
 *                 currency:
 *                   type: string
 *                   example: INR
 *                 bidId:
 *                   type: string
 *                   example: 6730a9cf4f8b1e1c6a96d333
 *                 businessName:
 *                   type: string
 *                   example: "TechCorp Pvt. Ltd."
 *       400:
 *         description: Only winning bids can be paid
 *       404:
 *         description: Bid not found
 *       500:
 *         description: Payment initialization failed
 */
router.post("/pay/:bidId", async (req, res) => {
  try {
    const { bidId } = req.params;
    const bid = await Bid.findById(bidId).populate("business");

    if (!bid) return res.status(404).json({ message: "Bid not found" });
    if (bid.status !== "won")
      return res.status(400).json({ message: "Only winning bids can be paid" });

    const amount = bid.amount * 100; // Razorpay expects amount in paise

    const options = {
      amount: amount,
      currency: "INR",
      receipt: `receipt_${bid._id}`,
      notes: {
        business: bid.business?.name || "Business Purchase",
      },
    };

    const order = await razorpay.orders.create(options);

    res.status(200).json({
      success: true,
      key: process.env.RAZORPAY_KEY_ID,
      order_id: order.id,
      currency: "INR",
      amount,
      bidId: bid._id,
      businessName: bid.business?.name || "",
    });
  } catch (error) {
    console.error("❌ Payment init error:", error);
    res.status(500).json({ message: "Payment initialization failed" });
  }
});


/**
 * @swagger
 * /api/buyer/verify-payment/{bidId}:
 *   post:
 *     summary: Verify Razorpay payment and mark bid as paid
 *     description: Verifies payment signature from Razorpay and updates the bid status to 'paid'.
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema:
 *           type: string
 *           example: "6730a9cf4f8b1e1c6a96d333"
 *         description: ID of the bid for which payment is being verified
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - razorpay_order_id
 *               - razorpay_payment_id
 *               - razorpay_signature
 *             properties:
 *               razorpay_order_id:
 *                 type: string
 *                 example: order_Fg83jsljf938sL
 *               razorpay_payment_id:
 *                 type: string
 *                 example: pay_Fk72ksj29fkLs
 *               razorpay_signature:
 *                 type: string
 *                 example: d1b3a3e9ec3dafe9a9cba451d4b98216d5c3a68d6d593ee56e674f8a9c239c85
 *     responses:
 *       200:
 *         description: Payment verified successfully and bid marked as paid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Payment verified and bid marked as paid"
 *       400:
 *         description: Invalid signature or payment verification failed
 *       500:
 *         description: Server error while verifying payment
 */

router.post("/verify-payment/:bidId", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const { bidId } = req.params;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      await Bid.findByIdAndUpdate(bidId, {
        status: "paid",
        paymentId: razorpay_payment_id,
      });

      res.status(200).json({ success: true, message: "Payment verified and bid marked as paid" });
    } else {
      res.status(400).json({ success: false, message: "Invalid signature, payment verification failed" });
    }
  } catch (error) {
    console.error("❌ Payment verify error:", error);
    res.status(500).json({ message: "Verification failed", error });
  }
});


/**
 * @swagger
 * /api/buyer/payments:
 *   get:
 *     summary: Get all payments of the logged-in buyer
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *
 *     description: |
 *       Returns a list of all payments made by the logged-in buyer, including:
 *       - Payment details  
 *       - Business details  
 *       - Bid amount  
 *       - Payment status  
 *       - Transaction details  
 *
 *     responses:
 *       200:
 *         description: Payments fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 2
 *                 payments:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                         example: "PAY_9012ABCD1234"
 *
 *                       user:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "69079b94ac836a0bca6ad7fb"
 *                           name:
 *                             type: string
 *                             example: "Aman Sharma"
 *                           email:
 *                             type: string
 *                             example: "aman@gmail.com"
 *
 *                       business:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "690c226c766fbda6f96bf483"
 *                           companyName:
 *                             type: string
 *                             example: "Bhagat Ayurvedic Pvt Ltd"
 *                           categoryOfCompany:
 *                             type: string
 *                             example: "Company limited by shares"
 *                           registeredAddress:
 *                             type: string
 *                             example: "123 Business Street, New Delhi"
 *
 *                       bidId:
 *                         type: string
 *                         example: "6918de88eb4db0622f95f117"
 *
 *                       amount:
 *                         type: number
 *                         example: 120000
 *
 *                       paymentStatus:
 *                         type: string
 *                         example: "success"
 *                         enum: [success, failed, pending]
 *
 *                       paymentMethod:
 *                         type: string
 *                         example: "UPI"
 *
 *                       transactionId:
 *                         type: string
 *                         example: "TXN_44G77J8HHS2"
 *
 *                       currency:
 *                         type: string
 *                         example: "INR"
 *
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-11-18T06:50:12.300Z"
 *
 *       500:
 *         description: Server error
 */

router.get("/payments", authenticate, async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.user._id })
      .populate("business", "companyName categoryOfCompany registeredAddress")
      .populate("user", "name email");

    return res.status(200).json({
      success: true,
      count: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Payments fetch error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});



/* -------------------------------------------------------------------------- */
/* 🩵 WISHLIST APIs                                                          */
/* -------------------------------------------------------------------------- */

/**
 * @swagger
 * /api/buyer/wishlist:
 *   post:
 *     summary: Add a business to wishlist
 *     tags: [Buyer - Wishlist]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - businessId
 *             properties:
 *               businessId:
 *                 type: string
 *                 description: ID of the business to add to wishlist
 *               notes:
 *                 type: string
 *                 description: Optional notes added by the buyer
 *     responses:
 *       201:
 *         description: Business added to wishlist successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 wishlist:
 *                   $ref: '#/components/schemas/BuyerWishlist'
 *       400:
 *         description: Bad request (business already exists or missing fields)
 *       404:
 *         description: Business not found
 *       500:
 *         description: Server error
 */

// routes/buyerRoutes.js

router.post("/wishlist", authenticate, async (req, res) => {
  try {
    const { businessId, notes } = req.body;
    const buyerId = req.user._id;

    if (!businessId) {
      return res.status(400).json({ message: "businessId is required" });
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return res.status(404).json({ message: "Business not found" });
    }

    // ✅ use BuyerWishlist model here
    const existing = await BuyerWishlist.findOne({
      buyer: buyerId,
      business: businessId,
    });

    if (existing) {
      return res
        .status(400)
        .json({ message: "Already added to wishlist" });
    }

    // ✅ use BuyerWishlist model here too
    const wishlistItem = await BuyerWishlist.create({
      buyer: buyerId,
      business: businessId,
      seller: business.seller, // important: your schema requires this
      notes,
    });

    return res.status(201).json({
      success: true,
      message: "Added to wishlist",
      wishlist: wishlistItem,
    });
  } catch (error) {
    console.error("Wishlist error:", error);
    return res.status(500).json({ message: error.message });
  }
});




/**
 * @swagger
 * /api/buyer/wishlist/view:
 *   get:
 *     summary: Get all wishlist items of the logged-in buyer
 *     tags: [Buyer Wishlist]
 *     security:
 *       - bearerAuth: []
 *
 *     description: |
 *       Returns detailed wishlist items for the logged-in buyer including:
 *       - Business details  
 *       - User’s bid (myBidAmount)  
 *       - Current highest bid  
 *       - Total number of bids  
 *       - Time left for auction  
 *       - Auction status (Live, Outbid, Ended)  
 *       - Seller details  
 *
 *     responses:
 *       200:
 *         description: Wishlist fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   example: 1
 *                 wishlist:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       businessId:
 *                         type: string
 *                         example: "690c226c766fbda6f96bf483"
 *
 *                       businessName:
 *                         type: string
 *                         example: "AUBJBJBK"
 *
 *                       categoryOfCompany:
 *                         type: string
 *                         example: "Company limited by shares"
 *
 *                       registeredAddress:
 *                         type: string
 *                         example: "123 Business Street, New Delhi"
 *
 *                       myBidAmount:
 *                         type: number
 *                         example: 120000
 *
 *                       currentHighestBid:
 *                         type: number
 *                         example: 125000
 *
 *                       bidsCount:
 *                         type: number
 *                         example: 8
 *
 *                       timeLeft:
 *                         type: string
 *                         example: "2h 45m left"
 *
 *                       status:
 *                         type: string
 *                         enum: [Live, Outbid, Ended]
 *                         example: "Outbid"
 *
 *                       seller:
 *                         type: object
 *                         description: Seller (owner of the business)
 *                         properties:
 *                           _id:
 *                             type: string
 *                             example: "69079b94ac836a0bca6ad7fb"
 *                           name:
 *                             type: string
 *                             example: "John Seller"
 *                           email:
 *                             type: string
 *                             example: "seller@example.com"
 *
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2025-11-15T20:11:52.808Z"
 *
 *       401:
 *         description: Unauthorized — Invalid or missing token
 *
 *       500:
 *         description: Server error
 */


router.get("/wishlist/view", authenticate, async (req, res) => {
  console.log("➡️  wishlist/view route HIT");
  console.log("User:", req.user);

  try {
    const items = await BuyerWishlist.find({ buyer: req.user._id })
      .populate("business", "companyName categoryOfCompany registeredAddress auctionDetails highestBid highestBidder")
      .populate("seller", "name email");

    const result = await Promise.all(
      items.map(async (item) => {
        const business = item.business;

        // 🟦 Get all bids on this business
        const allBids = await Bid.find({ business: business._id });
        const bidsCount = allBids.length;
        const currentHighestBid =
          bidsCount > 0 ? Math.max(...allBids.map((b) => b.amount)) : 0;

        // 🟦 Get user's bid
        const myBidObj = await Bid.findOne({
          business: business._id,
          buyer: req.user._id,
        });

        const myBidAmount = myBidObj ? myBidObj.amount : 0;

        // 🟦 Time left calculation (auctionDetails is an ARRAY)
        let timeLeft = "N/A";

        const auction = business.auctionDetails?.[0]; // FIRST element

        if (auction && auction.endTime) {
          const now = new Date();
          const msLeft = new Date(auction.endTime) - now;

          if (msLeft > 0) {
            const h = Math.floor(msLeft / (1000 * 60 * 60));
            const m = Math.floor((msLeft / (1000 * 60)) % 60);
            timeLeft = `${h}h ${m}m left`;
          } else {
            timeLeft = "Ended";
          }
        }

        // 🟦 Status logic
        let status = "Live";

        if (timeLeft === "Ended") {
          status = "Ended";
        } else if (myBidAmount < currentHighestBid && myBidAmount !== 0) {
          status = "Outbid";
        }

        return {
          businessId: business._id,
          businessName: business.companyName,
          categoryOfCompany: business.categoryOfCompany,
          registeredAddress: business.registeredAddress,

          myBidAmount,
          currentHighestBid,
          bidsCount,
          timeLeft,
          status,

          seller: item.seller,
          createdAt: item.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: result.length,
      wishlist: result,
    });
  } catch (error) {
    console.error("❌ Wishlist view error:", error);
    return res.status(500).json({ message: error.message });
  }
});




/**
 * @swagger
 * /api/buyer/wishlist/{businessId}:
 *   delete:
 *     summary: Remove a business from wishlist
 *     tags: [Buyer]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: businessId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the business to remove from wishlist
 *     responses:
 *       200:
 *         description: Successfully removed
 *       404:
 *         description: Not found
 *       500:
 *         description: Server error
 */

router.delete("/wishlist/:businessId", authenticate, async (req, res) => {
  console.log("➡️ DELETE wishlist hit");
  console.log("BusinessId:", req.params.businessId);
  console.log("Buyer:", req.user._id);

  try {
    const { businessId } = req.params;

    await BuyerWishlist.findOneAndDelete({
      buyer: req.user._id,
      business: businessId,
    });

    return res.status(200).json({ message: "Removed from wishlist" });

  } catch (error) {
    console.error("❌ DELETE wishlist error:", error);
    return res.status(500).json({ message: error.message });
  }
});


module.exports = router;
