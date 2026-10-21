require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');

const required = ['DATABASE_URL', 'JWT_SECRET', 'CORS_ORIGIN'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
if (process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined });
const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(x => x.trim()), methods: ['GET','POST','PATCH'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '20kb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
app.use('/api/admin/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { error: '尝试次数过多，请稍后再试。' } }));

const statuses = new Set(['pending','reviewing','supplement_required','approved','declined','withdrawn']);
const statusLabels = { pending:'待审核', reviewing:'审核中', supplement_required:'待补充材料', approved:'审核通过', declined:'未通过', withdrawn:'已撤回' };
const clean = (v, max=200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { const payload = jwt.verify(token, process.env.JWT_SECRET); if (payload.role !== 'admin') throw new Error('role'); req.admin = payload; next(); }
  catch { return res.status(401).json({ error: '请先登录管理员账号。' }); }
}
function newAccessCode() { return crypto.randomInt(100000, 1000000).toString(); }
function newApplicationNo() { const d = new Date(); const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`; return `QY${stamp}${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }

app.get('/api/health', (req,res) => res.json({ ok: true }));

app.post('/api/applications', asyncRoute(async (req,res) => {
  const company_name = clean(req.body.company_name, 120);
  const credit_code = clean(req.body.credit_code, 32);
  const contact_name = clean(req.body.contact_name, 60);
  const contact_phone = clean(req.body.contact_phone, 30);
  const city = clean(req.body.city, 100);
  const loan_purpose = clean(req.body.loan_purpose, 500);
  const amount = Number(req.body.loan_amount);
  if (!company_name || !contact_name || !/^\+?[0-9()\-\s]{7,20}$/.test(contact_phone) || !city || !loan_purpose || !Number.isFinite(amount) || amount < 10000 || amount > 100000000 || req.body.consent_privacy !== true) {
    return res.status(400).json({ error: '请检查必填项、融资金额（1万元至1亿元）及隐私告知确认。' });
  }
  if (credit_code && !/^[0-9A-Z]{8,32}$/.test(credit_code)) return res.status(400).json({ error: '统一社会信用代码格式不正确。' });
  const accessCode = newAccessCode();
  const codeHash = await bcrypt.hash(accessCode, 10);
  const applicationNo = newApplicationNo();
  const result = await pool.query(
    `INSERT INTO applications (application_no, access_code_hash, company_name, credit_code, contact_name, contact_phone, city, loan_amount, loan_purpose, consent_privacy)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING application_no, created_at, status`,
    [applicationNo, codeHash, company_name, credit_code || null, contact_name, contact_phone, city, amount, loan_purpose, true]
  );
  await pool.query(`INSERT INTO application_events (application_id, new_status, note) SELECT id, 'pending', '客户提交申请' FROM applications WHERE application_no=$1`, [applicationNo]);
  res.status(201).json({ application_no: result.rows[0].application_no, access_code: accessCode, status: statusLabels[result.rows[0].status], created_at: result.rows[0].created_at, message: '申请已提交。请妥善保存申请编号和查询码。' });
}));

app.post('/api/applications/status', asyncRoute(async (req,res) => {
  const applicationNo = clean(req.body.application_no, 32).toUpperCase();
  const accessCode = clean(req.body.access_code, 12);
  if (!applicationNo || !/^\d{6}$/.test(accessCode)) return res.status(400).json({ error: '请输入正确的申请编号和6位查询码。' });
  const result = await pool.query('SELECT id, application_no, access_code_hash, status, customer_message, created_at, updated_at FROM applications WHERE application_no=$1', [applicationNo]);
  const record = result.rows[0];
  if (!record || !(await bcrypt.compare(accessCode, record.access_code_hash))) return res.status(404).json({ error: '申请编号或查询码不正确。' });
  res.json({ application_no: record.application_no, status: statusLabels[record.status], status_code: record.status, customer_message: record.customer_message, created_at: record.created_at, updated_at: record.updated_at });
}));

app.post('/api/admin/login', asyncRoute(async (req,res) => {
  const username = clean(req.body.username, 80);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const result = await pool.query('SELECT id, username, password_hash FROM admins WHERE username=$1', [username]);
  const admin = result.rows[0];
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) return res.status(401).json({ error: '账号或密码不正确。' });
  await pool.query('UPDATE admins SET last_login_at=now() WHERE id=$1', [admin.id]);
  const token = jwt.sign({ sub: admin.id, username: admin.username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '2h', issuer: 'qiye-shuipiao-dai' });
  res.json({ token, username: admin.username, expires_in: 7200 });
}));

app.get('/api/admin/applications', auth, asyncRoute(async (req,res) => {
  const status = clean(req.query.status, 40);
  const search = clean(req.query.q, 100);
  const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page,10) || 1));
  const limit = 25;
  const params = [];
  let where = 'WHERE 1=1';
  if (status && statuses.has(status)) { params.push(status); where += ` AND status=$${params.length}`; }
  if (search) { params.push(`%${search.replace(/[%_\\]/g, '\\$&')}%`); where += ` AND (application_no ILIKE $${params.length} OR company_name ILIKE $${params.length} OR contact_name ILIKE $${params.length})`; }
  const count = await pool.query(`SELECT count(*)::int AS total FROM applications ${where}`, params);
  params.push(limit, (page-1)*limit);
  const rows = await pool.query(`SELECT id, application_no, company_name, credit_code, contact_name, contact_phone, city, loan_amount, loan_purpose, status, customer_message, admin_note, created_at, updated_at FROM applications ${where} ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`, params);
  res.json({ items: rows.rows.map(r => ({ ...r, status_label: statusLabels[r.status] })), total: count.rows[0].total, page, page_size: limit });
}));

app.patch('/api/admin/applications/:id', auth, asyncRoute(async (req,res) => {
  const id = clean(req.params.id, 50);
  const status = clean(req.body.status, 40);
  const admin_note = clean(req.body.admin_note, 1000);
  const customer_message = clean(req.body.customer_message, 500);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !statuses.has(status)) return res.status(400).json({ error: '申请编号或状态无效。' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const old = await client.query('SELECT id,status FROM applications WHERE id=$1 FOR UPDATE', [id]);
    if (!old.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: '未找到申请记录。' }); }
    await client.query(`UPDATE applications SET status=$1, admin_note=$2, customer_message=$3, reviewed_by=$4, updated_at=now() WHERE id=$5`, [status, admin_note || null, customer_message || null, req.admin.sub, id]);
    await client.query(`INSERT INTO application_events (application_id, actor_admin_id, old_status, new_status, note) VALUES ($1,$2,$3,$4,$5)`, [id, req.admin.sub, old.rows[0].status, status, admin_note || customer_message || null]);
    await client.query('COMMIT');
    res.json({ ok: true, status: statusLabels[status] });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.use((err,req,res,next) => {
  console.error('Request failed:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '系统暂时无法处理请求，请稍后重试。' });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`API listening on port ${port}`));
