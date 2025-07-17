// index.js – HTTPS with redirect + HTML form + upload support + verbose logging
(async () => {
  try {
    const express = require('express');
    const fs = require('fs');
    const path = require('path');
    const unzipper = require('unzipper');
    const https = require('https');
    const fetch = require('node-fetch');
    const multer = require('multer');

    const BASE_DIR = path.join(__dirname, 'data');
    const MODELS_FILE = path.join(BASE_DIR, 'models.json');
    const HTML_DIR = __dirname;
    const UPLOADS_DIR = path.join(__dirname, 'uploads');

    const HTTPS_PORT = process.env.HTTPS_PORT || 3100;
    const HTTP_PORT = process.env.HTTP_PORT || 3101;
    const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'key.pem');
    const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem');

    const upload = multer({ dest: UPLOADS_DIR });

    console.log('🔧 Starting server setup...');

    [BASE_DIR, UPLOADS_DIR].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✅ Created directory: ${dir}`);
      } else {
        console.log(`ℹ️ Directory exists: ${dir}`);
      }
    });

    if (!fs.existsSync(MODELS_FILE)) {
      fs.writeFileSync(MODELS_FILE, '[]', 'utf-8');
      console.log('✅ Created models.json file');
    } else {
      console.log('ℹ️ models.json exists');
    }

    const app = express();
    app.use(express.json());

    app.get('/', (req, res) => {
      console.log('📄 Serving index.html');
      res.sendFile(path.join(HTML_DIR, 'index.html'));
    });

    app.get('/items', (req, res) => {
      console.log('📄 Serving items.html');
      res.sendFile(path.join(HTML_DIR, 'items.html'));
    });

    app.get('/models', (req, res) => {
      try {
        console.log('📥 GET /models requested');
        const data = fs.readFileSync(MODELS_FILE, 'utf-8');
        res.json(JSON.parse(data));
      } catch (err) {
        console.error('❌ Failed to read models file:', err);
        res.status(500).json({ error: 'Failed to load models' });
      }
    });

    app.post('/unzip', async (req, res) => {
      const { url, folderName, DisplayName, BuildName } = req.body;
      console.log('📬 POST /unzip called with:', req.body);

      if (!url || !folderName || !DisplayName || !BuildName) {
        console.warn('⚠️ Missing required fields');
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const outputDir = path.join(BASE_DIR, folderName);
      console.log(`📥 Downloading ZIP from ${url}`);
      console.log(`📂 Extracting to ${outputDir}`);

      try {
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
          console.log(`✅ Created output directory: ${outputDir}`);
        }

        const response = await fetch(url, { redirect: 'follow' });
        console.log(`📡 Response status: ${response.status}`);
        if (!response.ok) throw new Error(`Failed to download zip: ${response.statusText}`);

        const contentType = response.headers.get('content-type') || '';
        console.log(`📦 Content-Type: ${contentType}`);
        if (!contentType.includes('application/zip') && !contentType.includes('application/octet-stream')) {
          throw new Error(`Unexpected content-type: ${contentType}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        console.log(`📏 Downloaded file size: ${buffer.length} bytes`);

        if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
          throw new Error('Downloaded file is not a valid ZIP archive (missing PK signature)');
        }

        const directory = await unzipper.Open.buffer(buffer);
        console.log(`📁 Found ${directory.files.length} files in zip`);

        await Promise.all(directory.files.map(file => {
          if (file.type === 'Directory') return;
          const relativePath = file.path.split('/').slice(1).join(path.sep);
          const outputPath = path.join(outputDir, relativePath);
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });

          console.log(`➡️ Extracting file: ${relativePath}`);
          return new Promise((resolve, reject) => {
            file.stream()
              .pipe(fs.createWriteStream(outputPath))
              .on('finish', resolve)
              .on('error', reject);
          });
        }));

        const newModel = { DisplayName, FolderName: folderName, BuildName };
        const currentModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));
        currentModels.push(newModel);
        fs.writeFileSync(MODELS_FILE, JSON.stringify(currentModels, null, 2), 'utf-8');

        console.log('✅ Model metadata saved:', newModel);
        res.json({ message: 'Zip extracted and model stored', model: newModel });

      } catch (err) {
        console.error('❌ Error during unzip:', err);
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/upload', upload.single('file'), async (req, res) => {
      console.log('📬 POST /upload received');

      const { DisplayName, folderName, BuildName } = req.body;
      const file = req.file;
      console.log('📤 File metadata:', file);

      if (!file || !DisplayName || !folderName || !BuildName) {
        console.warn('⚠️ Missing file or required fields');
        return res.status(400).json({ error: 'Missing file or required fields.' });
      }

      const zipPath = file.path;
      const outputDir = path.join(BASE_DIR, folderName);

      try {
        const buffer = fs.readFileSync(zipPath);
        console.log(`📏 Uploaded file size: ${buffer.length} bytes`);
        if (buffer[0] !== 0x50 || buffer[1] !== 0x4B) {
          throw new Error('Uploaded file is not a valid ZIP archive.');
        }

        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const directory = await unzipper.Open.buffer(buffer);
        console.log(`📁 Extracting ${directory.files.length} files`);

        await Promise.all(directory.files.map(file => {
          if (file.type === 'Directory') return;
          const relativePath = file.path.split('/').slice(1).join(path.sep);
          const outputPath = path.join(outputDir, relativePath);
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });

          console.log(`➡️ Extracting: ${relativePath}`);
          return new Promise((resolve, reject) => {
            file.stream()
              .pipe(fs.createWriteStream(outputPath))
              .on('finish', resolve)
              .on('error', reject);
          });
        }));

        const newModel = { DisplayName, FolderName: folderName, BuildName };
        const currentModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));
        currentModels.push(newModel);
        fs.writeFileSync(MODELS_FILE, JSON.stringify(currentModels, null, 2), 'utf-8');

        fs.unlinkSync(zipPath);
        console.log('✅ Upload complete and cleaned up:', newModel);
        res.json({ message: 'Upload successful', model: newModel });
      } catch (err) {
        console.error('❌ Error during file upload:', err);
        res.status(500).json({ error: err.message });
      }
    });

    app.delete('/models/:folderName', (req, res) => {
      const folderName = req.params.folderName;
      console.log(`🗑️ DELETE /models/${folderName}`);

      try {
        const models = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));
        const filtered = models.filter(m => m.FolderName !== folderName);

        if (filtered.length === models.length) {
          console.warn('⚠️ Model not found');
          return res.status(404).json({ error: 'Model not found' });
        }

        fs.writeFileSync(MODELS_FILE, JSON.stringify(filtered, null, 2), 'utf-8');

        const folderPath = path.join(BASE_DIR, folderName);
        if (fs.existsSync(folderPath)) {
          fs.rmSync(folderPath, { recursive: true, force: true });
          console.log(`✅ Deleted folder: ${folderPath}`);
        }

        res.json({ message: 'Model deleted' });
      } catch (err) {
        console.error('❌ Failed to delete model:', err);
        res.status(500).json({ error: 'Failed to delete model' });
      }
    });

    const httpsOptions = {
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH),
    };

    https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`✅ HTTPS server listening at https://0.0.0.0:${HTTPS_PORT}`);
    });

    const redirectApp = express();
    redirectApp.use((req, res) => {
      const originalHost = req.headers.host;
      const redirectHost = originalHost?.replace(/:\d+$/, `:${HTTPS_PORT}`);
      const targetUrl = `https://${redirectHost}${req.url}`;
      console.log(`🔁 HTTP → HTTPS redirect: ${req.method} → ${targetUrl}`);
      res.redirect(targetUrl);
    });

    redirectApp.listen(HTTP_PORT, '0.0.0.0', () => {
      console.log(`🔁 HTTP redirect server listening at http://0.0.0.0:${HTTP_PORT}`);
    });

  } catch (e) {
    console.error('❌ Startup error:', e);
  }
})();
