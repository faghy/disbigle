import { describe, expect, it } from 'vitest';
import {
  issueChallenge,
  leadingZeroBits,
  solveChallenge,
  verifyRegistrationGuard,
} from '../src/registration-guard.ts';
import { Client, newUser, useTestApp } from './helpers.ts';

const app = useTestApp({}, { registrationGuard: true });

async function challenge() {
  const response = await new Client(app).get('/api/v1/auth/register/challenge');
  expect(response.statusCode).toBe(200);
  return response.json() as { challenge: string; salt: string; difficulty: number };
}

describe('registration anti-robot check', () => {
  it('counts leading zero bits', () => {
    expect(leadingZeroBits(Buffer.from([0, 0, 0x0f]))).toBe(20);
    expect(leadingZeroBits(Buffer.from([0x80]))).toBe(0);
    expect(leadingZeroBits(Buffer.from([0x01, 0xff]))).toBe(7);
  });

  it('refuses a sign-up without a solved challenge', async () => {
    const response = await new Client(app).post('/api/v1/auth/register', newUser());
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bot_check_failed');
  });

  it('refuses a filled-in honeypot and an answer that comes too fast or too late', async () => {
    const issuedAt = Date.now();
    const c = issueChallenge(app.ctx(), issuedAt);
    const nonce = solveChallenge(c.salt, c.difficulty);
    const check = (input: object, at: number) =>
      verifyRegistrationGuard(app.ctx(), { challenge: c.challenge, nonce, ...input }, at).then(
        () => 'ok',
        (error: { code?: string }) => error.code,
      );
    expect(await check({}, issuedAt + 5_000)).toBe('ok');
    expect(await check({ website: 'https://spam.example' }, issuedAt + 5_000)).toBe(
      'bot_check_failed',
    );
    expect(await check({}, issuedAt + 1_000)).toBe('bot_check_failed');
    expect(await check({}, issuedAt + 3 * 60 * 60 * 1000)).toBe('bot_check_failed');
  });

  it('accepts a solved challenge once, after a human pause', async () => {
    const c = await challenge();
    const nonce = solveChallenge(c.salt, c.difficulty);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    // A sign-up refused for another reason does not burn the answer.
    const invalid = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      username: 'not valid!',
      challenge: c.challenge,
      nonce,
    });
    expect(invalid.statusCode).toBe(422);
    const ok = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      challenge: c.challenge,
      nonce,
    });
    expect(ok.statusCode).toBe(201);
    const replay = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      challenge: c.challenge,
      nonce,
    });
    expect(replay.json().error).toBe('bot_check_failed');
    const wrong = await challenge();
    await new Promise((resolve) => setTimeout(resolve, 3100));
    const badNonce = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      challenge: wrong.challenge,
      nonce: 'not-a-solution',
    });
    expect(badNonce.json().error).toBe('bot_check_failed');
    const tampered = await new Client(app).post('/api/v1/auth/register', {
      ...newUser(),
      challenge: `${wrong.challenge.split('.')[0]}.forged`,
      nonce: solveChallenge(wrong.salt, wrong.difficulty),
    });
    expect(tampered.json().error).toBe('bot_check_failed');
  }, 20_000);
});
