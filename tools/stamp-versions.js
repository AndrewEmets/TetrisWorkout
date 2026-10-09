// Adds ?v=<content hash> to the local scripts and stylesheet in index.html, so browsers load the new
// file after an update instead of a cached copy. Runs from the git pre-commit hook (tools/pre-commit).
// Usage: node tools/stamp-versions.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const out = html.replace(/(<(?:script|link)\b[^>]*?\b(?:src|href)=")([^"?:]+?\.(?:js|css))(?:\?v=[0-9a-f]*)?(")/g, (m, pre, file, post) => {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return m;
  const hash = crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex').slice(0, 8);
  return pre + file + '?v=' + hash + post;
});

if (out !== html) {
  fs.writeFileSync(htmlPath, out);
  console.log('index.html: version stamps updated');
}
