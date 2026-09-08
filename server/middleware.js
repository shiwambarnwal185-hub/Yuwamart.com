const { pool } = require('./db');

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { rows } = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    if (!rows[0]) return res.status(401).json({ error: 'Please log in first.' });
    const userRes = await pool.query('SELECT id, name, contact FROM users WHERE id = $1', [rows[0].user_id]);
    req.user = userRes.rows[0];
    next();
  } catch (err) {
    console.error('requireAuth error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token) {
      const { rows } = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
      if (rows[0]) {
        const userRes = await pool.query('SELECT id, name, contact FROM users WHERE id = $1', [rows[0].user_id]);
        req.user = userRes.rows[0];
      }
    }
    next();
  } catch (err) {
    console.error('optionalAuth error:', err.message);
    next();
  }
}

async function requireAdmin(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { rows } = await pool.query('SELECT * FROM admin_sessions WHERE token = $1', [token]);
    if (!rows[0]) return res.status(401).json({ error: 'Admin login required.' });
    next();
  } catch (err) {
    console.error('requireAdmin error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
