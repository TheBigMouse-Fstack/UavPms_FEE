export type StandardRoleFamily = 'admin' | 'manager' | 'inspector' | 'analyst' | 'technician' | 'other';

export interface MultiRolePrincipal {
  readonly role?: string | null;
  readonly roles?: readonly string[] | null;
}

const ROLE_FAMILY_MAP: Readonly<Record<string, StandardRoleFamily>> = {
  systemadmin: 'admin',
  manager: 'manager',
  inspector: 'inspector',
  analyst: 'analyst',
  technician: 'technician',
};

function toRoleFamily(raw: string): StandardRoleFamily {
  const normalized = raw.trim().toLowerCase().replace(/[\s_-]/g, '');
  return ROLE_FAMILY_MAP[normalized] ?? 'other';
}

/**
 * Tách toàn bộ role của người dùng từ cả `user.role` (đơn hoặc phân tách dấu phẩy) và `user.roles[]`
 * để áp dụng quy tắc hợp (union) quyền theo C-02.
 */
export function extractRoleFamilies(user: MultiRolePrincipal | null | undefined): ReadonlySet<StandardRoleFamily> {
  const families = new Set<StandardRoleFamily>();
  if (!user) return families;

  if (typeof user.role === 'string' && user.role.trim()) {
    for (const part of user.role.split(/[,;]/)) {
      const family = toRoleFamily(part);
      if (family !== 'other') families.add(family);
    }
  }

  if (Array.isArray(user.roles)) {
    for (const entry of user.roles) {
      if (typeof entry !== 'string' || !entry.trim()) continue;
      const family = toRoleFamily(entry);
      if (family !== 'other') families.add(family);
    }
  }

  return families;
}

export function hasAnyRoleFamily(
  user: MultiRolePrincipal | null | undefined,
  allowed: readonly StandardRoleFamily[],
): boolean {
  const userFamilies = extractRoleFamilies(user);
  for (const family of allowed) {
    if (userFamilies.has(family)) return true;
  }
  return false;
}

/** Chỉ `Technician` và `SystemAdmin` (kể cả multi-role union) được ghi BIST/FC tại Chi tiết Drone. */
export function canPerformDroneBist(user: MultiRolePrincipal | null | undefined): boolean {
  return hasAnyRoleFamily(user, ['admin', 'technician']);
}

/** `SystemAdmin`, `Technician`, `Manager`, `Inspector` xem được lịch sử kỹ thuật; `Analyst` bị 403. */
export function canViewDroneTechnicalHistory(user: MultiRolePrincipal | null | undefined): boolean {
  return hasAnyRoleFamily(user, ['admin', 'technician', 'manager', 'inspector']);
}

/** Chỉ `Manager` và `SystemAdmin` (kể cả multi-role union) được tạo/duyệt/đánh giá lại MF01. */
export function canManagePreMission(user: MultiRolePrincipal | null | undefined): boolean {
  return hasAnyRoleFamily(user, ['admin', 'manager']);
}
