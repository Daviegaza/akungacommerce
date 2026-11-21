/**
 * Role → permission matrix. The database enforces the same matrix in
 * `public.has_permission()`; this copy only drives what the UI offers.
 */
export const ROLES = ['owner', 'admin', 'manager', 'sales', 'fulfilment', 'analyst'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales: 'Sales',
  fulfilment: 'Fulfilment',
  analyst: 'Analyst (read-only)',
}

export type Permission =
  | 'org.manage'
  | 'team.manage'
  | 'integrations.manage'
  | 'catalogue.write'
  | 'cost.read'
  | 'customers.write'
  | 'orders.create'
  | 'orders.transition'
  | 'inventory.adjust'
  | 'payments.record'
  | 'refunds.create'
  | 'fulfilment.update'

const MATRIX: Record<Permission, readonly Role[]> = {
  'org.manage': ['owner', 'admin'],
  'team.manage': ['owner', 'admin'],
  'integrations.manage': ['owner', 'admin'],
  'catalogue.write': ['owner', 'admin', 'manager'],
  'cost.read': ['owner', 'admin', 'manager'],
  'customers.write': ['owner', 'admin', 'manager', 'sales'],
  'orders.create': ['owner', 'admin', 'manager', 'sales'],
  'orders.transition': ['owner', 'admin', 'manager', 'sales', 'fulfilment'],
  'inventory.adjust': ['owner', 'admin', 'manager'],
  'payments.record': ['owner', 'admin', 'manager', 'sales'],
  'refunds.create': ['owner', 'admin', 'manager'],
  'fulfilment.update': ['owner', 'admin', 'manager', 'fulfilment'],
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && MATRIX[permission].includes(role)
}

export const PERMISSION_MATRIX = MATRIX
