import { z } from 'zod';

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{1,30}$/;
export const supportedLocales = ['en', 'it'] as const;
export type Locale = (typeof supportedLocales)[number];

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_PATTERN, 'Use 1-30 letters, digits or underscores');

export const passwordSchema = z.string().min(10, 'At least 10 characters').max(256);

export const registerRequestSchema = z.object({
  username: usernameSchema,
  email: z.email().trim().max(320),
  password: passwordSchema,
  locale: z.enum(supportedLocales).default('en'),
  reason: z.string().trim().max(1000).optional(),
  inviteCode: z.string().trim().max(64).optional(),
  agreement: z.literal(true, 'You must accept the rules'),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  /** Email address or username. */
  login: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const mfaCodeRequestSchema = z.object({
  code: z.string().trim().min(6).max(32),
});
export type MfaCodeRequest = z.infer<typeof mfaCodeRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const loginResponseSchema = z.object({
  status: z.enum(['ok', 'mfa_required']),
  /** Second-factor methods available when status is mfa_required. */
  methods: z.array(z.enum(['totp', 'recovery_code', 'passkey'])).optional(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export interface RecoveryCodesResponse {
  codes: string[];
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
