import type { Config } from '@disbigle/config';

export const testConfig: Config = {
  NODE_ENV: 'test',
  PUBLIC_URL: 'https://disbigle.test',
  LOCAL_DOMAIN: 'disbigle.test',
  HOST: '127.0.0.1',
  PORT: 0,
  DATABASE_URL: '',
  REDIS_URL: '',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-test',
  REGISTRATION_MODE: 'open',
  MEDIA_DIR: '/tmp/disbigle-test-media',
  INSTANCE_TITLE: 'Disbigle Test',
  INSTANCE_DESCRIPTION: '',
  MAIL_FROM: 'Disbigle Test <noreply@disbigle.test>',
};

let counter = 0;
export function newUser() {
  counter += 1;
  const username = `u${counter}_${Math.random().toString(36).slice(2, 7)}`;
  return {
    username,
    email: `${username}@example.com`,
    password: 'correct horse battery staple',
    agreement: true as const,
  };
}
