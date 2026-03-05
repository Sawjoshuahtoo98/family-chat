# Family Chat — README

## Quick Start (Local)

```bash
# 1. Install PostgreSQL and create database
createdb familychat

# 2. Setup backend
cd backend
cp .env.example .env
# Edit .env — set DB_USER to your Mac username (run: whoami)
npm install

# 3. Seed database (creates tables + demo family)
npm run seed

# 4. Start server
npm start

# 5. Open frontend
# Open frontend/index.html with Live Server in VS Code
# OR: open http://localhost:3000 (if serving from backend)
```

## Demo Accounts (password: family123)
- dad@family.com
- mom@family.com
- alice@family.com
- bob@family.com

## Invite Codes
- FAMILY — General room
- PHOTOS — Photos room
- PLANS  — Planning room

## Deploy to Render
1. Push to GitHub
2. Create PostgreSQL on Render
3. Run: `psql "RENDER_DB_URL" -f database.sql`
4. Run seed against Render DB:
   `DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... NODE_ENV=production node backend/src/utils/seed.js`
5. Create Web Service — Start command: `node backend/src/server.js`
6. Add all environment variables from .env.example
7. Create Static Site — Publish directory: `frontend`
8. Update API_URL in frontend/index.html to your Render backend URL

## Features
- ✅ Real-time messaging with Socket.io
- ✅ Multiple family rooms with invite codes
- ✅ Photo & file sharing
- ✅ Voice & video calls (WebRTC)
- ✅ Online presence indicators
- ✅ Message reactions (❤️ 😂 👍 etc)
- ✅ Reply to messages
- ✅ Typing indicators
- ✅ Message deletion
- ✅ Load older messages
- ✅ iMessage-style clean UI
- ✅ Profile customization (name + avatar color)
