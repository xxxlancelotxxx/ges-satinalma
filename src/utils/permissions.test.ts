import assert from 'node:assert/strict';
import {
  checkRecordPermission,
  getUserAuthorizedJobsiteIds,
  canonicalizeJobsiteId
} from './permissions';

console.log('=== ROLE-BASED RECORD PERMISSIONS TEST ===');

// 1. Admin checks
const adminUser = { role: 'admin', username: 'admin', displayName: 'Admin' };
const adminPerm = checkRecordPermission(adminUser, { jobsiteId: 'job_8', uploadedBySupervisorId: 'sup_2' });
assert.equal(adminPerm.canEdit, true, 'Admin can edit');
assert.equal(adminPerm.canDelete, true, 'Admin can delete');
assert.equal(adminPerm.isReadOnly, false, 'Admin is not read-only');
console.log('✓ Admin has full access to all jobsites');

// 2. Supervisor checks (Nuri Buga: sup_1 -> job_5, job_6, job_9)
const nuriUser = { role: 'supervisor', supervisorId: 'sup_1', displayName: 'Nuri Buga' };

// In-scope jobsite for Nuri Buga: job_9 (Mnevniki Havuz)
const nuriPermIn = checkRecordPermission(nuriUser, { jobsiteId: 'job_9', jobsiteName: 'Mnevniki Havuz' });
assert.equal(nuriPermIn.canEdit, true, 'Nuri can edit in Mnevniki');
assert.equal(nuriPermIn.canDelete, true, 'Nuri can delete in Mnevniki');
assert.equal(nuriPermIn.isReadOnly, false, 'Nuri is not read-only in Mnevniki');

// Out-of-scope jobsite for Nuri Buga: job_8 (Citybay6)
const nuriPermOut = checkRecordPermission(nuriUser, { jobsiteId: 'job_8', jobsiteName: 'Citybay6' });
assert.equal(nuriPermOut.canEdit, false, 'Nuri cannot edit Citybay6');
assert.equal(nuriPermOut.canDelete, false, 'Nuri cannot delete Citybay6');
assert.equal(nuriPermOut.isReadOnly, true, 'Nuri is read-only in Citybay6');
console.log('✓ Supervisor (Nuri Buga) has edit/delete for assigned jobsites, read-only for other jobsites');

// 3. Personnel checks
// Aleksandra Ozlav (pers_1, under sup_1 Nuri Buga -> job_5, job_6, job_9)
const aleksandraUser = { role: 'personnel', personnelId: 'pers_1', supervisorId: 'sup_1', displayName: 'Aleksandra Ozlav' };

// In-scope jobsite for Aleksandra: job_5 (Jk Dream Riva)
const aleksandraPermIn = checkRecordPermission(aleksandraUser, { jobsiteId: 'job_5', jobsiteName: 'Jk Dream Riva' });
assert.equal(aleksandraPermIn.canEdit, true, 'Aleksandra can edit Jk Dream Riva');
assert.equal(aleksandraPermIn.canDelete, true, 'Aleksandra can delete Jk Dream Riva');
assert.equal(aleksandraPermIn.isReadOnly, false, 'Aleksandra is not read-only in Jk Dream Riva');

// Out-of-scope jobsite for Aleksandra: job_1 (SET OF3a)
const aleksandraPermOut = checkRecordPermission(aleksandraUser, { jobsiteId: 'job_1', jobsiteName: 'SET OF3a' });
assert.equal(aleksandraPermOut.canEdit, false, 'Aleksandra cannot edit SET OF3a');
assert.equal(aleksandraPermOut.canDelete, false, 'Aleksandra cannot delete SET OF3a');
assert.equal(aleksandraPermOut.isReadOnly, true, 'Aleksandra is read-only in SET OF3a');

// Furkat Bekimbetov (pers_1787685955097, under sup_2 Osman Yılmaz -> job_8 Citybay6)
const furkatUser = { role: 'personnel', personnelId: 'pers_1787685955097', supervisorId: 'sup_2', displayName: 'Furkat Bekimbetov' };
const furkatPermIn = checkRecordPermission(furkatUser, { jobsiteId: 'job_8', jobsiteName: 'Citybay6' });
assert.equal(furkatPermIn.canEdit, true, 'Furkat can edit Citybay6');
assert.equal(furkatPermIn.canDelete, true, 'Furkat can delete Citybay6');

const furkatPermOut = checkRecordPermission(furkatUser, { jobsiteId: 'job_3', jobsiteName: 'Jk Jois' });
assert.equal(furkatPermOut.canEdit, false, 'Furkat cannot edit Jk Jois');
assert.equal(furkatPermOut.canDelete, false, 'Furkat cannot delete Jk Jois');
console.log('✓ Personnel has edit/delete for assigned jobsites, read-only for other jobsites');

// 4. Viewer check
const viewerUser = { role: 'viewer', username: 'viewer', displayName: 'Gözlemci' };
const viewerPerm = checkRecordPermission(viewerUser, { jobsiteId: 'job_1' });
assert.equal(viewerPerm.canEdit, false, 'Viewer cannot edit');
assert.equal(viewerPerm.canDelete, false, 'Viewer cannot delete');
assert.equal(viewerPerm.isReadOnly, true, 'Viewer is read-only');
console.log('✓ Viewer is read-only everywhere');

// 5. Jobsite canonicalization test
assert.equal(canonicalizeJobsiteId('job_1'), 'job_1');
assert.equal(canonicalizeJobsiteId(undefined, 'Mnevniki Havuz'), 'job_9');
assert.equal(canonicalizeJobsiteId(undefined, 'SET OF3A'), 'job_1');
assert.equal(canonicalizeJobsiteId(undefined, 'SILIKATNAYA 1.ETAP (JOIS)'), 'job_3');
console.log('✓ Jobsite canonicalization correctly maps aliases and names');

console.log('>>> ALL PERMISSION TESTS PASSED <<<');
