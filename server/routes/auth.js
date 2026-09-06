const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'yur@2020';

function genToken() { return crypto.randomBytes(24).toString('hex'); }
function genCustomerId() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  return 'YM' + (10000 + row.c + Math.floor(Math.random() * 900));
}

router.post('/signup', (req, res) => {
  const { name, contact, password } = req.body;
  if (!name || !contact || !password || password.length < 4) {
    return res.status(400).json({ error: 'Please provide name, contact, and a password of at least 4 characters.' });
  }
  const existing = db.prepare('SELECT * FROM users WHERE lower(contact) = lower(?)').get(contact);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email/phone already exists. Please log in instead.' });
  }
  const id = genCustomerId();
  const passwordHash = bcrypt.hashSync(password, 10);
  const joinedAt = new Date().toISOString();
  db.prepare('INSERT INTO users (id, name, contact, password_hash, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, contact, passwordHash, joinedAt);

  const token = genToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, id, joinedAt);

  res.json({ token, user: { id, name, contact } });
});

router.post('/login', (req, res) => {
  const { contact, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE lower(contact) = lower(?)').get(contact || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email/phone or password.' });
  }
  const token = genToken();
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, user.id, new Date().toISOString());
  res.json({ token, user: { id: user.id, name: user.name, contact: user.contact } });
});

router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Not logged in.' });
  const user = db.prepare('SELECT id, name, contact FROM users WHERE id = ?').get(session.user_id);
  res.json({ user });
});

router.post('/admin-login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect admin password.' });
  }
  const token = genToken();
  db.prepare('INSERT INTO admin_sessions (token, created_at) VALUES (?, ?)').run(token, new Date().toISOString());
  res.json({ token });
});

module.exports = router;
