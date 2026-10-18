export interface RecordPermissionResult {
  canEdit: boolean;
  canDelete: boolean;
  canView: boolean;
  isReadOnly: boolean;
  reason?: string;
  authorizedJobsites?: string[];
}

// Canonical Jobsites Configuration & Aliases
export const JOBSITE_CANONICAL_MAP: Record<string, { id: string; name: string; aliases: string[] }> = {
  job_1: { id: 'job_1', name: 'SET OF3a', aliases: ['set of3a', 'set-of3a', 'set of3', 'setof3a', 'of3a', 'проектный офис', 'proje ofisi', 'proje'] },
  job_2: { id: 'job_2', name: 'Veer Ub10', aliases: ['veer ub10', 'veer-ub10', 'veer kamp', 'veer'] },
  job_3: { id: 'job_3', name: 'Jk Jois', aliases: ['jk jois', 'jk-jois', 'jois', 'silikatnaya 1.etap (jois)', 'silikatnaya 1'] },
  job_4: { id: 'job_4', name: 'Bs Jois', aliases: ['bs jois', 'bs-jois', 'silikatnaya 3. etap', 'silikatnaya 3'] },
  job_5: { id: 'job_5', name: 'Jk Dream Riva', aliases: ['jk dream riva', 'jk-riva', 'dream riva', 'nagatino-2 (jk)', 'nagatino jk', 'riva'] },
  job_6: { id: 'job_6', name: 'Otel Dream Riva', aliases: ['otel dream riva', 'otl-riva', 'otel riva', 'nagatino-2 (otel)', 'nagatino otel', 'nagatino-2 (ofis)'] },
  job_7: { id: 'job_7', name: 'PRB2', aliases: ['prb2', 'prb-2', 'prb', 'nidar-2'] },
  job_8: { id: 'job_8', name: 'Citybay6', aliases: ['citybay6', 'cty-bay6', 'citybay 6', 'citybay'] },
  job_9: { id: 'job_9', name: 'Mnevniki Havuz', aliases: ['mnevniki havuz', 'mnv-hvz', 'mnevniki', 'havuz'] },
};

// Standard Satınalma Şefi Şantiye Eşleşmeleri
export const DEFAULT_SUPERVISOR_JOBSITES: Record<string, string[]> = {
  sup_1: ['job_5', 'job_6', 'job_9'], // Nuri Buga: Jk Dream Riva, Otel Dream Riva, Mnevniki Havuz
  sup_2: ['job_8'],                   // Osman Yılmaz: Citybay6
  sup_3: ['job_3', 'job_4'],          // Serkan Demirbaş: Jk Jois, Bs Jois
  sup_4: ['job_1', 'job_2'],          // Muhammed Hancı: SET OF3a, Veer Ub10
  sup_5: ['job_7'],                   // Halil İbrahim Zengin: PRB2
};

// Satınalma Personeli - Şef Eşleşmeleri
export const DEFAULT_PERSONNEL_SUPERVISORS: Record<string, string> = {
  pers_1: 'sup_1',             // Aleksandra Ozlav -> Nuri Buga
  pers_1787685586764: 'sup_3', // Sukhrob Masharipov -> Serkan Demirbaş
  pers_1787685873716: 'sup_3', // Mariya Myagkova -> Serkan Demirbaş
  pers_1787685955097: 'sup_2', // Furkat Bekimbetov -> Osman Yılmaz
  pers_1787686068521: 'sup_4', // Batyrhan Djailov -> Muhammed Hancı
  pers_1787686138085: 'sup_4', // Adkhamzhon Aslonov -> Muhammed Hancı
  pers_1787687265575: 'sup_1', // Zamonbek Omonov -> Nuri Buga
  pers_1787687385307: 'sup_5', // Yuliya Krivova -> Halil İbrahim Zengin
  pers_1789679186609: 'sup_4', // Sarvarbek Shamuratov -> Muhammed Hancı
};

/**
 * Verilen şantiye ID veya ismini kanonik 'job_1'..'job_9' kimliğine eşler
 */
export function canonicalizeJobsiteId(jobsiteId?: string, jobsiteName?: string): string | null {
  const cleanId = String(jobsiteId || '').trim();
  if (cleanId && JOBSITE_CANONICAL_MAP[cleanId]) {
    return cleanId;
  }

  const rawName = String(jobsiteName || jobsiteId || '').toLowerCase().trim();
  if (!rawName) return null;

  for (const [key, job] of Object.entries(JOBSITE_CANONICAL_MAP)) {
    if (job.name.toLowerCase() === rawName) return key;
    if (job.aliases.some(alias => rawName.includes(alias))) return key;
  }

  return cleanId || null;
}

/**
 * Kullanıcının (Admin, Şef, Personel) işlem yapmaya yetkili olduğu şantiye ID'lerini döndürür
 */
