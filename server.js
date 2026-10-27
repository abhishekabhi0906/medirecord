const express = require('express');
const cors = require('cors');
const { randomUUID } = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key exists:', !!supabaseKey);
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

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
    const newPatient = { ...req.body, id: randomUUID(), created_at: new Date().toISOString() };
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
    const { data, error } = await supabase.from('patients').update(req.body).eq('id', req.params.id).select();
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