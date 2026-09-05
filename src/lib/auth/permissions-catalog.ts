// Source of truth for the permission catalogue and default role
// compositions — consumed by scripts/seed/roles-permissions.ts. Adding a
// permission here and re-running that seed is how access changes; nothing
// in application code should ever branch on a role key string instead of
// calling can() (src/lib/auth/rbac.ts) with one of these keys.
//
// 39 permissions across 12 domains — comfortably past the "36+" in
// docs/ARCHITECTURE.md §4.

export const PERMISSIONS = [
  // --- Users & access ---
  { key: 'user.view', description: 'View user accounts and profiles' },
  { key: 'user.suspend', description: 'Suspend or reinstate a user account' },
  { key: 'role.manage', description: 'Assign or remove roles on a user' },
  { key: 'permission.view', description: 'View the permission catalogue and role compositions' },

  // --- Service catalogue ---
  { key: 'service.view', description: 'View the service catalogue (admin view)' },
  { key: 'service.edit', description: 'Edit service name, description and marketing copy' },
  {
    key: 'service.pricing',
    description: 'Edit service plan pricing (separate from service.edit — see docs/ARCHITECTURE.md §11)',
  },

  // --- Orders ---
  { key: 'order.view_all', description: 'View all client orders, not just assigned ones' },
  { key: 'order.assign', description: 'Assign staff to an order' },
  { key: 'order.update_stage', description: 'Advance or roll back an order\'s workflow stage' },
  { key: 'order.cancel', description: 'Cancel an order' },

  // --- CRM ---
  { key: 'crm.view', description: 'View CRM contacts and pipeline' },
  { key: 'crm.edit', description: 'Edit CRM contact details and stage' },
  { key: 'crm.assign', description: 'Assign a CRM contact to an account owner' },
  { key: 'crm.task.manage', description: 'Create, assign and close CRM tasks' },

  // --- Meetings ---
  { key: 'meeting.schedule', description: 'Schedule a client meeting' },
  { key: 'meeting.view_all', description: 'View all scheduled meetings, not just your own' },

  // --- Affiliate programme ---
  { key: 'affiliate.view', description: 'View affiliate accounts and their activity' },
  { key: 'affiliate.kyc.review', description: 'Approve or reject affiliate KYC submissions' },
  { key: 'affiliate.suspend', description: 'Suspend or reinstate an affiliate' },
  { key: 'affiliate.terminate', description: 'Permanently terminate an affiliate' },
  { key: 'affiliate.commission.adjust', description: 'Create a manual commission adjustment entry' },

  // --- Payouts & commission policy ---
  { key: 'payout.view', description: 'View payout requests and history' },
  { key: 'payout.approve', description: 'Approve a payout for processing' },
  { key: 'payout.process', description: 'Trigger the actual funds transfer for an approved payout' },
  { key: 'commission.policy.edit', description: 'Edit commission rate, fee, and payout policy settings' },

  // --- Training portal ---
  { key: 'training.course.author', description: 'Create and edit training courses, modules and videos' },
  { key: 'training.course.publish', description: 'Publish a draft course, module or video' },
  { key: 'training.progress.view_all', description: "View all learners' progress, not just your own" },

  // --- Support ---
  { key: 'support.ticket.view_all', description: 'View all support tickets' },
  { key: 'support.ticket.respond', description: 'Respond to a support ticket' },
  { key: 'support.ticket.close', description: 'Close or reopen a support ticket' },

  // --- Settings & platform ---
  { key: 'settings.view', description: 'View admin-configurable platform settings' },
  { key: 'settings.edit', description: 'Edit admin-configurable platform settings' },
  { key: 'audit.view', description: 'View the audit log' },
  { key: 'webhook.view', description: 'View incoming webhook event history' },
  { key: 'job.view', description: 'View scheduled job run history (commission scheduler, etc.)' },

  // --- Reporting ---
  { key: 'report.revenue.view', description: 'View revenue and financial reports' },
  { key: 'report.affiliate.view', description: 'View affiliate performance reports' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ROLES: { key: string; label: string; permissions: PermissionKey[] }[] = [
  {
    key: 'ADMIN',
    label: 'Administrator',
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    key: 'STAFF',
    label: 'Operations Staff',
    permissions: [
      'order.view_all',
      'order.assign',
      'order.update_stage',
      'crm.view',
      'crm.edit',
      'crm.assign',
      'crm.task.manage',
      'meeting.schedule',
      'meeting.view_all',
      'support.ticket.view_all',
      'support.ticket.respond',
      'support.ticket.close',
    ],
  },
  {
    key: 'AFFILIATE_MANAGER',
    label: 'Affiliate Manager',
    permissions: [
      'affiliate.view',
      'affiliate.kyc.review',
      'affiliate.suspend',
      'affiliate.terminate',
      'affiliate.commission.adjust',
      'payout.view',
      'payout.approve',
      'report.affiliate.view',
    ],
  },
  {
    key: 'FINANCE',
    label: 'Finance',
    permissions: [
      'payout.view',
      'payout.approve',
      'payout.process',
      'commission.policy.edit',
      'service.pricing',
      'report.revenue.view',
    ],
  },
  {
    key: 'CONTENT_MANAGER',
    label: 'Content Manager',
    permissions: ['service.view', 'service.edit', 'training.course.author', 'training.course.publish'],
  },
];
