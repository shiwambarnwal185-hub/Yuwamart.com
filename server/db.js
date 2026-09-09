const { Pool } = require('pg');

// DATABASE_URL comes from your free Postgres provider (e.g. Neon.tech or Supabase).
// This is what makes your data (products, orders, customers) permanent —
// it survives every restart, sleep, and redeploy, unlike Render's local disk.
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Add it in your .env file (see .env.example).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'grocery',
      category TEXT,
      name TEXT NOT NULL,
      weight TEXT,
      price NUMERIC NOT NULL,
      old_price NUMERIC,
      image_url TEXT
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data BYTEA;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_mime TEXT;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS image_version INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      otp TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      gps_address TEXT,
      item_total NUMERIC NOT NULL,
      delivery_fee NUMERIC NOT NULL,
      grand_total NUMERIC NOT NULL,
      eta_min INTEGER,
      status TEXT NOT NULL DEFAULT 'Confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      qty INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Seed empty contact-info settings the first time (owner fills these in later)
  const contactKeys = ['contact_phone', 'contact_email', 'facebook_url', 'instagram_url', 'tiktok_url'];
  for (const key of contactKeys) {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, '') ON CONFLICT (key) DO NOTHING`,
      [key]
    );
  }

  // Seed default products only if the table is empty (first-ever run)
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM products');
  if (parseInt(rows[0].c, 10) === 0) {
    const groceries = [
      ['veg','Potato (Aloo)','1 kg',55,65],['veg','Onion (Pyaz)','1 kg',80,95],
      ['veg','Tomato (Tamatar)','1 kg',70,null],['veg','Cabbage (Banda Gobi)','1 pc',40,50],
      ['veg','Cauliflower (Cauli)','1 pc',60,null],['veg','Spinach (Palungo)','250 g',25,null],
      ['veg','Brinjal (Baigan)','1 kg',65,75],['veg','Carrot (Gajar)','1 kg',75,null],
      ['veg','Cucumber (Kakro)','1 kg',50,null],['veg','Green Beans (Simi)','500 g',45,null],
      ['veg','Pumpkin (Farsi)','1 kg',35,null],['veg','Okra (Bhindi)','500 g',40,null],
      ['veg','Capsicum','500 g',60,70],['veg','Radish (Mula)','1 kg',35,null],
      ['veg','Garlic (Lasun)','250 g',70,null],['veg','Ginger (Aduwa)','250 g',50,null],
      ['veg','Coriander Leaves (Dhaniya)','100 g',20,null],['veg','Green Chilli (Khursani)','250 g',30,null],
      ['fruit','Banana (Kera)','1 dozen',120,140],['fruit','Apple (Syau)','1 kg',280,320],
      ['fruit','Orange (Suntala)','1 kg',180,null],['fruit','Papaya (Mewa)','1 kg',100,null],
      ['fruit','Watermelon (Tarbuja)','1 pc (approx 3kg)',150,null],['fruit','Pomegranate (Anar)','1 kg',320,360],
      ['fruit','Guava (Ambak)','1 kg',120,null],['fruit','Grapes (Angur)','500 g',180,200],
      ['fruit','Pineapple (Bhuikatahar)','1 pc',130,null],
      ['dairy','Milk (Doodh)','1 L',95,null],['dairy','Curd (Dahi)','400 g',70,80],
      ['dairy','Paneer','200 g',150,170],['dairy','Butter','100 g',110,null],
      ['dairy','Eggs (Anda)','6 pcs',90,100],['dairy','Eggs (Anda)','12 pcs',170,190],
      ['dairy','Pure Ghee','500 ml',650,700],
      ['grain','Basmati Rice','5 kg',850,900],['grain','Coarse Rice (Mota Chamal)','5 kg',600,650],
      ['grain','Fine Rice (Masino Chamal)','5 kg',700,null],['grain','Red Lentil (Musuro Dal)','1 kg',220,null],
      ['grain','Black Gram (Kalo Dal)','1 kg',260,280],['grain','Chana Dal','1 kg',200,null],
      ['grain','Wheat Flour (Atta)','5 kg',400,null],['grain','Maida (Refined Flour)','1 kg',80,null],
      ['grain','Besan (Gram Flour)','1 kg',150,null],
      ['spice','Turmeric Powder (Besar)','200 g',60,null],['spice','Red Chilli Powder','200 g',90,100],
      ['spice','Cumin Seeds (Jeera)','100 g',50,null],['spice','Coriander Powder','200 g',70,null],
      ['spice','Garam Masala','100 g',80,null],['spice','Iodized Salt (Nun)','1 kg',25,null],
      ['spice','Black Pepper (Marich)','50 g',90,null],
      ['oil','Mustard Oil','1 L',280,300],['oil','Sunflower Oil','1 L',260,null],['oil','Soybean Oil','1 L',240,255],
      ['snack','Wai Wai Noodles','1 packet',25,30],['snack','Rara Noodles','1 packet',28,null],
      ['snack','Biscuit Pack','1 packet',45,null],['snack','Namkeen Mix','200 g',80,90],
      ['snack','Potato Chips','55 g',35,null],['snack','Beaten Rice (Chiura)','1 kg',110,null],
      ['bev','Tea Leaves (Chiya Patti)','250 g',150,170],['bev','Coffee','100 g',180,null],
      ['bev','Cold Drink','1.5 L',150,null],['bev','Mineral Water','1 L',25,null],
      ['bev','Fruit Juice Pack','1 L',180,200],
      ['bakery','White Bread','1 loaf',60,null],['bakery','Brown Bread','1 loaf',75,80],
      ['bakery','Bun (Pack of 6)','1 pack',60,null],
      ['meat','Chicken','1 kg',320,340],['meat','Mutton','1 kg',1100,null],['meat','Fish (Rahu)','1 kg',400,null],
      ['personal','Bathing Soap','1 pc',55,65],['personal','Shampoo','180 ml',210,230],
      ['personal','Toothpaste','150 g',110,null],['personal','Sanitary Pads','1 packet',150,null],
      ['personal','Hand Wash','250 ml',130,null],
      ['home','Detergent Powder','1 kg',180,200],['home','Dish Wash Liquid','500 ml',140,null],
      ['home','Broom (Jharu)','1 pc',120,null],['home','Mosquito Coil','1 packet',60,null],
      ['home','Matchbox (Pack of 10)','1 pack',20,null],
    ];
    for (const [category, name, weight, price, old_price] of groceries) {
      await pool.query(
        `INSERT INTO products (type, category, name, weight, price, old_price, image_url) VALUES ('grocery', $1, $2, $3, $4, $5, NULL)`,
        [category, name, weight, price, old_price]
      );
    }

    const fastfood = [
      ['Veg Momo','10 pcs',120,null],['Chicken Momo','10 pcs',160,180],
      ['Veg Chowmein','1 plate',100,null],['Chicken Chowmein','1 plate',140,null],
      ['Chatpate','1 plate',60,null],['Pani Puri','1 plate',50,null],
      ['Cheese Burger','1 pc',150,170],['Regular Pizza','1 pc (8 inch)',350,null],
      ['Chicken Sekuwa','1 plate',280,null],['French Fries','1 plate',110,null],
      ['Cold Coffee','1 glass',120,null],['Egg Roll','1 pc',90,null],
    ];
    for (const [name, weight, price, old_price] of fastfood) {
      await pool.query(
        `INSERT INTO products (type, category, name, weight, price, old_price, image_url) VALUES ('fastfood', 'fastfood', $1, $2, $3, $4, NULL)`,
        [name, weight, price, old_price]
      );
    }
    console.log('✅ Seeded default products into the database.');
  }
}

module.exports = { pool, initDb };
