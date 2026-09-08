const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware');

const router = express.Router();

const KEYS = ['contact_phone', 'contact_email', 'facebook_url', 'instagram_url', 'tiktok_url'];

// Public: anyone can see the contact info (shown in the app's Contact Us screen)
router.get('/contact', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value FROM settings WHERE key = ANY($1)', [KEYS]);
    const result = {};
    KEYS.forEach(k => { result[k] = ''; });
    rows.forEach(r => { result[r.key] = r.value || ''; });
    res.json(result);
  } catch (err) {
    console.error('get contact settings error:', err.message);
    res.status(500).json({ error: 'Could not load contact info.' });
  }
});

// Admin: update contact info (owner edits this from the dashboard)
router.put('/contact', requireAdmin, async (req, res) => {
  try {
    for (const key of KEYS) {
      if (req.body[key] !== undefined) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = $2`,
          [key, req.body[key]]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('update contact settings error:', err.message);
    res.status(500).json({ error: 'Could not save contact info.' });
  }
});

module.exports = router;
