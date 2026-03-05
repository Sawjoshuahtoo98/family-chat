import express from 'express';
import multer  from 'multer';
import path    from 'path';
import fs      from 'fs';
import { v4 as uuid } from 'uuid';
import rateLimit from 'express-rate-limit';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { authenticate } from '../middleware/auth.js';
import * as auth from '../controllers/authController.js';
import * as chat from '../controllers/chatController.js';

const router = express.Router();
let upload;

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const cloudStorage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder: 'familychat',
      resource_type: 'auto',
      public_id: uuid(),
    }),
  });
  upload = multer({ storage: cloudStorage, limits: { fileSize: 20971520 } });
  console.log('☁️  Using Cloudinary for file storage');
} else {
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const localStore = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${uuid()}${path.extname(file.originalname)}`),
  });
  upload = multer({ storage: localStore, limits: { fileSize: 20971520 } });
  console.log('💾  Using local storage for files');
}

const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
router.post('/auth/register', auth.register);
router.post('/auth/login',    loginLimit, auth.login);
router.post('/auth/refresh',  auth.refresh);
router.post('/auth/logout',   authenticate, auth.logout);
router.get('/auth/me',        authenticate, auth.me);
router.get('/rooms',                 authenticate, chat.getRooms);
router.post('/rooms',                authenticate, chat.createRoom);
router.post('/rooms/join/:code',     authenticate, chat.joinRoom);
router.get('/rooms/:roomId/members', authenticate, chat.getMembers);
router.get('/rooms/:roomId/messages',     authenticate, chat.getMessages);
router.delete('/messages/:msgId',         authenticate, chat.deleteMessage);
router.post('/messages/:msgId/reactions', authenticate, chat.addReaction);

router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = req.file.path || `/uploads/${req.file.filename}`;
    const isImage = req.file.mimetype?.startsWith('image/');
    res.json({ url, name: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype, type: isImage ? 'image' : 'file' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/profile', authenticate, upload.single('avatar'), chat.updateProfile);

export default router;
router.get('/ice-credentials', authenticate, async (req, res) => {
  try {
    const response = await fetch('https://global.xirsys.net/_turn/MyFirstApp', {
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('joshsecret:6640e372-18a7-11f1-8381-a63be73edab0').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ format: 'urls' })
    });
    const data = await response.json();
    if (data.v && data.v.iceServers) return res.json({ iceServers: data.v.iceServers });
    throw new Error('No iceServers');
  } catch(e) {
    console.error('ICE error:', e.message);
    res.json({ iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: ['turn:ss-turn1.xirsys.com:80?transport=udp','turn:ss-turn1.xirsys.com:3478?transport=udp','turns:ss-turn1.xirsys.com:443?transport=tcp'],
        username: 'qxyRMonVtyhGbI24_jOBXWVM8MA9FuWKuXtpJW079dAwSC2vwyFrflKvpEkUp948AAAAAGmpoKdqb3No',
        credential: 'afa19412-18a7-11f1-9f9e-0242ac140004' }
    ]});
  }
});
