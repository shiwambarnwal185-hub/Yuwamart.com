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
    radiusKm: parseFloat(process.env.PAKAHA_MAINPUR_RADIUS_KM || '10'),
  },
];
const MIN_ORDER_AMOUNT = parseFloat(process.env.MIN_ORDER_AMOUNT || '100');
// Courier shipping charge (gifts/electronics/shoes shipped outside the local
// delivery zone — no distance-based tiers here since a real courier company
// handles the actual delivery): cheaper within Nepal, more for other countries.
const COURIER_FEE_NEPAL = parseFloat(process.env.COURIER_FEE_NEPAL || '150');
const COURIER_FEE_INTERNATIONAL = parseFloat(process.env.COURIER_FEE_INTERNATIONAL || '1000');
function computeCourierFee(itemTotal, country) {
  if (itemTotal >= FREE_DELIVERY_THRESHOLD) return 0;
  const isNepal = (country || '').trim().toLowerCase() === 'nepal';
  return isNepal ? COURIER_FEE_NEPAL : COURIER_FEE_INTERNATIONAL;
}

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
// Delivery charge tiers by distance from the nearest zone center (LOCAL orders only):
//   0–3 km  → Rs. 30
//   3–6 km  → Rs. 60
//   6–10 km → Rs. 90
// Free delivery only kicks in above the free-delivery order threshold.
const FREE_DELIVERY_THRESHOLD = parseFloat(process.env.FREE_DELIVERY_THRESHOLD || '3000');
function computeDeliveryFee(distanceKm, itemTotal) {
  if (itemTotal >= FREE_DELIVERY_THRESHOLD) return 0;
  if (distanceKm <= 3) return 30;
  if (distanceKm <= 6) return 60;
  return 90;
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

// Birgunj sits right on the Nepal-India border, so our delivery radius can
// geometrically extend a short distance into India (e.g. Raxaul). This
// double-checks the actual country via reverse geocoding so Indian
// addresses are rejected even if they fall inside the radius circle.
// If the geocoding service is briefly unavailable, we fail OPEN (allow the
// order) rather than blocking a legitimate Nepal customer over a network hiccup.
async function isInNepal(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`, {
      headers: { 'User-Agent': 'YuwaMart-OrderVerification/1.0' },
    });
    const data = await res.json();
    if (data && data.address && data.address.country_code) {
      return data.address.country_code.toLowerCase() === 'np';
    }
    return true; // couldn't determine country — fail open
  } catch (err) {
    console.error('country check failed, allowing order:', err.message);
    return true; // fail open on network/service errors
  }
}

async function nextOrderNumber() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM orders');
  return 1042 + parseInt(rows[0].c, 10);
}

async function insertOrderRecord(order) {
  await pool.query(
    `INSERT INTO orders (id, customer_id, otp, name, phone, address, lat, lng, gps_address,
              item_total, delivery_fee, grand_total, eta_min, status, order_type, shipping_city, shipping_country)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Confirmed', $14, $15, $16)`,
    [order.id, order.customerId, order.otp, order.name, order.phone, order.address,
     order.lat ?? null, order.lng ?? null, order.gpsAddress ?? null,
     order.itemTotal, order.deliveryFee, order.grandTotal, order.etaMin ?? null,
     order.orderType, order.shippingCity ?? null, order.shippingCountry ?? null]
  );
  for (const it of order.items) {
    await pool.query(
      'INSERT INTO order_items (order_id, product_name, price, qty) VALUES ($1, $2, $3, $4)',
      [order.id, it.name, it.price, it.qty]
    );
  }
}

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { name, phone, address, lat, lng, gps_address, items, shipping_city, shipping_country } = req.body;
    if (!name || !phone || !address || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Name, phone, address, and at least one item are required.' });
    }
    if (!/^9\d{9}$/.test(phone)) {
      return res.status(400).json({ error: 'Please provide a valid 10-digit Nepali mobile number (starting with 9).' });
    }
    const itemTotal = items.reduce((sum, it) => sum + it.price * it.qty, 0);
    if (itemTotal < MIN_ORDER_AMOUNT) {
      return res.status(400).json({ error: `Minimum order amount is Rs. ${MIN_ORDER_AMOUNT}.` });
    }
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    const orderId = 'YM' + (await nextOrderNumber());
    const customerId = req.user ? req.user.id : null;

    // ---- LOCAL order: customer is inside the Birgunj / Pakaha Mainpur delivery zone ----
    if (typeof lat === 'number' && typeof lng === 'number') {
      const areaCheck = checkServiceArea(lat, lng);
      if (!areaCheck.inside) {
        return res.status(403).json({ error: 'Sorry, we currently deliver locally only within Birgunj and Pakaha Mainpur Municipality (Parsa District). Your location is outside our local delivery area — courier items are still available.' });
      }
      const inNepal = await isInNepal(lat, lng);
      if (!inNepal) {
        return res.status(403).json({ error: 'Sorry, this location appears to be outside Nepal. Local delivery is only within Nepal (Birgunj and Pakaha Mainpur Municipality, Parsa District).' });
      }
      const distanceKm = areaCheck.distanceKm;
      const deliveryFee = computeDeliveryFee(distanceKm, itemTotal);
      const grandTotal = itemTotal + deliveryFee;
      const etaMin = computeEtaMinutes(distanceKm);

      await insertOrderRecord({
        id: orderId, customerId, otp, name, phone, address, lat, lng, gpsAddress: gps_address,
        itemTotal, deliveryFee, grandTotal, etaMin, orderType: 'local', items,
      });

      sendOrderNotificationEmail({
        id: orderId, customerId, name, phone, address, lat, lng, items,
        itemTotal, deliveryFee, grandTotal, etaMin, otp,
      }).catch(() => {});

      return res.json({ id: orderId, otp, itemTotal, deliveryFee, grandTotal, etaMin, orderType: 'local', status: 'Confirmed' });
    }

    // ---- COURIER order: customer is outside the local zone (anywhere in the world) ----
    if (!shipping_city || !shipping_country) {
      return res.status(400).json({ error: 'City and country are required for courier shipping.' });
    }
    const deliveryFee = computeCourierFee(itemTotal, shipping_country);
    const grandTotal = itemTotal + deliveryFee;

    await insertOrderRecord({
      id: orderId, customerId, otp, name, phone, address,
      itemTotal, deliveryFee, grandTotal, orderType: 'courier',
      shippingCity: shipping_city, shippingCountry: shipping_country, items,
    });

    sendOrderNotificationEmail({
      id: orderId, customerId, name, phone,
      address: `${address}, ${shipping_city}, ${shipping_country}`,
      items, itemTotal, deliveryFee, grandTotal, etaMin: null, otp,
    }).catch(() => {});

    res.json({ id: orderId, otp, itemTotal, deliveryFee, grandTotal, orderType: 'courier', status: 'Confirmed' });
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
    const valid = ['Confirmed', 'Packed', 'Out for Delivery', 'Shipped', 'Delivered'];
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
  res.json({ zones: SERVICE_ZONES, minOrder: MIN_ORDER_AMOUNT, freeDeliveryThreshold: FREE_DELIVERY_THRESHOLD, courierFeeNepal: COURIER_FEE_NEPAL, courierFeeInternational: COURIER_FEE_INTERNATIONAL });
});

module.exports = router;
