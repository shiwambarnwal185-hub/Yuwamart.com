const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const sendSms = require('../sendSms');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

// ---- Service area configuration: Birgunj + Pakaha Mainpur Municipality (Parsa District) ----
// Two separate zones are checked — an order is accepted if it falls inside EITHER circle.
const SERVICE_ZONES = [
  {
    name: 'Birgunj',
    center: { lat: 27.0104, lng: 84.8807 },
    radiusKm: parseFloat(process.env.BIRGUNJ_RADIUS_KM || '14'),
  },
  {
    name: 'Pakaha Mainpur Municipality',
    center: { lat: 27.0200, lng: 84.7300 },
    radiusKm: parseFloat(process.env.PAKAHA_MAINPUR_RADIUS_KM || '6'),
  },
];
const MIN_ORDER_AMOUNT = parseFloat(process.env.MIN_ORDER_AMOUNT || '100');

function toRad(v) { return (v * Math.PI) / 180; }
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function computeEtaMinutes(distanceKm) {
  const mins = 15 + distanceKm * 2.5;
  return Math.max(15, Math.min(60, Math.round(mins)));
}
// Checks all service zones and returns whether the point is inside any of them,
// plus the distance to the nearest zone center (used for the ETA estimate).
function checkServiceArea(lat, lng) {
  let nearestDistance = Infinity;
  let inside = false;
  let matchedZone = null;
  for (const zone of SERVICE_ZONES) {
    const d = haversineKm(lat, lng, zone.center.lat, zone.center.lng);
    if (d < nearestDistance) nearestDistance = d;
    if (d <= zone.radiusKm) { inside = true; matchedZone = zone.name; }
  }
  return { inside, distanceKm: nearestDistance, zone: matchedZone };
}

let nextOrderNumber = (() => {
  const row = db.prepare('SELECT COUNT(*) AS c FROM orders').get();
  return 1042 + row.c;
})();

router.post('/', optionalAuth, async (req, res) => {
  const { name, phone, address, lat, lng, gps_address, items } = req.body;
  if (!name || !phone || !address || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Name, phone, address, and at least one item are required.' });
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Location is required to place an order.' });
  }
  const areaCheck = checkServiceArea(lat, lng);
  if (!areaCheck.inside) {
    return res.status(403).json({ error: 'Sorry, we currently deliver only within Birgunj and Pakaha Mainpur Municipality (Parsa District). Your location is outside our delivery area.' });
  }
  const distanceKm = areaCheck.distanceKm;

  const itemTotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  if (itemTotal < MIN_ORDER_AMOUNT) {
    return res.status(400).json({ error: `Minimum order amount is Rs. ${MIN_ORDER_AMOUNT}.` });
  }
  const deliveryFee = 30;
  const grandTotal = itemTotal + deliveryFee;
  const etaMin = computeEtaMinutes(distanceKm);
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const orderId = 'YM' + nextOrderNumber++;
  const createdAt = new Date().toISOString();

  db.prepare(`INSERT INTO orders (id, customer_id, otp, name, phone, address, lat, lng, gps_address,
              item_total, delivery_fee, grand_total, eta_min, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?)`)
    .run(orderId, req.user ? req.user.id : null, otp, name, phone, address, lat, lng, gps_address || null,
         itemTotal, deliveryFee, grandTotal, etaMin, createdAt);

  const insertItem = db.prepare('INSERT INTO order_items (order_id, product_name, price, qty) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((rows) => { for (const it of rows) insertItem.run(orderId, it.name, it.price, it.qty); });
  insertMany(items);
  // Admin Email Notification
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: 'shiwambarnwal185@gmail.com',
    subject: `🛒 Yuwa Mart - Naya Order Aaya Hai (${name || 'Grahak'})`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #2e7d32;">🛒 Yuwa Mart Par Naya Order Aaya Hai!</h2>
        <hr />
        <p><strong>Grahak ka Naam:</strong> ${name}</p>
        <p><strong>Phone Number:</strong> ${phone}</p>
        <p><strong>Pata:</strong> ${address}</p>
        <hr />
        <h3>Order Details:</h3>
        <pre style="background: #f4f4f4; padding: 10px; border-radius: 5px;">${JSON.stringify(req.body, null, 2)}</pre>
      </div>
    `
  };

  transporter.sendMail(mailOptions, (err, info) => {
    if (err) console.log('Email Error:', err);
    else console.log('Email Sent Successfully:', info.response);
  });

  sendSms(phone, `Yuwa Mart: Your order #${orderId} is confirmed! Total Rs.${grandTotal} (COD). OTP: ${otp}. Arriving in ~${etaMin} min.`)
    .catch(() => {});

  res.json({ id: orderId, otp, itemTotal, deliveryFee, grandTotal, etaMin, status: 'Confirmed' });
});

router.get('/mine', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.id);
  const withItems = orders.map(o => ({
    ...o,
    items: db.prepare('SELECT product_name AS name, price, qty FROM order_items WHERE order_id = ?').all(o.id),
  }));
  res.json(withItems);
});

router.get('/', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  const withItems = orders.map(o => ({
    ...o,
    items: db.prepare('SELECT product_name AS name, price, qty FROM order_items WHERE order_id = ?').all(o.id),
  }));
  res.json(withItems);
});

router.put('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body;
  const valid = ['Confirmed', 'Packed', 'Out for Delivery', 'Delivered'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found.' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true });
});

router.get('/config', (req, res) => {
  res.json({ zones: SERVICE_ZONES, minOrder: MIN_ORDER_AMOUNT });
});

module.exports = router;
