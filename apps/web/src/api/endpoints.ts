import type {
  Account,
  ChangePasswordRequest,
  CurrentUser,
  InstanceInfo,
  LoginRequest,
  LoginResponse,
  Passkey,
  RecoveryCodesResponse,
  RegisterRequest,
  TotpSetupResponse,
  UpdateProfileRequest,
  UpdateSettingsRequest,
} from '@disbigle/shared';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { api } from './client.ts';

type Ok = { status: 'ok' };

export type RegisterResponse = { status: 'ok'; user: CurrentUser } | { status: 'pending_approval' };

export interface PasskeyAuthOptions {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export const endpoints = {
  instance: () => api.get<InstanceInfo>('/instance'),
  lookupAccount: (username: string) =>
    api.get<Account>(`/accounts/lookup/${encodeURIComponent(username).replace(/%40/g, '@')}`),

  registerChallenge: () =>
    api.get<{ challenge: string | null; salt?: string; difficulty?: number }>(
      '/auth/register/challenge',
    ),
  register: (body: RegisterRequest & { challenge?: string; nonce?: string; website?: string }) =>
    api.post<RegisterResponse>('/auth/register', body),
  login: (body: LoginRequest) => api.post<LoginResponse>('/auth/login', body),
  mfa: (code: string) => api.post<Ok>('/auth/mfa', { code }),
  logout: () => api.post<Ok>('/auth/logout'),
  forgotPassword: (email: string) => api.post<Ok>('/auth/password/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    api.post<Ok>('/auth/password/reset', { token, password }),
  passkeyAuthOptions: () => api.post<PasskeyAuthOptions>('/auth/passkey/options'),
  passkeyAuthVerify: (challengeId: string, response: AuthenticationResponseJSON) =>
    api.post<Ok>('/auth/passkey/verify', { challengeId, response }),

  me: () => api.get<CurrentUser>('/me'),
  updateProfile: (body: UpdateProfileRequest) => api.patch<Account>('/me/profile', body),
  uploadProfileImage: (kind: 'avatar' | 'header', file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.upload<CurrentUser>(`/me/${kind}`, form);
  },
  removeProfileImage: (kind: 'avatar' | 'header') => api.delete<CurrentUser>(`/me/${kind}`),
  deleteAccount: (password: string) => api.post<Ok>('/me/delete', { password }),
  updateSettings: (body: UpdateSettingsRequest) => api.patch<CurrentUser>('/me/settings', body),
  changePassword: (body: ChangePasswordRequest) => api.post<Ok>('/me/password', body),
  totpSetup: () => api.post<TotpSetupResponse>('/me/totp/setup'),
  totpConfirm: (code: string) => api.post<RecoveryCodesResponse>('/me/totp/confirm', { code }),
  totpDisable: (password: string) => api.post<Ok>('/me/totp/disable', { password }),
  regenerateRecoveryCodes: (password: string) =>
    api.post<RecoveryCodesResponse>('/me/recovery-codes', { password }),
  passkeys: () => api.get<Passkey[]>('/me/passkeys'),
  passkeyRegistrationOptions: () =>
    api.post<PublicKeyCredentialCreationOptionsJSON>('/me/passkeys/options'),
  addPasskey: (name: string, response: RegistrationResponseJSON) =>
    api.post<Passkey>('/me/passkeys', { name, response }),
  deletePasskey: (id: string) => api.delete<Ok>(`/me/passkeys/${encodeURIComponent(id)}`),
};
