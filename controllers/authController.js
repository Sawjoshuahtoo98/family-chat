// src/controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../config/database.js';
import { generateTokens } from '../middleware/auth.js';

const storeRefresh = async (userId, token) => {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const exp  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await query('INSERT INTO refresh_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,$3)', [userId, hash, exp]);
};

const COLORS = ['#007AFF','#34C759','#FF9500','#FF2D55','#AF52DE','#5AC8FA','#FF6B35','#30B0C7'];

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(422).json({ error: 'Name, email and password required' });
    if (password.length < 6)
      return res.status(422).json({ error: 'Password must be at least 6 characters' });

    const hash  = await bcrypt.hash(password, 12);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];

    const { rows } = await query(
      'INSERT INTO users (name,email,password_hash,avatar_color) VALUES ($1,$2,$3,$4) RETURNING id,name,email,avatar_color',
      [name, email, hash, color]
    );
    const user   = rows[0];
    const tokens = generateTokens(user.id);
    await storeRefresh(user.id, tokens.refreshToken);

    // Auto-join General room
    await query('INSERT INTO room_members (room_id,user_id) SELECT id,$1 FROM rooms WHERE invite_code=$2 ON CONFLICT DO NOTHING',
      [user.id, 'FAMILY']);

    res.status(201).json({ user, ...tokens });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: err.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    const user = rows[0];
    await query('UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=$1', [user.id]);
    const tokens = generateTokens(user.id);
    await storeRefresh(user.id, tokens.refreshToken);
    const { password_hash, ...safe } = user;
    res.json({ user: safe, ...tokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await query('SELECT * FROM refresh_tokens WHERE token_hash=$1 AND expires_at>NOW()', [hash]);
    if (!rows.length) return res.status(401).json({ error: 'Token revoked' });
    await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hash]);
    const tokens = generateTokens(payload.sub);
    await storeRefresh(payload.sub, tokens.refreshToken);
    res.json(tokens);
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

export const logout = async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await query('DELETE FROM refresh_tokens WHERE token_hash=$1', [hash]).catch(() => {});
  }
  if (req.user) await query('UPDATE users SET is_online=FALSE, last_seen=NOW() WHERE id=$1', [req.user.id]).catch(() => {});
  res.json({ message: 'Logged out' });
};

export const me = async (req, res) => {
  const { rows } = await query('SELECT id,name,email,avatar_color,avatar_url,is_online,last_seen FROM users WHERE id=$1', [req.user.id]);
  res.json(rows[0]);
};
