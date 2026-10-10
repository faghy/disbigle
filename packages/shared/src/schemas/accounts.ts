import { z } from 'zod';
import { supportedLocales } from './auth.ts';

export const profileFieldSchema = z.object({
  name: z.string().trim().max(255),
  value: z.string().trim().max(2047),
});

export const updateProfileRequestSchema = z.object({
  displayName: z.string().trim().max(100).optional(),
  note: z.string().trim().max(5000).optional(),
  fields: z.array(profileFieldSchema).max(4).optional(),
  locked: z.boolean().optional(),
  discoverable: z.boolean().optional(),
  bot: z.boolean().optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const updateSettingsRequestSchema = z.object({
  locale: z.enum(supportedLocales).optional(),
});
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;

/** Public representation of an account (local or remote). */
export interface Account {
  id: string;
  username: string;
  /** `username` for local accounts, `username@domain` for remote ones. */
  acct: string;
  displayName: string;
  /** Profile bio as plain text (rendered by the client). */
  note: string;
  avatarUrl: string | null;
  headerUrl: string | null;
  fields: { name: string; value: string }[];
  locked: boolean;
  bot: boolean;
  discoverable: boolean;
  local: boolean;
  url: string | null;
  createdAt: string;
}

/** The signed-in user: their account plus private settings. */
export interface CurrentUser {
  account: Account;
  email: string;
  role: 'user' | 'moderator' | 'admin';
  locale: string;
  totpEnabled: boolean;
  passkeyCount: number;
}

export interface InstanceInfo {
  domain: string;
  title: string;
  registrationMode: 'open' | 'approval' | 'invite' | 'closed';
  version: string;
}
