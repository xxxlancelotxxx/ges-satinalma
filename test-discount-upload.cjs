const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="; // 1x1 red pixel png
fetch('http://localhost:3000/api/discounts', {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'x-admin-user': 'admin'},
  body: JSON.stringify({
    supervisorId: 'sup1',
    jobsiteId: 'job1',
    vendorName: 'test_vendor',
    category: 'Test Category',
    offerPrice: 1000,
    agreedPrice: 900,
    orderDate: '2026-09-17',
    invoiceNo: '123456789',
    firstOfferFileName: '1.pdf',
    firstOfferFileData: 'data:application/pdf;base64,' + b64
  })
}).then(r => r.json()).then(console.log).catch(console.error);
