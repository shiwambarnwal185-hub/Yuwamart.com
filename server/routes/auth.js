const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');

const router = express.Router();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'yur@2020';

function genToken() { return crypto.randomBytes(24).toString('hex'); }
async function genCustomerId() {
  const { rows } = await pool.query('SELECT COUNT(*) AS c FROM users');
  const n = 10000 + parseInt(rows[0].c, 10) + Math.floor(Math.random() * 900);
  return 'YM' + n;
}

router.post('/signup', async (req, res) => {
  try {
    const { name, contact, password } = req.body;
    if (!name || !contact || !password || password.length < 4) {
      return res.status(400).json({ error: 'Please provide name, contact, and a password of at least 4 characters.' });
    }
    const existing = await pool.query('SELECT * FROM users WHERE lower(contact) = lower($1)', [contact]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'An account with this email/phone already exists. Please log in instead.' });
    }
    const id = await genCustomerId();
    const passwordHash = bcrypt.hashSync(password, 10);
    await pool.query('INSERT INTO users (id, name, contact, password_hash) VALUES ($1, $2, $3, $4)', [id, name, contact, passwordHash]);

    const token = genToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, id]);

    res.json({ token, user: { id, name, contact } });
  } catch (err) {
    console.error('signup error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { contact, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(contact) = lower($1)', [contact || '']);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Incorrect email/phone or password.' });
    }
    const token = genToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
    res.json({ token, user: { id: user.id, name: user.name, contact: user.contact } });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const sessRes = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    if (!sessRes.rows[0]) return res.status(401).json({ error: 'Not logged in.' });
    const userRes = await pool.query('SELECT id, name, contact FROM users WHERE id = $1', [sessRes.rows[0].user_id]);
    res.json({ user: userRes.rows[0] });
  } catch (err) {
    console.error('me error:', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

router.post('/admin-login', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect admin password.' });
    }
    const token = genToken();
    await pool.query('INSERT INTO admin_sessions (token) VALUES ($1)', [token]);
    res.json({ token });
  } catch (err) {
    console.error('admin-login error:', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

module.exports = router;
