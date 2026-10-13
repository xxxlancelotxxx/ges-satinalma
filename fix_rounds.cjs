const fs = require('fs');
let code = fs.readFileSync('src/components/DiscountEntryForm.tsx', 'utf-8');

// 1. Fix handleModalRoundDocUpload prevPrice
code = code.replace(
  /let prevPrice = baseOffer;\s+if \(roundIdx > 0 && existingRounds\[roundIdx - 1\]\?\.quotedPrice\) {\s+prevPrice = existingRounds\[roundIdx - 1\]\.quotedPrice;\s+}/g,
  `let prevPrice = baseOffer;
    if (roundIdx > 0 && existingRounds[roundIdx - 1]?.quotedPrice) {
      prevPrice = existingRounds[roundIdx - 1].quotedPrice;
    } else if (roundIdx === 0 && Number(aiReviewModal.agreedPrice) > 0) {
      prevPrice = Number(aiReviewModal.agreedPrice);
    }`
);

// 2. Fix handleAddEmptyModalRound prevPrice
code = code.replace(
  /let prevPrice = baseOffer;\s+if \(roundIdx > 0 && existing\[roundIdx - 1\]\?\.quotedPrice\) {\s+prevPrice = existing\[roundIdx - 1\]\.quotedPrice;\s+}/g,
  `let prevPrice = baseOffer;
    if (roundIdx > 0 && existing[roundIdx - 1]?.quotedPrice) {
      prevPrice = existing[roundIdx - 1].quotedPrice;
    } else if (roundIdx === 0 && Number(aiReviewModal.agreedPrice) > 0) {
      prevPrice = Number(aiReviewModal.agreedPrice);
    }`
);

// 3. Fix handleUpdateModalRound
code = code.replace(
  /const prevP = r\.previousPrice \|\| 0;/g,
  `const prevP = (roundIdx === 0 ? (Number(aiReviewModal.agreedPrice) || 0) : Number(updated[roundIdx - 1]?.quotedPrice)) || r.previousPrice || 0;`
);

// 4. Fix prevP in UI render
code = code.replace(
  /const prevP = round\.previousPrice \|\| \(idx === 0 \? Number\(aiReviewModal\.offerPrice\) \|\| 0 : aiReviewModal\.rounds\!\[idx - 1\]\?\.quotedPrice \|\| 0\);/g,
  `const prevP = (idx === 0 ? Number(aiReviewModal.agreedPrice) || Number(aiReviewModal.offerPrice) || 0 : aiReviewModal.rounds![idx - 1]?.quotedPrice || 0);`
);

// 5. Fix UI text - button and Empty state
code = code.replace(
  /<span>\+ Belgeyle Tur Ekle<\/span>/g,
  `<span>+ 3. İndirimli Teklif Ekle</span>`
);
code = code.replace(
  /<span>\+ \{aiReviewModal\.rounds\.length \+ 1\}\. Tur Belgesi \/ Tutar Ekle<\/span>/g,
  `<span>+ {aiReviewModal.rounds.length + 3}. İndirimli Teklif Ekle</span>`
);

fs.writeFileSync('src/components/DiscountEntryForm.tsx', code, 'utf-8');
console.log('Fix applied');
