const express = require('express');
require('express-async-errors');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { authenticate, authorize } = require('./middleware/authMiddleware');


const swaggerDocs = require('./swagger/swagger'); // ✅ Import only this function

dotenv.config();
const app = express();

app.use(cors({
  origin: [
    "https://kahemindia.com",
    "https://www.kahemindia.com",
    "http://localhost:3000",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import routes
const authRoutes = require('./routes/authRoutes');
const businessRoutes = require('./routes/businessRoutes');
const adminRoutes = require('./routes/adminRoutes');
const orderRoutes = require('./routes/orderRoutes');

const buyerRoutes = require("./routes/buyerRoutes");
const razorpayRoutes = require("./routes/razorpayRoutes");


// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/admin',authenticate, authorize('admin'), adminRoutes);
app.use('/api/orders',authenticate, orderRoutes);
app.use("/api/buyer",authenticate, buyerRoutes);
app.use("/api/razorpay", razorpayRoutes);

// ✅ Initialize Swagger properly (only once)
swaggerDocs(app);
// app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

app.get('/', (req, res) => res.send({ ok: true, message: 'Business marketplace backend' }));

const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
