// src/controllers/chatController.js
import { query } from '../config/database.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

// ── ROOMS ─────────────────────────────────────────────────────

export const getRooms = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT r.id, r.name, r.description, r.emoji, r.invite_code, r.created_at,
        (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id=r.id) AS member_count,
        (SELECT COUNT(*) FROM messages m WHERE m.room_id=r.id AND NOT m.is_deleted) AS message_count,
        (SELECT json_build_object('id',m.id,'body',m.body,'type',m.type,'file_url',m.file_url,
           'created_at',m.created_at,'user_name',u2.name)
         FROM messages m JOIN users u2 ON m.user_id=u2.id
         WHERE m.room_id=r.id AND NOT m.is_deleted
         ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        EXISTS(SELECT 1 FROM room_members rm WHERE rm.room_id=r.id AND rm.user_id=$1) AS is_member
      FROM rooms r
      ORDER BY r.created_at ASC
    `, [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const createRoom = async (req, res) => {
  try {
    const { name, description, emoji = '💬' } = req.body;
    if (!name) return res.status(422).json({ error: 'Room name required' });
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const { rows } = await query(
      'INSERT INTO rooms (name,description,emoji,invite_code,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, description || null, emoji, code, req.user.id]
    );
    await query('INSERT INTO room_members (room_id,user_id) VALUES ($1,$2)', [rows[0].id, req.user.id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const joinRoom = async (req, res) => {
  try {
    const { code } = req.params;
    const { rows } = await query('SELECT * FROM rooms WHERE invite_code=$1', [code.toUpperCase()]);
    if (!rows.length) return res.status(404).json({ error: 'Invalid invite code' });
    await query('INSERT INTO room_members (room_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [rows[0].id, req.user.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getMembers = async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT u.id, u.name, u.email, u.avatar_color, u.avatar_url, u.is_online, u.last_seen, rm.joined_at
      FROM room_members rm JOIN users u ON rm.user_id=u.id
      WHERE rm.room_id=$1 ORDER BY u.name
    `, [req.params.roomId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── MESSAGES ──────────────────────────────────────────────────

export const getMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { before, limit = 50 } = req.query;

    let q = `
      SELECT m.id, m.body, m.type, m.file_url, m.file_name, m.file_size, m.mime_type,
             m.is_deleted, m.created_at, m.reply_to,
             json_build_object('id',u.id,'name',u.name,'avatar_color',u.avatar_color,'avatar_url',u.avatar_url) AS author,
             (SELECT json_agg(json_build_object('emoji',r.emoji,'count',r.cnt,'mine',r.mine)) FROM (
               SELECT emoji, COUNT(*) AS cnt, BOOL_OR(user_id=$2) AS mine
               FROM reactions WHERE message_id=m.id GROUP BY emoji
             ) r) AS reactions,
             CASE WHEN m.reply_to IS NOT NULL THEN
               (SELECT json_build_object('id',rm.id,'body',rm.body,'author_name',ru.name)
                FROM messages rm JOIN users ru ON rm.user_id=ru.id WHERE rm.id=m.reply_to)
             END AS reply_message
      FROM messages m JOIN users u ON m.user_id=u.id
      WHERE m.room_id=$1
    `;
    const params = [roomId, req.user.id];
    if (before) { q += ` AND m.created_at < $${params.length + 1}`; params.push(before); }
    q += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const { rows } = await query(q, params);
    res.json(rows.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const deleteMessage = async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM messages WHERE id=$1', [req.params.msgId]);
    if (!rows.length) return res.status(404).json({ error: 'Message not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Cannot delete' });
    await query('UPDATE messages SET is_deleted=TRUE, body=NULL WHERE id=$1', [req.params.msgId]);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const addReaction = async (req, res) => {
  try {
    const { emoji } = req.body;
    const { msgId } = req.params;
    const existing = await query('SELECT * FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
      [msgId, req.user.id, emoji]);
    if (existing.rows.length) {
      await query('DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
        [msgId, req.user.id, emoji]);
    } else {
      await query('INSERT INTO reactions (message_id,user_id,emoji) VALUES ($1,$2,$3)',
        [msgId, req.user.id, emoji]);
    }
    res.json({ toggled: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── FILE UPLOAD ───────────────────────────────────────────────
export const uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      url:      `/uploads/${req.file.filename}`,
      name:     req.file.originalname,
      size:     req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// ── USERS ─────────────────────────────────────────────────────
export const updateProfile = async (req, res) => {
  try {
    const { name, avatarColor } = req.body;
    const sets = []; const params = []; let i = 1;
    if (name)        { sets.push(`name=$${i++}`);         params.push(name); }
    if (avatarColor) { sets.push(`avatar_color=$${i++}`); params.push(avatarColor); }
    if (req.file)    { sets.push(`avatar_url=$${i++}`);   params.push(`/uploads/${req.file.filename}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.user.id);
    const { rows } = await query(
      `UPDATE users SET ${sets.join(',')} WHERE id=$${i} RETURNING id,name,email,avatar_color,avatar_url`,
      params
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
};
