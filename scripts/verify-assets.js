const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifest = require('../assets/MODEL_MANIFEST.json');
let failed = false;
for (const [name, info] of Object.entries(manifest.models)) {
  const filePath = path.join(__dirname, '..', info.relative_path);
  const b = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(b).digest('hex');
  const ok = b.length === info.bytes && sha256 === info.sha256;
  console.log(`${ok ? 'OK' : 'FAILED'} ${name}: ${b.length} bytes; sha256=${sha256}`);
  failed ||= !ok;
}
if (failed) process.exit(1);
