const fs = require('fs');
let code = fs.readFileSync('src/components/DiscountEntryForm.tsx', 'utf-8');

const validationCode = `
                    const modalAgreed = Number(aiReviewModal.agreedPrice) || 0;

                    let calcAgreed = 0;
                    if (lastRoundPrice > 0 && modalAgreed > 0) {
                      calcAgreed = Math.min(lastRoundPrice, modalAgreed);
                    } else if (lastRoundPrice > 0) {
                      calcAgreed = lastRoundPrice;
                    } else {
                      calcAgreed = modalAgreed;
                    }

                    // STRICT VALIDATION FOR DECREASING PRICES
                    if (aiReviewModal.offerType !== 'first') {
                       let isValidSequence = true;
                       let lastCheckedPrice = calcBaseline;
                       
                       if (modalAgreed > 0) {
                         if (modalAgreed >= lastCheckedPrice) isValidSequence = false;
                         lastCheckedPrice = modalAgreed;
                       }
                       
                       for (let i = 0; i < currentRounds.length; i++) {
                          const rP = Number(currentRounds[i].quotedPrice) || 0;
                          if (rP >= lastCheckedPrice) {
                            isValidSequence = false;
                            break;
                          }
                          lastCheckedPrice = rP;
                       }
                       
                       if (!isValidSequence) {
                         alert('Fiyat Sıralaması Geçersiz! Her yeni indirim turundaki teklif/fatura fiyatı bir öncekinden kesinlikle daha DÜŞÜK olmalıdır. Lütfen fiyatları (ilk teklif > 2. indirimli teklif > 3. indirimli teklif) şeklinde güncelleyin. Aynı tutar girilemez.');
                         return;
                       }
                       
                       if (calcAgreed <= 0) {
                         alert('Lütfen anlaşılan son indirimli tutarı girin.');
                         return;
                       }
                    }
`;

code = code.replace(
  /const modalAgreed = Number\(aiReviewModal\.agreedPrice\) \|\| 0;[\s\S]*?calcAgreed = modalAgreed;\s*\}/,
  validationCode.trim()
);

fs.writeFileSync('src/components/DiscountEntryForm.tsx', code, 'utf-8');
console.log('Validation patched');
