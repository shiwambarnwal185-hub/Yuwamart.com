const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

router.get('/', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name, contact, joined_at FROM users ORDER BY joined_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('list users error:', err.message);
    res.status(500).json({ error: 'Could not load customers.' });
  }
});

module.exports = router;
