# Yuwa Mart — Online Grocery App for Parsa District, Birgunj

A complete, real (not a static mockup) grocery delivery web app:
- Real backend server (Node.js + Express) with a real database (SQLite)
- Customer signup/login, product catalog, cart, minimum order enforcement
- Location-gated to Parsa District (Birgunj) using GPS
- Cash on Delivery checkout with an order-confirmation OTP
- Owner Dashboard to add products (with real photo upload), manage orders (with
  customer GPS location + map link), and view registered customers
- Works from any phone/device once deployed online — all data is stored on the
  server, not just in one browser

---

## 1. Running it on your own computer (for testing)

You need [Node.js](https://nodejs.org) version 18 or newer installed.

```bash
cd server
npm install
npm start
```

Then open **http://localhost:3000** in your browser (Chrome/Edge work best for
location access). On a phone on the same WiFi, you can also open
`http://YOUR-COMPUTER-IP:3000`.

The Owner Dashboard password is set to **yur@2020** in `server/.env` — change it there any time.

> Note: Your computer's own location must be inside Parsa District for the
> customer app to let you place an order (or use your browser's dev tools to
> simulate a Birgunj GPS location for testing).

---

## 2. Making it PUBLIC (so it works on any phone in Parsa District)

Running it on your own laptop is only for testing — the moment you close your
laptop or turn off WiFi, the app goes offline for everyone. To make it public
and permanently accessible, you need to **deploy** it to a hosting service.
Here are two beginner-friendly, low-cost options:

### Option A — Render.com (easiest, has a free tier)
1. Create a free account at https://render.com
2. Push this project to a GitHub repository (Render deploys from GitHub)
3. In Render, click "New" → "Web Service", connect your GitHub repo
4. Set:
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Add Environment Variables (from `server/.env.example`) in Render's dashboard:
   `ADMIN_PASSWORD`, `BIRGUNJ_RADIUS_KM`, `PAKAHA_MAINPUR_RADIUS_KM`, `MIN_ORDER_AMOUNT`, `SPARROW_TOKEN`, `SPARROW_FROM`
6. Deploy. Render gives you a public URL like `https://yuwamart.onrender.com`
   that works from any phone, anywhere in Parsa District.

**Important:** Free hosting tiers usually use temporary storage — your SQLite
database and uploaded photos may be wiped on redeploys/restarts. For a real
business, use Render's **persistent disk** add-on (small monthly cost) or
upgrade to a paid plan so your orders and photos are never lost.

### Option B — A cheap VPS (e.g., a Nepal-based or international VPS, ~$5/month)
1. Rent a small Linux VPS (DigitalOcean, Hetzner, or a local Nepali provider)
2. Install Node.js on it, copy this project over (`git clone` or `scp`)
3. Run `npm install && npm start` inside `server/`
4. Use a process manager like `pm2` so it keeps running: `npx pm2 start server.js`
5. Point a domain name (e.g., `yuwamart.com.np`) to your VPS's IP address
6. (Recommended) Set up free HTTPS with Let's Encrypt so the location/camera
   permissions work smoothly on all phones

Either way, once it's live on the internet with a real URL, share that link
with your customers in Birgunj/Parsa — the app will work from their phones
directly, and every order will show up in your Owner Dashboard in real time,
no matter which phone placed it.

---

## 3. Getting REAL SMS OTP (optional but recommended)

Right now, the OTP is generated and shown on the confirmation screen, and also
logged in your server console — but it is **not** sent as a real SMS to the
customer's phone, because that requires a paid SMS gateway account.

To enable real SMS sending in Nepal:
1. Sign up at **https://sparrowsms.com** (a Nepal-based SMS API provider)
2. Buy an SMS credit package and get your API **token**
3. In `server/.env`, set:
   ```
   SPARROW_TOKEN=your-token-here
   SPARROW_FROM=YuwaMart
   ```
4. Restart the server — OTPs (and order confirmations) will now be sent as
   real SMS to customers' phones automatically.

If you prefer a different SMS provider, edit `server/sendSms.js` — it's a
small, self-contained file.

---

## 4. Key settings you can change

All in `server/.env` (copy from `server/.env.example` if `.env` doesn't exist):

| Setting | What it controls |
|---|---|
| `ADMIN_PASSWORD` | Password to log into the Owner Dashboard (currently `yur@2020`) |
| `BIRGUNJ_RADIUS_KM` | How far (in km) from Birgunj center the app accepts orders |
| `PAKAHA_MAINPUR_RADIUS_KM` | How far (in km) from Pakaha Mainpur Municipality center the app accepts orders |
| `MIN_ORDER_AMOUNT` | Minimum order amount in NPR (currently Rs. 100) |
| `SPARROW_TOKEN` / `SPARROW_FROM` | Real SMS OTP sending (see section 3) |

**About the service area:** The app checks two separate circular zones — one
centered on Birgunj (14 km radius) and one centered on Pakaha Mainpur
Municipality (6 km radius). An order is accepted if the customer's GPS
location falls inside *either* circle. This is a practical approximation
rather than the exact official municipal boundary, since real boundaries are
irregular shapes. If you find it's letting in or blocking the wrong areas,
adjust `BIRGUNJ_RADIUS_KM` / `PAKAHA_MAINPUR_RADIUS_KM` in `.env` — or ask a
developer to upgrade this to an exact polygon boundary check using official
GIS shape files for full precision.

---

## 5. Using the Owner Dashboard

Open the app, tap the 🔐 icon (top-right), enter your admin password.

- **Products tab:** Add new products with a real photo (upload from your
  phone/computer, or paste a photo URL), edit prices any time, or delete
  items. Changes appear for customers immediately.
- **Orders tab:** See every order — customer name, phone, typed address,
  *and* their live GPS location with a "View on map" link, items ordered,
  total, OTP, and delivery ETA. Update status as you pack/deliver.
- **Customers tab:** See everyone who has registered, with their auto-generated
  Customer ID, name, contact, and join date.

---

## 6. What's real vs. what still needs you

✅ Real backend, real database — data persists and syncs across every device
✅ Real photo uploads for products
✅ Real minimum-order and delivery-area enforcement (checked on the server,
   not just in the app, so it can't be bypassed)
✅ Real order records with GPS location for every order

⚠️ SMS OTP needs a Sparrow SMS account (section 3) to send real texts
⚠️ To be reachable by customers, the server needs to be deployed online
   (section 2) — it won't work from other phones while it only runs on your
   own laptop
⚠️ Payment is Cash on Delivery only, as you requested — no online payment
   gateway is integrated

