// src/config/database.js
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'familychat',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
  min: 2, max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('DB pool error:', err));

export const query = (text, params) => pool.query(text, params);

export const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW() AS now');
    console.log(`✅ Database connected at ${res.rows[0].now}`);
  } catch (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
};

export default pool;
