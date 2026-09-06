const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'product-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

// Public: list all products (groceries + fast food)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY id ASC').all();
  res.json(rows);
});

// Admin: add a product, optionally with an uploaded photo
router.post('/', requireAdmin, upload.single('photo'), (req, res) => {
  const { type, category, name, weight, price, old_price } = req.body;
  if (!name || !weight || !price || isNaN(parseFloat(price))) {
    return res.status(400).json({ error: 'Please provide name, weight, and a valid price.' });
  }
  let imageUrl = req.body.image_url || null;
  if (req.file) imageUrl = '/uploads/' + req.file.filename;

  const info = db.prepare(`INSERT INTO products (type, category, name, weight, price, old_price, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    type === 'fastfood' ? 'fastfood' : 'grocery',
    type === 'fastfood' ? 'fastfood' : category,
    name, weight, parseFloat(price), old_price ? parseFloat(old_price) : null, imageUrl
  );
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.json(product);
});

// Admin: edit a product, optionally replacing its photo
router.put('/:id', requireAdmin, upload.single('photo'), (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });

  const { category, name, weight, price, old_price } = req.body;
  let imageUrl = req.body.image_url !== undefined ? req.body.image_url : existing.image_url;
  if (req.file) {
    imageUrl = '/uploads/' + req.file.filename;
    if (existing.image_url && existing.image_url.startsWith('/uploads/')) {
      const oldPath = path.join(uploadsDir, path.basename(existing.image_url));
      fs.unlink(oldPath, () => {});
    }
  }

  db.prepare(`UPDATE products SET category = ?, name = ?, weight = ?, price = ?, old_price = ?, image_url = ? WHERE id = ?`)
    .run(category ?? existing.category, name ?? existing.name, weight ?? existing.weight,
         price ? parseFloat(price) : existing.price, old_price ? parseFloat(old_price) : null,
         imageUrl, id);

  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
});

// Admin: delete a product
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  if (existing.image_url && existing.image_url.startsWith('/uploads/')) {
    fs.unlink(path.join(uploadsDir, path.basename(existing.image_url)), () => {});
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
