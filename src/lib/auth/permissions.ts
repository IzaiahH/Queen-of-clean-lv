export const ROLES = ["owner", "admin", "office", "cleaner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  office: "Office / scheduling",
  cleaner: "Cleaner",
};

/**
 * Capability matrix. Server code calls `can()` (via requireCapability) before every sensitive
 * read or write; hiding UI is never the only control.
 */
export const CAPABILITIES = {
  "dashboard.view": ["owner", "admin", "office"],
  "schedule.view": ["owner", "admin", "office"],
  "schedule.edit": ["owner", "admin", "office"],
  "customers.view": ["owner", "admin", "office"],
  "customers.edit": ["owner", "admin", "office"],
  "customers.merge": ["owner", "admin"],
  "quotes.view": ["owner", "admin", "office"],
  "quotes.edit": ["owner", "admin", "office"],
  "quotes.override": ["owner", "admin"],
  "cleaners.view": ["owner", "admin", "office"],
  "cleaners.edit": ["owner", "admin"],
  "cleaners.pay": ["owner", "admin"],
  "pricing.edit": ["owner", "admin"],
  "finance.view": ["owner", "admin"],
  "finance.edit": ["owner", "admin"],
  "reports.view": ["owner", "admin"],
  "data.import": ["owner", "admin"],
  "data.export": ["owner", "admin"],
  "settings.edit": ["owner", "admin"],
  "users.manage": ["owner"],
  "jobs.own": ["cleaner"],
} as const satisfies Record<string, readonly Role[]>;
export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return (CAPABILITIES[cap] as readonly Role[]).includes(role);
}

export const ADMIN_NAV: { href: string; label: string; cap: Capability }[] = [
  { href: "/admin", label: "Dashboard", cap: "dashboard.view" },
  { href: "/admin/calendar", label: "Calendar", cap: "schedule.view" },
  { href: "/admin/appointments", label: "Appointments", cap: "schedule.view" },
  { href: "/admin/customers", label: "Customers", cap: "customers.view" },
  { href: "/admin/quotes", label: "Quotes", cap: "quotes.view" },
  { href: "/admin/cleaners", label: "Cleaners", cap: "cleaners.view" },
  { href: "/admin/pricing", label: "Pricing & Services", cap: "pricing.edit" },
  { href: "/admin/finance", label: "Revenue & Expenses", cap: "finance.view" },
  { href: "/admin/reports", label: "Reports", cap: "reports.view" },
  { href: "/admin/import-export", label: "Import / Export", cap: "data.import" },
  { href: "/admin/settings", label: "Settings", cap: "settings.edit" },
];
