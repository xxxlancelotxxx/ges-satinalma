const fs = require('fs');
const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // 1x1 red pixel png
fetch('http://localhost:3000/api/discounts/process-ai', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    fileBase64: 'data:image/png;base64,' + b64,
    mimeType: 'image/png',
    fileName: 'test.png',
    scanMode: 'thorough',
    offerType: 'first'
  })
}).then(r => r.json()).then(console.log).catch(console.error);
