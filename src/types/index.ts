export type UserRole = 'OWNER' | 'REVIEWER';

export interface UserProfile {
  id: string;
  name: string;
  designation: string;
  phone: string;
  email: string;
  placement: string; // Current site / project placement
  avatarUrl?: string;
  role?: string; // 'admin' | 'tech-admin' | 'user'
}

export interface RetirementAccess {
  userId: string;
  userEmail: string;
  userName: string;
  role: UserRole;
  grantedAt: string;
}

export interface ExpenseItem {
  id: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number; // quantity * rate
}

export interface Category {
  id: string;
  name: string;
  items: ExpenseItem[];
  subtotal: number; // sum of item amounts
}

export interface DailyRecord {
  id: string;
  retirementId: string;
  date: string; // YYYY-MM-DD
  categories: Category[];
  dailyTotal: number; // sum of category subtotals
  createdAt: string;
  updatedAt: string;
  baseUpdatedAt?: string; // Last synced cloud updatedAt timestamp
  deletedItemIds?: string[]; // Item IDs deleted locally while record syncStatus is pending
  syncStatus: 'synced' | 'pending';
}

export interface SupplementaryEntry {
  id: string;
  retirementId: string;
  description: string;
  amount: number;
  createdAt: string;
  syncStatus: 'synced' | 'pending';
}

export interface ActivityLog {
  id: string;
  retirementId: string;
  userId: string;
  userName: string;
  action: string;
  details?: string;
  timestamp: string;
}

export interface Retirement {
  id: string; // Internal UUID
  code: string; // Human-friendly code: e.g. RET-7K4M2P
  title: string;
  project: string; // Project/Site name
  ownerId: string;
  ownerName: string;
  ownerDesignation: string;
  ownerPhone: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'in_trash';
  deletedAt?: string; // For 48-hour trash expiration
  access: RetirementAccess[];
  connectedRetirementIds: string[];
  isDemo?: boolean;
  syncStatus: 'synced' | 'pending';
}

export interface RetirementTotals {
  dailyRetirementTotal: number;
  supplementaryTotal: number;
  generalTotal: number;
  categorySummaries: { category: string; total: number }[];
  dailySummaries: { date: string; total: number }[];
}

export type ActiveUtility = 'retirement' | 'project_report' | 'other_utilities' | 'user_management';

export type SyncOperationType =
  | 'UPSERT_RETIREMENT'
  | 'DELETE_RETIREMENT'
  | 'UPSERT_DAILY_RECORD'
  | 'DELETE_DAILY_RECORD'
  | 'UPSERT_SUPPLEMENTARY'
  | 'DELETE_SUPPLEMENTARY'
  | 'CONNECT_RETIREMENTS'
  | 'DISCONNECT_RETIREMENTS'
  | 'CLAIM_RETIREMENT'
  | 'UPDATE_PROFILE';

export interface SyncQueueItem {
  id: string; // Operation UUID
  type: SyncOperationType;
  entityId: string;
  retirementId?: string;
  payload: any;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  status: 'pending' | 'syncing' | 'failed';
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'synced' | 'pending' | 'offline' | 'error' | 'tables_missing';
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  tablesReady: boolean;
}
