require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);

// Serve the frontend (public/index.html) for everything else
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Yuwa Mart server running at http://localhost:${PORT}`);
  console.log(`Service area: Birgunj + Pakaha Mainpur Municipality (Parsa District)`);
  console.log(`Admin password: ${process.env.ADMIN_PASSWORD || 'yur@2020'} (change this in .env)`);
});
