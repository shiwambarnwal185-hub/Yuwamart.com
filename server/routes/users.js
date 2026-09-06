const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, name, contact, joined_at FROM users ORDER BY joined_at DESC').all();
  res.json(rows);
});

module.exports = router;
