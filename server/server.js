require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 3000;

// Product photos are now stored as base64 directly in the database (see
// routes/products.js), so no local /uploads folder is needed any more —
// this also means photos survive restarts and redeploys on Render's free tier.

app.use(cors());
app.use(express.json({ limit: '10mb' })); // higher limit to allow base64 photo uploads

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/settings', settingsRoutes);

// Serve the frontend (public/index.html) for everything else
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Yuwa Mart server running at http://localhost:${PORT}`);
      console.log(`Service area: Birgunj + Pakaha Mainpur Municipality (Parsa District)`);
      console.log(`Admin password: ${process.env.ADMIN_PASSWORD || 'yur@2020'} (change this in .env)`);
      console.log(`Email notifications: ${(process.env.RESEND_API_KEY && process.env.OWNER_EMAIL) ? 'ENABLED (' + process.env.OWNER_EMAIL + ')' : 'not configured (see .env.example)'}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err.message);
    process.exit(1);
  });
