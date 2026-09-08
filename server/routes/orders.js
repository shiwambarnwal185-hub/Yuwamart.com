const express = require('express');
const { pool } = require('../db');
const sendOrderNotificationEmail = require('../sendEmail');
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();

// ---- Service area configuration: Birgunj + Pakaha Mainpur Municipality (Parsa District) ----
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
function checkServiceArea(lat, lng) {
  let nearestDistance = Infinity;
  let inside = false;
  for (const zone of SERVICE_ZONES) {
    const d = haversineKm(lat, lng, zone.center.lat, zone.center.lng);
    if (d < nearestDistance) nearestDistance = d;
    if (d <= zone.radiusKm) inside = true;
  }
  return { inside, distanceKm: nearestDistance };
}

async function nextOrderNumber() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM orders');
  return 1042 + parseInt(rows[0].c, 10);
}

router.post('/', optionalAuth, async (req, res) => {
  try {
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
    const orderId = 'YM' + (await nextOrderNumber());

    await pool.query(
      `INSERT INTO orders (id, customer_id, otp, name, phone, address, lat, lng, gps_address,
                item_total, delivery_fee, grand_total, eta_min, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Confirmed')`,
      [orderId, req.user ? req.user.id : null, otp, name, phone, address, lat, lng, gps_address || null,
       itemTotal, deliveryFee, grandTotal, etaMin]
    );

    for (const it of items) {
      await pool.query(
        'INSERT INTO order_items (order_id, product_name, price, qty) VALUES ($1, $2, $3, $4)',
        [orderId, it.name, it.price, it.qty]
      );
    }

    // Email the owner — fire and forget, never blocks the customer's order confirmation
    sendOrderNotificationEmail({
      id: orderId, customerId: req.user ? req.user.id : null, name, phone, address,
      lat, lng, items, itemTotal, deliveryFee, grandTotal, etaMin, otp,
    }).catch(() => {});

    res.json({ id: orderId, otp, itemTotal, deliveryFee, grandTotal, etaMin, status: 'Confirmed' });
  } catch (err) {
    console.error('create order error:', err.message);
    res.status(500).json({ error: 'Could not place order. Please try again.' });
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const ordersRes = await pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const withItems = await Promise.all(ordersRes.rows.map(async (o) => {
      const itemsRes = await pool.query('SELECT product_name AS name, price, qty FROM order_items WHERE order_id = $1', [o.id]);
      return { ...o, items: itemsRes.rows };
    }));
    res.json(withItems);
  } catch (err) {
    console.error('my orders error:', err.message);
    res.status(500).json({ error: 'Could not load your orders.' });
  }
});

router.get('/', requireAdmin, async (req, res) => {
  try {
    const ordersRes = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
    const withItems = await Promise.all(ordersRes.rows.map(async (o) => {
      const itemsRes = await pool.query('SELECT product_name AS name, price, qty FROM order_items WHERE order_id = $1', [o.id]);
      return { ...o, items: itemsRes.rows };
    }));
    res.json(withItems);
  } catch (err) {
    console.error('admin orders error:', err.message);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

router.put('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['Confirmed', 'Packed', 'Out for Delivery', 'Delivered'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const existingRes = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!existingRes.rows[0]) return res.status(404).json({ error: 'Order not found.' });
    await pool.query('UPDATE orders SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('update status error:', err.message);
    res.status(500).json({ error: 'Could not update status.' });
  }
});

router.get('/config', (req, res) => {
  res.json({ zones: SERVICE_ZONES, minOrder: MIN_ORDER_AMOUNT });
});

module.exports = router;
