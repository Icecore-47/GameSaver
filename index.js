// index.js  – HTTPS-enabled version
// -------------------------------------------------
(async () => {
  try {
    const express  = require('express');
    const fs       = require('fs');
    const path     = require('path');
    const unzipper = require('unzipper');
    const https    = require('https');          // ⬅️ NEW

    const app = express();
    app.use(express.json());

    // ──────────────────────────
    //  Paths & constants
    // ──────────────────────────
    const BASE_DIR    = path.join(__dirname, 'data');
    const MODELS_FILE = path.join(BASE_DIR, 'models.json');

    // ──────────────────────────
    //  One-off startup checks
    // ──────────────────────────
    if (!fs.existsSync(BASE_DIR)) {
      fs.mkdirSync(BASE_DIR, { recursive: true });
      console.log('✅ Created base directory:', BASE_DIR);
    }

    if (!fs.existsSync(MODELS_FILE)) {
      fs.mkdirSync(path.dirname(MODELS_FILE), { recursive: true });
      fs.writeFileSync(MODELS_FILE, '[]', 'utf-8');
      console.log('✅ Created models.json file');
    }

    // ──────────────────────────
    //  Routes
    // ──────────────────────────
    // GET /models
    app.get('/models', (req, res) => {
      try {
        const data = fs.readFileSync(MODELS_FILE, 'utf-8');
        res.json(JSON.parse(data));
      } catch (err) {
        console.error('❌ Failed to read models file:', err);
        res.status(500).json({ error: 'Failed to load models' });
      }
    });

    // POST /unzip
    app.post('/unzip', async (req, res) => {
      const { url, folderName, DisplayName, BuildName } = req.body;
      if (!url || !folderName || !DisplayName || !BuildName) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const outputDir = path.join(BASE_DIR, folderName);
      console.log(`📥 Downloading from: ${url}`);
      console.log(`📂 Extracting to:  ${outputDir}`);

      try {
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download zip: ${response.statusText}`);

        const buffer    = Buffer.from(await response.arrayBuffer());
        const directory = await unzipper.Open.buffer(buffer);

        await Promise.all(directory.files.map(file => {
          if (file.type === 'Directory') return;

          const relativePath = file.path.split('/').slice(1).join(path.sep);
          const outputPath   = path.join(outputDir, relativePath);
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });

          return new Promise((resolve, reject) => {
            file.stream()
              .pipe(fs.createWriteStream(outputPath))
              .on('finish', resolve)
              .on('error',  reject);
          });
        }));

        // Persist model entry
        const newModel      = { DisplayName, FolderName: folderName, BuildName };
        const currentModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf-8'));
        currentModels.push(newModel);
        fs.writeFileSync(MODELS_FILE, JSON.stringify(currentModels, null, 2), 'utf-8');

        console.log('✅ Extraction complete and model saved');
        res.json({ message: 'Zip extracted and model stored', model: newModel });
      } catch (err) {
        console.error('❌ Error during unzip:', err);
        res.status(500).json({ error: err.message });
      }
    });

    // ──────────────────────────
    //  TLS / HTTP → HTTPS redirect
    // ──────────────────────────
    const HTTPS_PORT = process.env.HTTPS_PORT || 3100;
    const HTTP_PORT  = process.env.HTTP_PORT  || 3101;

    // Redirect plain-HTTP traffic to HTTPS (comment out if you don’t want the redirect)
    app.enable('trust proxy');
    app.use((req, res, next) => {
      if (req.secure || req.headers['x-forwarded-proto'] === 'https') return next();
      res.redirect(`https://${req.headers.host}${req.url}`);
    });

    // Attempt to load certificates
    let httpsOptions;
    try {
      httpsOptions = {
        key:  fs.readFileSync(process.env.SSL_KEY_PATH  || path.join(__dirname, 'certs', 'key.pem')),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'cert.pem')),
        // ca: fs.readFileSync('chain.pem')           // ← Add if you have an intermediate chain
      };

      https.createServer(httpsOptions, app).listen(HTTPS_PORT, () =>
        console.log(`✅ HTTPS server listening on https://localhost:${HTTPS_PORT}`)
      );
    } catch (err) {
      console.warn('⚠️  HTTPS certificates not found or invalid – HTTPS server not started.\n' +
                   '    Set SSL_KEY_PATH / SSL_CERT_PATH env vars or place key.pem & cert.pem in ./certs');
    }

    // Always expose HTTP (for local dev -- remove in production if reverse-proxied)
    app.listen(HTTP_PORT, () =>
      console.log(`✅ HTTP server listening on  http://localhost:${HTTP_PORT}`)
    );

  } catch (e) {
    console.error('❌ Startup error:', e);
  }
})();
