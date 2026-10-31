const express = require('express');
const cors = require('cors');
const { createHmac, randomBytes, randomUUID, timingSafeEqual } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const APP_ORIGIN = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
const SESSION_COOKIE = 'medirecord_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map();

if (!APP_PASSWORD || APP_PASSWORD.length < 4) {
  throw new Error('APP_PASSWORD must be configured and at least 4 characters long.');
}
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be configured and at least 32 characters long.');
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key exists:', !!supabaseKey);
const supabase = createClient(supabaseUrl, supabaseKey);

app.set('trust proxy', 1);
app.use(cors({ origin: APP_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

function createSessionToken() {
  const payload = `${Date.now() + SESSION_DURATION_MS}.${randomBytes(32).toString('hex')}`;
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function isValidSessionToken(token) {
  if (!token) return false;
  const separator = token.lastIndexOf('.');
  if (separator < 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expectedSignature = createHmac('sha256', SESSION_SECRET).update(payload).digest();
  const suppliedSignature = Buffer.from(signature, 'hex');
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return false;

  const expiresAt = Number(payload.slice(0, payload.indexOf('.')));
  return Number.isSafeInteger(expiresAt) && expiresAt > Date.now();
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  const cookie = cookies.map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : '';
}

function setSessionCookie(res, req, token) {
  const crossOrigin = APP_ORIGIN && new URL(APP_ORIGIN).host !== req.get('host');
  const sameSite = crossOrigin ? 'None' : 'Strict';
  const secure = process.env.NODE_ENV === 'production' || req.secure || sameSite === 'None';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
  });
}

function isTrustedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  const expectedOrigin = APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
  return origin === expectedOrigin;
}

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: isValidSessionToken(getCookie(req, SESSION_COOKIE)) });
});

app.post('/api/auth/login', (req, res) => {
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: 'Untrusted request origin' });

  const now = Date.now();
  const key = req.ip;
  const attempt = loginAttempts.get(key);
  if (attempt && now - attempt.startedAt < LOGIN_WINDOW_MS && attempt.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
  }

  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const expected = createHmac('sha256', SESSION_SECRET).update(APP_PASSWORD).digest();
  const supplied = createHmac('sha256', SESSION_SECRET).update(password).digest();
  if (!timingSafeEqual(supplied, expected)) {
    const currentAttempt = attempt && now - attempt.startedAt < LOGIN_WINDOW_MS
      ? attempt
      : { startedAt: now, count: 0 };
    currentAttempt.count++;
    loginAttempts.set(key, currentAttempt);
    return res.status(401).json({ error: 'Incorrect password' });
  }

  loginAttempts.delete(key);
  setSessionCookie(res, req, createSessionToken());
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  const crossOrigin = APP_ORIGIN && new URL(APP_ORIGIN).host !== req.get('host');
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || req.secure || crossOrigin,
    sameSite: crossOrigin ? 'None' : 'Strict',
    path: '/',
  });
  res.json({ authenticated: false });
});

app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isTrustedOrigin(req)) {
    return res.status(403).json({ error: 'Untrusted request origin' });
  }
  if (!isValidSessionToken(getCookie(req, SESSION_COOKIE))) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
});

// POST upload image to Supabase Storage
app.post('/api/upload-image', async (req, res) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl || !dataUrl.startsWith('data:image')) return res.status(400).json({ error: 'Invalid image' });
    
    const ext = dataUrl.split(';')[0].split('/')[1] || 'jpg';
    const fname = Date.now() + '_' + (filename||'photo').replace(/[^a-z0-9._-]/gi,'_') + '.' + ext;
    const base64 = dataUrl.split(',')[1];
    
    const { data, error } = await supabase.storage
      .from('patient-photos')
      .upload(fname, Buffer.from(base64, 'base64'), { contentType: `image/${ext}` });
    
    if (error) return res.status(500).json({ error: error.message });
    
    const { data: urlData } = supabase.storage.from('patient-photos').getPublicUrl(fname);
    res.json({ url: urlData.publicUrl });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET all patients
// GET all patients
app.get('/api/patients', async (req, res) => {
  try {
    console.log('Fetching patients...');
    const { data, error } = await supabase.from('patients').select('*');
    
    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: error.message, details: error });
    }
    
    console.log('Fetched patients:', data);
    res.json(data || []);
  } catch(e) {
    console.error('Catch error:', e.message, e);
    res.status(500).json({ error: e.message });
  }
});

// GET single patient
app.get('/api/patients/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('patients').select('*').eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json(data?.[0] || null);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST create patient
app.post('/api/patients', async (req, res) => {
  try {
    const patientData = { ...req.body };
    delete patientData.patient_number;
    const newPatient = { ...patientData, id: randomUUID(), created_at: new Date().toISOString() };
    const { data, error } = await supabase.from('patients').insert([newPatient]).select();
    if (error) return res.status(500).json(error);
    res.status(201).json(data[0]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update patient
app.put('/api/patients/:id', async (req, res) => {
  try {
    const patientUpdates = { ...req.body };
    delete patientUpdates.patient_number;
    const { data, error } = await supabase.from('patients').update(patientUpdates).eq('id', req.params.id).select();
    if (error) return res.status(500).json(error);
    res.json(data?.[0] || null);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

//delete photos of a patient from supabase storage
app.post('/api/delete-photo', async (req, res) => {
  try {
    const { filename } = req.body;
    const { error } = await supabase.storage.from('patient-photos').remove([filename]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE patient
app.delete('/api/patients/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('patients').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));