export function getUserAuthorizedJobsiteIds(user: any): Set<string> {
  const result = new Set<string>();
  if (!user) return result;

  // 1. Admin: Tüm 9 şantiyeye yetkili
  if (user.role === 'admin') {
    Object.keys(JOBSITE_CANONICAL_MAP).forEach(id => result.add(id));
    return result;
  }

  // 2. Explicit jobsiteIds defined in user session
  if (Array.isArray(user.jobsiteIds)) {
    user.jobsiteIds.forEach((jid: string) => {
      const canon = canonicalizeJobsiteId(jid);
      if (canon) result.add(canon);
    });
  }
  if (user.defaultJobsiteId) {
    const canon = canonicalizeJobsiteId(user.defaultJobsiteId);
    if (canon) result.add(canon);
  }

  // 3. Supervisor: Şefin bağlı olduğu şantiyeler
  if (user.role === 'supervisor') {
    const supId = user.supervisorId || user.id;
    if (supId && DEFAULT_SUPERVISOR_JOBSITES[supId]) {
      DEFAULT_SUPERVISOR_JOBSITES[supId].forEach(id => result.add(id));
    }
    // Name match fallback
    const supName = String(user.displayName || user.name || '').toLowerCase();
    if (supName.includes('nuri')) ['job_5', 'job_6', 'job_9'].forEach(id => result.add(id));
    if (supName.includes('osman')) ['job_8'].forEach(id => result.add(id));
    if (supName.includes('serkan')) ['job_3', 'job_4'].forEach(id => result.add(id));
    if (supName.includes('muhammed') || supName.includes('hancı')) ['job_1', 'job_2'].forEach(id => result.add(id));
    if (supName.includes('halil')) ['job_7'].forEach(id => result.add(id));
  }

  // 4. Personnel: Satınalma personelinin bağlı olduğu şantiye yetkileri
  // Personel kendi bağlı olduğu şantiyelerin faturalarını yönetir, diğer şantiyelerde salt okunurdur.
  if (user.role === 'personnel') {
    let parentSupId = user.supervisorId;
    if (!parentSupId && user.personnelId) {
      parentSupId = DEFAULT_PERSONNEL_SUPERVISORS[user.personnelId];
    }
    if (parentSupId && DEFAULT_SUPERVISOR_JOBSITES[parentSupId]) {
      DEFAULT_SUPERVISOR_JOBSITES[parentSupId].forEach(id => result.add(id));
    }
    // Personnel name fallback
    const persName = String(user.displayName || user.name || '').toLowerCase();
    if (persName.includes('aleksandra') || persName.includes('zamonbek')) ['job_5', 'job_6', 'job_9'].forEach(id => result.add(id));
    if (persName.includes('furkat')) ['job_8'].forEach(id => result.add(id));
    if (persName.includes('sukhrob') || persName.includes('mariya')) ['job_3', 'job_4'].forEach(id => result.add(id));
    if (persName.includes('batyrhan') || persName.includes('adkhamzhon') || persName.includes('sarvarbek')) ['job_1', 'job_2'].forEach(id => result.add(id));
    if (persName.includes('yuliya')) ['job_7'].forEach(id => result.add(id));
  }

  return result;
}

/**
 * Fatura veya indirim kaydı üzerinde düzenleme/silme yetkilerini denetler.
 * 
 * Kural:
 * - Admin: Her kayıtta tam yetkili (canEdit: true, canDelete: true)
 * - Satınalma Şefi: Kendi bağlı olduğu şantiyelere ait kayıtlarda veya kendi eklediği kayıtlarda canEdit: true, canDelete: true
 * - Satınalma Personeli: Kendi bağlı olduğu şantiyelere ait kayıtlarda, şefine bağlı kayıtlarda veya kendi eklediği kayıtlarda canEdit: true, canDelete: true. Diğer şantiyelerde salt okunur.
 * - Gözlemci (Viewer): Tamamen salt okunur.
 * - Silme eylemi: Silinen fatura önce Çöp Kutusuna gider; kalıcı silme yalnızca Admin tarafından Çöp Kutusu'ndan yapılır.
 */
