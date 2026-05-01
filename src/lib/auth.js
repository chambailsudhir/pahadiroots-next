// ── Role-based Auth System ────────────────────────────────────

export const ROLES = {
  OWNER:   'owner',
  MANAGER: 'manager',
  PACKING: 'packing',
  VENDOR:  'vendor',
};

// Role permissions matrix
export const PERMISSIONS = {
  [ROLES.OWNER]: {
    pages:    ['dashboard', 'products', 'customers', 'operations', 'marketing', 'analytics', 'settings', 'profit', 'orders', 'coupons', 'catalogue', 'logs', 'logs/inventory', 'logs/orders', 'logs/admin', 'states', 'team', 'subscribers', 'reviews', 'vendors'],
    canEdit:  true,
    canDelete: true,
    seeRevenue: true,
    seeCustomerData: true,
    seeSettings: true,
  },
  [ROLES.MANAGER]: {
    pages:    ['dashboard', 'products', 'customers', 'operations', 'analytics', 'orders', 'profit', 'coupons', 'vendors'],
    canEdit:  true,
    canDelete: false,
    seeRevenue: true,
    seeCustomerData: true,
    seeSettings: false,
  },
  [ROLES.PACKING]: {
    pages:    ['operations'],
    canEdit:  true,  // can update order status only
    canDelete: false,
    seeRevenue: false,
    seeCustomerData: false,
    seeSettings: false,
  },
  [ROLES.VENDOR]: {
    pages:    ['vendor-portal'],   // only the vendor portal page
    canEdit:  true,                // own products only
    canDelete: false,
    seeRevenue: false,
    seeCustomerData: false,
    seeSettings: false,
    isVendor: true,
  },
};

// Password → Role mapping (stored in env)
// OWNER_PASSWORD, MANAGER_PASSWORD, PACKING_PASSWORD
export function getRoleFromPassword(pw) {
  // In Next.js API route, check against env vars
  // Client side just stores the role after login
  return typeof window !== 'undefined'
    ? sessionStorage.getItem('pr_role') || null
    : null;
}

export function getCurrentRole() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('pr_role');
}

export function hasPermission(permission) {
  const role = getCurrentRole();
  if (!role) return false;
  return PERMISSIONS[role]?.[permission] ?? false;
}

export function canAccessPage(page) {
  const role = getCurrentRole();
  if (!role) return false;
  return PERMISSIONS[role]?.pages?.includes(page) ?? false;
}

export function isAuthenticated() {
  if (typeof window === 'undefined') return false;
  return !!sessionStorage.getItem('pr_pw');
}

export function logout() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('pr_pw');
  sessionStorage.removeItem('pr_role');
}
