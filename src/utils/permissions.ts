export function checkRecordPermission(user: any, _supervisorId?: string, _supervisorName?: string) {
  if (!user) return { canEdit: false, canDelete: false, canView: true };
  if (user.role === 'admin') return { canEdit: true, canDelete: true, canView: true };
  return { canEdit: false, canDelete: false, canView: true };
}

