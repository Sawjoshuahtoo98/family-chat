// src/utils/seed.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'familychat',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running schema...');
    const schema = fs.readFileSync(path.join(process.cwd(), 'database.sql'), 'utf8');
    await client.query(schema);

    console.log('🌱 Creating default rooms...');
    await client.query(`
      INSERT INTO rooms (name, description, emoji, invite_code)
      VALUES
        ('General',  'Welcome to the family chat!', '🏠', 'FAMILY'),
        ('Photos',   'Share your favorite moments', '📸', 'PHOTOS'),
        ('Planning', 'Events, trips & plans',        '📅', 'PLANS')
      ON CONFLICT (invite_code) DO NOTHING
    `);

    console.log('👨‍👩‍👧‍👦 Creating demo family members...');
    const members = [
      { name: 'Dad',   email: 'dad@family.com',   password: 'family123', color: '#007AFF' },
      { name: 'Mom',   email: 'mom@family.com',   password: 'family123', color: '#FF2D55' },
      { name: 'Alice', email: 'alice@family.com', password: 'family123', color: '#34C759' },
      { name: 'Bob',   email: 'bob@family.com',   password: 'family123', color: '#FF9500' },
    ];

    for (const m of members) {
      const hash = await bcrypt.hash(m.password, 12);
      const res = await client.query(
        `INSERT INTO users (name,email,password_hash,avatar_color)
         VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
         RETURNING id`,
        [m.name, m.email, hash, m.color]
      );
      const userId = res.rows[0].id;
      // Join all rooms
      await client.query(`
        INSERT INTO room_members (room_id, user_id)
        SELECT id, $1 FROM rooms ON CONFLICT DO NOTHING
      `, [userId]);
      console.log(`  ✓ ${m.name.padEnd(8)} ${m.email}  /  ${m.password}`);
    }

    console.log('\n✅ Family chat ready!\n');
    console.log('Invite codes:');
    console.log('  General:  FAMILY');
    console.log('  Photos:   PHOTOS');
    console.log('  Planning: PLANS\n');
    console.log('Demo logins (password: family123):');
    console.log('  dad@family.com');
    console.log('  mom@family.com');
    console.log('  alice@family.com');
    console.log('  bob@family.com\n');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
