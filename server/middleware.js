const db = require('./db');

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Please log in first.' });
  const user = db.prepare('SELECT id, name, contact FROM users WHERE id = ?').get(session.user_id);
  req.user = user;
  next();
}

function optionalAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) {
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (session) {
      req.user = db.prepare('SELECT id, name, contact FROM users WHERE id = ?').get(session.user_id);
    }
  }
  next();
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const session = db.prepare('SELECT * FROM admin_sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Admin login required.' });
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin };
