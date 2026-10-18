# AI Assistant Working Principles and Directives

The following instructions have been explicitly defined by the user and must be strictly adhered to for all future interactions and tasks:

1.  **Never make false or unverified claims.** Do not state that a task is completed unless it has been thoroughly tested and verified to be working correctly.
2.  **Verify everything.** After making code changes, always use terminal commands, local requests (like `curl`), or logs to confirm that the changes produced the exact desired outcome.
3.  **Acknowledge completion only after confirmation.** Only respond with "hallettim" (or similar confirmation of success) when you possess concrete proof that the implementation is flawless.
4.  **Iterative debugging is mandatory.** If a verification step fails or the outcome is not as expected, do not inform the user that it is "done". Instead, investigate the root cause, fix the issue, and re-verify. Continue this loop until the feature works perfectly before concluding the turn.
5.  **Quality over speed.** Take the necessary time to ensure the work is done right the first time. Hasty implementations that lead to errors are unacceptable.

---

## Proje ve Çalışma Kuralları (Kalıcı Kapsam)
Model versiyonu ne olursa olsun (Gemini 3.1 Pro, 3.8 Flash veya başkası) aşağıdaki kurallara KESİNLİKLE uyulacaktır:

### 1. PROJE HARİTASI
- **Backend:** `server.ts` (API)
- **Frontend:** `src/`
- **Kritik Dosya:** `firebase-applet-config.json` (Bu dosya olmadan Firestore bağlantısı kurulamaz, asla paketten çıkarma).
- Port `3000` sabittir, kesinlikle değiştirme.

### 2. VERİ KURALI
- Tek doğruluk kaynağı Firestore'dur. Referans sayımlar: **invoices: 1059, discounts: 253** (2026-10-18 itibarıyla /api/health). (Silinen faturaların hortlamaması için güncel gerçek sayılar baz alınmıştır.)
- Publish sonrası `/api/health` bu sayıları tutmuyorsa yayın HATALI sayılır, düzeltmeden kapatma.

### 3. YAYIN KURALI
- `node_modules`, `dist`, `data_backup` snapshot'a giremez.
- Secret'ları koda gömme (environment değişkenleri kullan).

### 4. ÇALIŞMA DİSİPLİNİ
- **Sıra:** Plan &rarr; Küçük Patch (bir seferde tek hata) &rarr; Derle (`tsc --noEmit` + `npm run build`) &rarr; Test et &rarr; Kanıtla & Raporla.
- "Yaptım / hallettim" demek için şart: Derleme çıktısı + `/api/health` çıktısı teyit edilmiş olmalıdır.
- Kanıt yoksa bitti deme, kendi içinde uğraşmaya devam et.

### 5. MODEL BAĞIMSIZLIĞI
- Versiyona özel kestirme kullanma.
- Modele bakmadan önce `AGENTS.md`yi oku, sağlık sayılarını doğrula, sonra koda dokun.

### 6. GERİ ALINABİLİRLİK
- Çalışan son sürümü bozma. Yeni değişiklik sistemi bozarsa derhal bir önceki çalışan duruma dön.

### 7. ZORUNLU CEVAP FORMATI
Bu mesajdan sonraki her cevap ZORUNLU olarak şu 3 maddeyi içerecektir. Bunlar yoksa "bitti" veya "hallettim" denmeyecektir:
1. **Neyi değiştirdin?**
2. **Hangi komutla test ettin?**
3. **Log / Sağlık çıktısı ne?**
