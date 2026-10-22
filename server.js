const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'patients.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Create uploads folder if not exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, '../frontend')));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify([]));
  return JSON.parse(fs.readFileSync(DATA_FILE));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// POST upload image — saves to /uploads, returns URL path
app.post('/api/upload-image', (req, res) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl || !dataUrl.startsWith('data:image')) return res.status(400).json({ error: 'Invalid image' });
    const ext = dataUrl.split(';')[0].split('/')[1] || 'jpg';
    const fname = Date.now() + '_' + (filename||'photo').replace(/[^a-z0-9._-]/gi,'_') + '.' + ext;
    const fpath = path.join(UPLOADS_DIR, fname);
    const base64 = dataUrl.split(',')[1];
    fs.writeFileSync(fpath, Buffer.from(base64, 'base64'));
    res.json({ url: '/uploads/' + fname });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET all patients
app.get('/api/patients', (req, res) => {
  let patients = loadData();
  const { search, date } = req.query;
  if (search) {
    const q = search.toLowerCase();
    patients = patients.filter(p => p.name.toLowerCase().includes(q));
  }
  if (date) patients = patients.filter(p => p.appointmentDate === date);
  res.json(patients);
});

// GET single patient
app.get('/api/patients/:id', (req, res) => {
  const patients = loadData();
  const patient = patients.find(p => p.id === req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient not found' });
  res.json(patient);
});

// POST create patient
app.post('/api/patients', (req, res) => {
  const patients = loadData();
  const newPatient = { id: Date.now().toString(), createdAt: new Date().toISOString(), ...req.body };
  patients.push(newPatient);
  saveData(patients);
  res.status(201).json(newPatient);
});

// PUT update patient
app.put('/api/patients/:id', (req, res) => {
  const patients = loadData();
  const idx = patients.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
  patients[idx] = { ...patients[idx], ...req.body };
  saveData(patients);
  res.json(patients[idx]);
});

// DELETE patient
app.delete('/api/patients/:id', (req, res) => {
  let patients = loadData();
  const idx = patients.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Patient not found' });
  patients.splice(idx, 1);
  saveData(patients);
  res.json({ success: true });
});

// One-time migration: fix em dash in mobile numbers
(function migrateMobile() {
  const patients = loadData();
  let changed = false;
  patients.forEach(p => {
    if (p.mobile && p.mobile.includes('—')) { p.mobile = p.mobile.replace(/—/g, '-'); changed = true; }
  });
  if (changed) { saveData(patients); console.log('✅ Mobile numbers cleaned up.'); }
})();

app.listen(PORT, () => {
  console.log(`✅ MediRecord server running at http://localhost:${PORT}`);
  console.log(`📁 Images saved to: ${UPLOADS_DIR}`);
});
