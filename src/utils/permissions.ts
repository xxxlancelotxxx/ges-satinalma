export function checkRecordPermission(user: any, supervisorId?: string, supervisorName?: string) {
  if (!user) return { canEdit: false, canDelete: false, canView: true };
  if (user.role === 'admin') return { canEdit: true, canDelete: true, canView: true };
  if (user.role === 'supervisor') {
    const isOwner =
      (user.supervisorId && supervisorId && user.supervisorId === supervisorId) ||
      (user.displayName && supervisorName && user.displayName.toLowerCase() === supervisorName.toLowerCase());
    return { canEdit: Boolean(isOwner), canDelete: Boolean(isOwner), canView: true };
  }
  return { canEdit: false, canDelete: false, canView: true };
}
