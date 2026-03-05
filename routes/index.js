// src/routes/index.js
import express from 'express';
import multer  from 'multer';
import path    from 'path';
import fs      from 'fs';
import { v4 as uuid } from 'uuid';
import rateLimit from 'express-rate-limit';

import { authenticate }  from '../middleware/auth.js';
import * as auth  from '../controllers/authController.js';
import * as chat  from '../controllers/chatController.js';

const router = express.Router();

// ── Upload ────────────────────────────────────────────────────
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '20971520') },
});

// ── Rate limit ────────────────────────────────────────────────
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// ── Health ────────────────────────────────────────────────────
router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Auth ──────────────────────────────────────────────────────
router.post('/auth/register', auth.register);
router.post('/auth/login',    loginLimit, auth.login);
router.post('/auth/refresh',  auth.refresh);
router.post('/auth/logout',   authenticate, auth.logout);
router.get('/auth/me',        authenticate, auth.me);

// ── Rooms ─────────────────────────────────────────────────────
router.get('/rooms',              authenticate, chat.getRooms);
router.post('/rooms',             authenticate, chat.createRoom);
router.post('/rooms/join/:code',  authenticate, chat.joinRoom);
router.get('/rooms/:roomId/members', authenticate, chat.getMembers);

// ── Messages ──────────────────────────────────────────────────
router.get('/rooms/:roomId/messages',     authenticate, chat.getMessages);
router.delete('/messages/:msgId',         authenticate, chat.deleteMessage);
router.post('/messages/:msgId/reactions', authenticate, chat.addReaction);

// ── Files ─────────────────────────────────────────────────────
router.post('/upload', authenticate, upload.single('file'), chat.uploadFile);

// ── Profile ───────────────────────────────────────────────────
router.put('/profile', authenticate, upload.single('avatar'), chat.updateProfile);

export default router;
