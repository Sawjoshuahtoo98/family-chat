// src/server.js
import 'dotenv/config';
import express    from 'express';
import { createServer } from 'http';
import { Server }  from 'socket.io';
import cors        from 'cors';
import helmet      from 'helmet';
import compression from 'compression';
import morgan      from 'morgan';
import path        from 'path';
import { fileURLToPath } from 'url';
import jwt         from 'jsonwebtoken';

import { testConnection, query } from './config/database.js';
import routes from './routes/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app    = express();
const httpServer = createServer(app);
const PORT   = process.env.PORT || 3000;

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5500',
  'http://localhost:5500',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
];

// ── Socket.io ─────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
  maxHttpBufferSize: 20e6,
});

// Socket auth middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token'));
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const { rows } = await query('SELECT id,name,avatar_color,avatar_url FROM users WHERE id=$1', [payload.sub]);
    if (!rows.length) return next(new Error('User not found'));
    socket.user = rows[0];
    next();
  } catch (err) {
    next(new Error('Auth failed'));
  }
});

// Online users map: userId → socketId
const onlineUsers = new Map();

io.on('connection', async (socket) => {
  const user = socket.user;
  onlineUsers.set(user.id, socket.id);
  await query('UPDATE users SET is_online=TRUE, last_seen=NOW() WHERE id=$1', [user.id]);

  // Join all user's rooms
  const { rows: rooms } = await query(
    'SELECT room_id FROM room_members WHERE user_id=$1', [user.id]
  );
  rooms.forEach(r => socket.join(r.room_id));

  // Broadcast online status
  io.emit('user:online', { userId: user.id, name: user.name });

  // ── SEND MESSAGE ────────────────────────────────────────────
  socket.on('message:send', async (data) => {
    try {
      const { roomId, body, type = 'text', fileUrl, fileName, fileSize, mimeType, replyTo } = data;

      // Check member
      const mem = await query('SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, user.id]);
      if (!mem.rows.length) return;

      const { rows } = await query(
        `INSERT INTO messages (room_id,user_id,body,type,file_url,file_name,file_size,mime_type,reply_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [roomId, user.id, body || null, type, fileUrl || null, fileName || null,
         fileSize || null, mimeType || null, replyTo || null]
      );
      const msg = rows[0];

      // Fetch reply message if exists
      let replyMessage = null;
      if (replyTo) {
        const rr = await query('SELECT m.id,m.body,u.name AS author_name FROM messages m JOIN users u ON m.user_id=u.id WHERE m.id=$1', [replyTo]);
        replyMessage = rr.rows[0] || null;
      }

      const fullMsg = {
        ...msg,
        author: { id: user.id, name: user.name, avatar_color: user.avatar_color, avatar_url: user.avatar_url },
        reactions: [],
        reply_message: replyMessage,
      };

      io.to(roomId).emit('message:new', fullMsg);
    } catch (err) {
      console.error('message:send error:', err.message);
    }
  });

  // ── TYPING ───────────────────────────────────────────────────
  socket.on('typing:start', ({ roomId }) => {
    socket.to(roomId).emit('typing:start', { userId: user.id, name: user.name, roomId });
  });
  socket.on('typing:stop', ({ roomId }) => {
    socket.to(roomId).emit('typing:stop', { userId: user.id, roomId });
  });

  // ── REACTION ─────────────────────────────────────────────────
  socket.on('reaction:toggle', async ({ messageId, emoji, roomId }) => {
    try {
      const existing = await query('SELECT * FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
        [messageId, user.id, emoji]);
      if (existing.rows.length) {
        await query('DELETE FROM reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
          [messageId, user.id, emoji]);
      } else {
        await query('INSERT INTO reactions (message_id,user_id,emoji) VALUES ($1,$2,$3)',
          [messageId, user.id, emoji]);
      }
      // Broadcast updated reactions
      const { rows } = await query(`
        SELECT emoji, COUNT(*) AS count, BOOL_OR(user_id=$2) AS mine
        FROM reactions WHERE message_id=$1 GROUP BY emoji
      `, [messageId, user.id]);
      io.to(roomId).emit('reaction:update', { messageId, reactions: rows });
    } catch (err) { console.error('reaction error:', err.message); }
  });

  // ── MESSAGE DELETE ───────────────────────────────────────────
  socket.on('message:delete', async ({ messageId, roomId }) => {
    try {
      const { rows } = await query('SELECT user_id FROM messages WHERE id=$1', [messageId]);
      if (!rows.length || rows[0].user_id !== user.id) return;
      await query('UPDATE messages SET is_deleted=TRUE, body=NULL WHERE id=$1', [messageId]);
      io.to(roomId).emit('message:deleted', { messageId });
    } catch (err) { console.error('delete error:', err.message); }
  });

  // ── WEBRTC SIGNALING ─────────────────────────────────────────
  socket.on('call:start', ({ roomId, callType }) => {
    socket.to(roomId).emit('call:incoming', {
      from: { id: user.id, name: user.name, avatar_color: user.avatar_color },
      callType, roomId,
    });
  });

  socket.on('call:offer', ({ to, offer, roomId, callType }) => {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) io.to(targetSocket).emit('call:offer', {
      from: user.id, offer, roomId, callType,
      caller: { id: user.id, name: user.name, avatar_color: user.avatar_color },
    });
  });

  socket.on('call:answer', ({ to, answer }) => {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) io.to(targetSocket).emit('call:answer', { from: user.id, answer });
  });

  socket.on('call:ice', ({ to, candidate }) => {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) io.to(targetSocket).emit('call:ice', { from: user.id, candidate });
  });

  socket.on('call:end', ({ roomId, to }) => {
    if (to) {
      const targetSocket = onlineUsers.get(to);
      if (targetSocket) io.to(targetSocket).emit('call:ended', { from: user.id });
    } else {
      socket.to(roomId).emit('call:ended', { from: user.id });
    }
  });

  socket.on('call:reject', ({ to }) => {
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) io.to(targetSocket).emit('call:rejected', { from: user.id });
  });

  // ── JOIN ROOM (runtime) ───────────────────────────────────────
  socket.on('room:join', ({ roomId }) => {
    socket.join(roomId);
    socket.to(roomId).emit('room:member_joined', { user: { id: user.id, name: user.name } });
  });

  // ── DISCONNECT ───────────────────────────────────────────────
  socket.on('disconnect', async () => {
    onlineUsers.delete(user.id);
    await query('UPDATE users SET is_online=FALSE, last_seen=NOW() WHERE id=$1', [user.id]).catch(() => {});
    io.emit('user:offline', { userId: user.id });
  });
});

// ── Express middleware ────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/api', routes);
app.use((req, res) => res.status(404).json({ error: `Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

// ── Start ─────────────────────────────────────────────────────
const start = async () => {
  await testConnection();
  httpServer.listen(PORT, () => {
    console.log(`🚀 Server running → http://localhost:${PORT}`);
    console.log(`🌍 Environment   → ${process.env.NODE_ENV || 'development'}`);
  });
};

start().catch(err => { console.error(err); process.exit(1); });
export default app;