export function checkRecordPermission(
  user: any,
  supervisorIdOrRecord?: any,
  supervisorName?: string,
  jobsiteId?: string,
  jobsiteName?: string
): RecordPermissionResult {
  if (!user) {
    return { canEdit: false, canDelete: false, canView: true, isReadOnly: true, reason: 'Oturum açılmamış' };
  }

  // 1. Admin her kayıtta tam yetkilidir
  if (user.role === 'admin') {
    return {
      canEdit: true,
      canDelete: true,
      canView: true,
      isReadOnly: false,
      reason: 'Sistem Yöneticisi tam yetkili',
      authorizedJobsites: Array.from(getUserAuthorizedJobsiteIds(user))
    };
  }

  // 2. Gözlemci (Viewer) her yerde salt okunur
  if (user.role === 'viewer') {
    return {
      canEdit: false,
      canDelete: false,
      canView: true,
      isReadOnly: true,
      reason: 'Gözlemci rolü yalnızca görüntüleme yetkisine sahiptir.'
    };
  }

  // Record parametre çözümleme (nesne veya ayrı argümanlar)
  let recSupId = '';
  let recSupName = '';
  let recJobId = '';
  let recJobName = '';
  let recPersonnelId = '';
  let recPersonnelName = '';
  let recUploaderId = '';
  let recUploaderName = '';

  if (supervisorIdOrRecord && typeof supervisorIdOrRecord === 'object') {
    const rec = supervisorIdOrRecord;
    recSupId = rec.uploadedBySupervisorId || rec.supervisorId || '';
    recSupName = rec.uploadedBySupervisorName || rec.supervisorName || '';
    recJobId = rec.jobsiteId || '';
    recJobName = rec.jobsiteName || '';
    recPersonnelId = rec.performedByPersonnelId || rec.personnelId || rec.uploadedByPersonnelId || '';
    recPersonnelName = rec.performedByPersonnelName || rec.uploadedByPersonnelName || '';
    recUploaderId = rec.uploadedByUserId || rec.uploaderUserId || '';
    recUploaderName = rec.uploaderSessionUser || rec.uploadedByUserName || '';
  } else {
    recSupId = String(supervisorIdOrRecord || '');
    recSupName = String(supervisorName || '');
    recJobId = String(jobsiteId || '');
    recJobName = String(jobsiteName || '');
  }

  const authorizedJobsites = getUserAuthorizedJobsiteIds(user);
  const canonJobId = canonicalizeJobsiteId(recJobId, recJobName);

  // Şantiye yetkisi kontrolü (Kullanıcının sorumlu olduğu şantiyelerden biri mi?)
  const hasJobsitePermission = Boolean(canonJobId && authorizedJobsites.has(canonJobId));

  // Kullanıcının kendi yüklediği/oluşturduğu kayıt mı? (Yanlış şantiye veya şef seçilmiş olsa bile düzeltme yetkisi verilir)
  const isSelfUploadedSupervisor = Boolean(
    user.role === 'supervisor' && (
      (user.supervisorId && recSupId && user.supervisorId === recSupId) ||
      (user.displayName && recSupName && recSupName.toLowerCase().includes(String(user.displayName).toLowerCase())) ||
      (user.supervisorId && recUploaderId && user.supervisorId === recUploaderId) ||
      (user.username && recUploaderId && user.username === recUploaderId)
    )
  );

  const isSelfUploadedPersonnel = Boolean(
    user.role === 'personnel' && (
      (user.personnelId && recPersonnelId && user.personnelId === recPersonnelId) ||
      (user.displayName && recPersonnelName && recPersonnelName.toLowerCase().includes(String(user.displayName).toLowerCase())) ||
      (user.personnelId && recUploaderId && user.personnelId === recUploaderId) ||
      (user.username && recUploaderId && user.username === recUploaderId) ||
      (user.displayName && recUploaderName && recUploaderName.toLowerCase().includes(String(user.displayName).toLowerCase()))
    )
  );
  const isSelfUploaded = isSelfUploadedSupervisor || isSelfUploadedPersonnel;

  // Personelin bağlı olduğu şefin faturası mı? (Aynı satınalma ekibi yetkisi)
  let parentSupervisorId = user.supervisorId;
  if (!parentSupervisorId && user.personnelId) {
    parentSupervisorId = DEFAULT_PERSONNEL_SUPERVISORS[user.personnelId];
  }
  const isTeamRecord = Boolean(
    user.role === 'personnel' && parentSupervisorId && (
      recSupId === parentSupervisorId ||
      (parentSupervisorId && DEFAULT_SUPERVISOR_JOBSITES[parentSupervisorId]?.some(jid => jid === canonJobId))
    )
  );

  // Satınalma Şefi: Bağlı olduğu şantiye veya kendi yüklediği fatura
  if (user.role === 'supervisor') {
    if (hasJobsitePermission || isSelfUploaded) {
      return {
        canEdit: true,
        canDelete: true,
        canView: true,
        isReadOnly: false,
        authorizedJobsites: Array.from(authorizedJobsites)
      };
    }
    return {
      canEdit: false,
      canDelete: false,
      canView: true,
      isReadOnly: true,
      reason: 'Satınalma Şefi yalnızca bağlı olduğu şantiyelere ait faturaları değiştirebilir veya silebilir.',
      authorizedJobsites: Array.from(authorizedJobsites)
    };
  }

  // Satınalma Personeli: Bağlı olduğu şantiyelere ait faturalarda silme ve değiştirme yetkisi var
  if (user.role === 'personnel') {
    if (hasJobsitePermission || isSelfUploaded || isTeamRecord) {
      return {
        canEdit: true,
        canDelete: true,
        canView: true,
        isReadOnly: false,
        authorizedJobsites: Array.from(authorizedJobsites)
      };
    }
    return {
      canEdit: false,
      canDelete: false,
      canView: true,
      isReadOnly: true,
      reason: 'Satınalma Personeli yalnızca bağlı olduğu şantiyelerin faturalarını değiştirebilir ve silebilir (Diğer şantiyeler salt okunurdur).',
      authorizedJobsites: Array.from(authorizedJobsites)
    };
  }

  return { canEdit: false, canDelete: false, canView: true, isReadOnly: true };
}
