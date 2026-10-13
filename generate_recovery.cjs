const fs = require('fs');

const recoveredCode = `              {(() => {
                const deduction = aiReviewModal.scopeDeductionAmount || 0;
                const baseline = deduction > 0 ? Math.max(0, aiReviewModal.offerPrice - deduction) : aiReviewModal.offerPrice;
                const rounds = aiReviewModal.rounds || [];
                const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : null;
                const lastRoundPrice = lastRound && Number(lastRound.quotedPrice) > 0 ? Number(lastRound.quotedPrice) : 0;
                const modalAgreed = Number(aiReviewModal.agreedPrice) || 0;

                let effectiveAgreed = 0;
                if (lastRoundPrice > 0 && modalAgreed > 0) {
                  effectiveAgreed = Math.min(lastRoundPrice, modalAgreed);
                } else if (lastRoundPrice > 0) {
                  effectiveAgreed = lastRoundPrice;
                } else {
                  effectiveAgreed = modalAgreed;
                }

                const amt = Math.max(0, baseline - effectiveAgreed);
                const pct = baseline > 0 ? ((amt / baseline) * 100).toFixed(2) : '0';

                if (amt <= 0) return null;

                return (
                  <div className="bg-emerald-950/20 border border-emerald-500/20 rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <h4 className="text-[10px] font-bold text-emerald-500 mb-1 uppercase tracking-wider">HESAPLANAN NET İNDİRİM KAZANIMI</h4>
                      <div className="flex items-baseline space-x-2">
                        <span className="text-2xl font-black text-emerald-400">+{formatRuble(amt)}</span>
                        {lastRoundPrice > 0 && (
                          <span className="text-[10px] font-bold text-indigo-300 bg-indigo-500/20 px-2 py-0.5 rounded border border-indigo-500/30">
                            {rounds.length}. Son Tur ({formatRuble(effectiveAgreed)}) Baz Alındı
                          </span>
                        )}
                        {deduction > 0 && (
                          <p className="text-[10px] text-amber-300">
                            (Düzeltilmiş Teklif {formatRuble(baseline)} baz alındı)
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black px-3.5 py-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        %{pct} İndirim Oranı
                      </span>
                    </div>
                  </div>
                );
              })()}

              {aiReviewModal.offerPrice === aiReviewModal.agreedPrice && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-[11px] text-amber-300 flex items-start space-x-2">
                  <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>İndirim Oranı Bilgilendirmesi:</strong> Belgedeki tutar ile liste fiyatı eşit algılandı. Eğer bu faturadan önce alınan indirimsiz bir liste teklifiniz varsa, yukarıdaki <strong>"İlk Teklif Fiyatı (Liste)"</strong> kutusundan tutarı güncelleyerek kazanılan indirim tutarını ve oranını anında hesaplatabilirsiniz.
                  </span>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PAZARLIK TURLARI & ARA İNDİRİM BELGELERİ (STAGE MANAGEMENT)   */}
              {/* ------------------------------------------------------------- */}
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-indigo-400" />
                      <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                        Pazarlık Turları & Ara Belgeler (Aşamalandırma)
                      </h4>
                      <span className={\`text-[10px] font-bold px-2 py-0.5 rounded-full border \${
                        (aiReviewModal.rounds?.length || 0) > 0
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }\`}>
                        {(aiReviewModal.rounds?.length || 0) > 0 
                          ? \`\${aiReviewModal.rounds?.length} Ara Tur Eklendi\` 
                          : 'Tek Aşamalı (İlk Teklif ➔ Son Fatura)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      İlk teklif ile son fatura arasında ara pazarlık turu veya ara indirim belgesi varsa doğrudan buradan sürükleyip veya seçerek ekleyebilirsiniz.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <label className="cursor-pointer px-3 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-bold text-xs flex items-center space-x-1.5 transition-all">
                      <Plus className="w-3.5 h-3.5 text-indigo-400" />
                      <span>+ 3. İndirimli Teklif Ekle</span>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleModalRoundDocUpload(file);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleAddEmptyModalRound}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold transition-all cursor-pointer"
                      title="Belgesiz sadece tutar girerek tur ekle"
                    >
                      Manuel Tur
                    </button>
                  </div>
                </div>

                {/* Drop Zone / Empty State */}
                {(!aiReviewModal.rounds || aiReviewModal.rounds.length === 0) ? (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsModalRoundDragOver(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsModalRoundDragOver(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsModalRoundDragOver(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) handleModalRoundDocUpload(file);
                    }}
                    className={\`border-2 border-dashed rounded-xl p-4 text-center transition-all \${
                      isModalRoundDragOver
                        ? 'border-indigo-400 bg-indigo-950/30 scale-[1.01]'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-900/40'
                    }\`}
                  >
                    <label className="cursor-pointer block space-y-1.5">
                      <Upload className="w-6 h-6 mx-auto text-slate-500" />
                      <p className="text-xs font-bold text-slate-300">
                        Ara Pazarlık Teklifi veya Faturasını Buraya Sürükleyin veya <span className="text-indigo-400 underline">Dosya Seçin</span>
                      </p>
                      <p className="text-[10px] text-slate-400">
                        PDF, Excel veya Görsel yüklediğinizde yapay zeka tutarı otomatik algılayıp aşama olarak ekler.
                      </p>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleModalRoundDocUpload(file);
                            e.target.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  /* Render list of added rounds */
                  <div className="space-y-3">
                    {aiReviewModal.rounds.map((round, idx) => {
                      const isThisLoading = modalRoundLoadingIndex === idx;
                      const prevP = (idx === 0 ? Number(aiReviewModal.agreedPrice) || Number(aiReviewModal.offerPrice) || 0 : aiReviewModal.rounds![idx - 1]?.quotedPrice || 0);
                      const roundDisc = Math.max(0, prevP - (round.quotedPrice || 0));
                      const roundDiscPct = prevP > 0 ? ((roundDisc / prevP) * 100).toFixed(1) : '0';

                      return (
                        <div
                          key={round.id || idx}
                          className="bg-slate-900/90 border border-indigo-500/30 rounded-xl p-3 space-y-2.5 relative"
                        >
                          {/* Header: Round title & Delete button */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                              <span className="w-5 h-5 rounded-full bg-indigo-600 text-white font-black text-[10px] flex items-center justify-center">
                                {idx + 3}
                              </span>
                              <span className="font-extrabold text-xs text-indigo-300">
                                {idx + 3}. İndirimli Fatura / Teklif
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemoveModalRound(idx)}
                              className="text-slate-500 hover:text-rose-400 p-1 rounded-lg transition-colors cursor-pointer"
                              title="Bu turu sil"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Document upload / preview */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs">
                            <div className="flex items-center space-x-2 min-w-0">
                              <FileText className="w-4 h-4 text-amber-400 shrink-0" />
                              {round.documentName ? (
                                <div className="truncate">
                                  <span className="font-semibold text-slate-200 truncate block">{round.documentName}</span>
                                  <span className="text-[10px] text-emerald-400">✓ Aşama belgesi yüklendi</span>
                                </div>
                              ) : (
                                <span className="text-slate-400 italic">Belge yüklenmedi (Manuel tur)</span>
                              )}
                            </div>

                            <div className="flex items-center space-x-2 shrink-0">
                              {isThisLoading ? (
                                <div className="flex items-center space-x-1.5 text-[10px] text-amber-300 font-bold">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                  <span>AI Okunuyor...</span>
                                </div>
                              ) : (
                                <label className="cursor-pointer px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 flex items-center space-x-1">
                                  <Upload className="w-3 h-3 text-slate-400" />
                                  <span>{round.documentName ? 'Belgeyi Değiştir' : 'Belge Yükle'}</span>
                                  <input
                                    type="file"
                                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                                    className="hidden"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        handleModalRoundDocUpload(file, idx);
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>

                          {/* Price & Discount input */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                                Bu Turdaki Teklif Fiyatı (₽) *
                              </label>
                              <input
                                type="number"
                                value={round.quotedPrice || ''}
                                placeholder="0.00"
                                onChange={(e) => handleUpdateModalRound(idx, 'quotedPrice', Number(e.target.value) || 0)}
                                className="w-full py-1.5 px-2.5 bg-slate-950 border border-slate-700 rounded-lg text-indigo-300 font-mono font-bold text-xs focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 mb-1">
                                Bu Turda Kazanılan Ara İndirim
                              </label>
                              <div className="py-1.5 px-2.5 bg-slate-950/80 border border-slate-800 rounded-lg flex items-center justify-between text-xs">
                                <span className="font-mono font-bold text-emerald-400">
                                  -{formatRuble(roundDisc)}
                                </span>
                                <span className="text-[10px] font-bold text-amber-300 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                  %{roundDiscPct}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Optional note */}
                          <div>
                            <input
                              type="text"
                              placeholder="Örn: 1. Tur: Tedarikçi liste fiyatından indirim yaptı"
                              value={round.note || ''}
                              onChange={(e) => handleUpdateModalRound(idx, 'note', e.target.value)}
                              className="w-full py-1 px-2.5 bg-slate-950 border border-slate-800 rounded-lg text-slate-300 text-[11px] placeholder:text-slate-600"
                            />
                          </div>
                        </div>
                      );
                    })}

                    {/* Add another round button */}
                    <div className="flex justify-end pt-1">
                      <label className="cursor-pointer px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-indigo-300 border border-indigo-500/30 text-xs font-bold flex items-center space-x-1.5 transition-all">
                        <Plus className="w-3.5 h-3.5 text-indigo-400" />
                        <span>+ {aiReviewModal.rounds.length + 3}. İndirimli Teklif Ekle</span>
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleModalRoundDocUpload(file);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* Visual Stage Progression Ladder (Pazarlık Merdiveni) */}
                {aiReviewModal.rounds && aiReviewModal.rounds.length > 0 && (
                  <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Kayıt Edilecek Aşamalı Belge Sıralaması:</span>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 border border-slate-700 font-semibold flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                        <span>1. İlk Teklif / Fatura ({formatRuble(aiReviewModal.offerPrice)})</span>
                      </span>

                      <ArrowRight className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span className="px-2.5 py-1 rounded-lg bg-indigo-950/80 text-indigo-200 border border-indigo-500/40 font-semibold flex items-center space-x-1">
                        <span className="w-2 h-2 rounded-full bg-indigo-400"></span>
                        <span>2. İndirimli Fatura / Teklif ({formatRuble(aiReviewModal.agreedPrice)})</span>
                      </span>

                      {aiReviewModal.rounds.map((r, i) => {
                        const stageNum = i + 3;
                        const isLast = i === aiReviewModal.rounds!.length - 1;
                        return (
                          <React.Fragment key={r.id || i}>
                            <ArrowRight className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span className={\`px-2.5 py-1 rounded-lg border font-semibold flex items-center space-x-1 \${
                              isLast
                                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 font-black'
                                : 'bg-indigo-950/80 text-indigo-200 border-indigo-500/40'
                            }\`}>
                              <span className={\`w-2 h-2 rounded-full \${isLast ? 'bg-emerald-400' : 'bg-indigo-400'}\`}></span>
                              <span>{stageNum}. İndirimli Fatura / Teklif {isLast ? '(Nihai)' : ''} ({formatRuble(r.quotedPrice)})</span>
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Validation Logic and Save Button Area */}
            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                disabled={isProcessingAI}
                onClick={() => {
                  setAiReviewModal(null);
                  setExtractedItems([]);
                }}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold transition-all text-xs disabled:opacity-60"
              >
                Vazgeç / Kapat
              </button>
              
              <button
                  type="button"
                  disabled={isProcessingAI}
                  onClick={async () => {
                    if (isProcessingAI) return;
                    const calcOffer = Number(aiReviewModal.offerPrice) || 0;
                    const calcDeduction = Number(aiReviewModal.scopeDeductionAmount) || 0;
                    const calcAdjusted = calcDeduction > 0 ? Math.max(0, calcOffer - calcDeduction) : calcOffer;
                    const calcBaseline = calcDeduction > 0 ? calcAdjusted : calcOffer;
                    const currentRounds = aiReviewModal.rounds || [];
                    const lastRound = currentRounds.length > 0 ? currentRounds[currentRounds.length - 1] : null;
                    const lastRoundPrice = lastRound && Number(lastRound.quotedPrice) > 0 ? Number(lastRound.quotedPrice) : 0;
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

                    // ALWAYS handle 1st offer step cleanly: transfer data to form and ask for 2nd document
`;

let code = fs.readFileSync('src/components/DiscountEntryForm.tsx', 'utf-8');

// Replace everything from the IIFE start to `// ALWAYS handle 1st offer step cleanly:`
const startMatch = '{(() => {\\n                const deduction = aiReviewModal.scopeDeductionAmount';
const endMatch = '// ALWAYS handle 1st offer step cleanly: transfer data to form and ask for 2nd document';

const startIndex = code.indexOf('{(() => {\n                const deduction = aiReviewModal.scopeDeductionAmount');
const endIndex = code.indexOf(endMatch);

if (startIndex !== -1 && endIndex !== -1) {
  const newCode = code.slice(0, startIndex) + recoveredCode + code.slice(endIndex + endMatch.length);
  fs.writeFileSync('src/components/DiscountEntryForm.tsx', newCode, 'utf-8');
  console.log('Successfully recovered and patched code.');
} else {
  console.error('Could not find boundaries.');
  if (startIndex === -1) console.log('Start index missing');
  if (endIndex === -1) console.log('End index missing');
}
