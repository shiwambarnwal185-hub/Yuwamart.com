const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

// Photos are kept in memory only long enough to compress them, then the
// compressed bytes are stored in the database (image_data column) — never
// on the server's disk, so they survive every restart/redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // raw upload can be up to 15MB before compression (real phone photos can be large)
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

// Compresses an uploaded photo down to a small, web-friendly JPEG.
async function compressImage(file) {
  return sharp(file.buffer)
    .rotate() // auto-orient based on the photo's EXIF data (phone photos)
    .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
}

// Public: list all products (groceries + fast food).
// IMPORTANT: this deliberately excludes image_data (the actual photo bytes) —
// the list only carries a small photo *link* (image_url). The browser then
// fetches each photo separately via /api/products/:id/photo and CACHES it,
// so repeat visits don't re-download photos at all. This is what keeps
// Neon's monthly data-transfer usage low even with lots of return visitors.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, category, name, weight, price, old_price, image_url FROM products ORDER BY id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('list products error:', err.message);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// Public: serve one product's photo, with aggressive browser caching.
// The ?v= version number in the URL changes whenever the photo is replaced,
// so browsers always show the latest photo but never re-download an
// unchanged one.
router.get('/:id/photo', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT image_data, image_mime FROM products WHERE id = $1', [req.params.id]);
    const row = rows[0];
    if (!row || !row.image_data) return res.status(404).end();
    res.set('Content-Type', row.image_mime || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(row.image_data);
  } catch (err) {
    console.error('serve photo error:', err.message);
    res.status(500).end();
  }
});

// Admin: add a product, optionally with an uploaded photo
router.post('/', requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { type, category, name, weight, price, old_price } = req.body;
    if (!name || !weight || !price || isNaN(parseFloat(price))) {
      return res.status(400).json({ error: 'Please provide name, weight, and a valid price.' });
    }
    const finalType = type === 'fastfood' ? 'fastfood' : 'grocery';
    const finalCategory = type === 'fastfood' ? 'fastfood' : category;

    let imageUrl = req.body.image_url || null; // used if the owner pasted an external link instead
    let imageData = null, imageMime = null;
    if (req.file) {
      imageData = await compressImage(req.file);
      imageMime = 'image/jpeg';
    }

    const insertRes = await pool.query(
      `INSERT INTO products (type, category, name, weight, price, old_price, image_url, image_data, image_mime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [finalType, finalCategory, name, weight, parseFloat(price), old_price ? parseFloat(old_price) : null, imageUrl, imageData, imageMime]
    );
    const newId = insertRes.rows[0].id;

    if (imageData) {
      // Now that we have the id, point image_url at its own cacheable photo endpoint
      imageUrl = `/api/products/${newId}/photo?v=1`;
      await pool.query('UPDATE products SET image_url = $1 WHERE id = $2', [imageUrl, newId]);
    }

    const finalRes = await pool.query(
      'SELECT id, type, category, name, weight, price, old_price, image_url FROM products WHERE id = $1',
      [newId]
    );
    res.json(finalRes.rows[0]);
  } catch (err) {
    console.error('add product error:', err.message);
    res.status(500).json({ error: 'Could not save product.' });
  }
});

// Admin: edit a product, optionally replacing its photo
router.put('/:id', requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const id = req.params.id;
    const existingRes = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
    const existing = existingRes.rows[0];
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const { category, name, weight, price, old_price } = req.body;
    let imageUrl = req.body.image_url !== undefined && req.body.image_url !== '' ? req.body.image_url : existing.image_url;
    let imageData = existing.image_data, imageMime = existing.image_mime;
    let imageVersion = existing.image_version;

    if (req.file) {
      imageData = await compressImage(req.file);
      imageMime = 'image/jpeg';
      imageVersion += 1;
      imageUrl = `/api/products/${id}/photo?v=${imageVersion}`;
    } else if (req.body.image_url !== undefined && req.body.image_url !== '' && req.body.image_url !== existing.image_url) {
      // owner switched to an external URL instead of an uploaded photo
      imageData = null; imageMime = null;
    }

    await pool.query(
      `UPDATE products SET category = $1, name = $2, weight = $3, price = $4, old_price = $5,
              image_url = $6, image_data = $7, image_mime = $8, image_version = $9 WHERE id = $10`,
      [
        category ?? existing.category,
        name ?? existing.name,
        weight ?? existing.weight,
        price ? parseFloat(price) : existing.price,
        old_price ? parseFloat(old_price) : null,
        imageUrl, imageData, imageMime, imageVersion,
        id,
      ]
    );
    const finalRes = await pool.query(
      'SELECT id, type, category, name, weight, price, old_price, image_url FROM products WHERE id = $1',
      [id]
    );
    res.json(finalRes.rows[0]);
  } catch (err) {
    console.error('edit product error:', err.message);
    res.status(500).json({ error: 'Could not update product.' });
  }
});

// Admin: delete a product
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const existingRes = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!existingRes.rows[0]) return res.status(404).json({ error: 'Product not found.' });
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('delete product error:', err.message);
    res.status(500).json({ error: 'Could not delete product.' });
  }
});

module.exports = router;
