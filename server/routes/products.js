const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

// Photos are kept in memory only long enough to convert them into a
// base64 "data URI" string, which is then stored directly in the database
// (in the image_url column) — so photos never live on the server's disk
// and are never lost on restart/redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

function fileToDataUri(file) {
  if (!file) return null;
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

// Public: list all products (groceries + fast food)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error('list products error:', err.message);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// Admin: add a product, optionally with an uploaded photo
router.post('/', requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { type, category, name, weight, price, old_price } = req.body;
    if (!name || !weight || !price || isNaN(parseFloat(price))) {
      return res.status(400).json({ error: 'Please provide name, weight, and a valid price.' });
    }
    let imageUrl = req.body.image_url || null;
    if (req.file) imageUrl = fileToDataUri(req.file);

    const finalType = type === 'fastfood' ? 'fastfood' : 'grocery';
    const finalCategory = type === 'fastfood' ? 'fastfood' : category;

    const { rows } = await pool.query(
      `INSERT INTO products (type, category, name, weight, price, old_price, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [finalType, finalCategory, name, weight, parseFloat(price), old_price ? parseFloat(old_price) : null, imageUrl]
    );
    res.json(rows[0]);
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
    if (req.file) imageUrl = fileToDataUri(req.file);

    const { rows } = await pool.query(
      `UPDATE products SET category = $1, name = $2, weight = $3, price = $4, old_price = $5, image_url = $6 WHERE id = $7 RETURNING *`,
      [
        category ?? existing.category,
        name ?? existing.name,
        weight ?? existing.weight,
        price ? parseFloat(price) : existing.price,
        old_price ? parseFloat(old_price) : null,
        imageUrl,
        id,
      ]
    );
    res.json(rows[0]);
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
