import type { Account, CurrentUser } from './accounts.ts';
import type { Status } from './social.ts';

/** Settings an administrator can change at run time. */
export interface InstanceSettings {
  title: string;
  description: string;
  registrationMode: 'open' | 'approval' | 'invite' | 'closed';
  rules: string[];
  contactEmail: string;
}

/** A server known to this instance (admin federation view). */
export interface KnownInstance {
  domain: string;
  accounts: number;
  protocols: ('activitypub' | 'diaspora')[];
  followersOfLocalAccounts: number;
  lastSeenAt: string;
  block: 'silence' | 'suspend' | null;
}

export interface DomainBlock {
  id: string;
  domain: string;
  severity: 'silence' | 'suspend';
  publicComment: string;
  privateComment: string;
  createdAt: string;
}

export interface PendingUser {
  userId: string;
  email: string;
  reason: string;
  createdAt: string;
  account: Account;
}

export interface AdminAccount {
  account: Account;
  domain: string | null;
  suspended: boolean;
  user: {
    id: string;
    email: string;
    role: CurrentUser['role'];
    approved: boolean;
    lastSignInAt: string | null;
  } | null;
}

export interface Report {
  id: string;
  category: 'spam' | 'illegal' | 'harassment' | 'violation' | 'other';
  comment: string;
  statusIds: string[];
  statuses: Status[];
  createdAt: string;
  resolvedAt: string | null;
  reporter: Account | null;
  target: Account | null;
}
