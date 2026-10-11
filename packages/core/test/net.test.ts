import { describe, expect, it } from 'vitest';
import { assertPublicUrl, isPrivateAddress } from '../src/index.ts';

describe('public URL check', () => {
  it('tells private addresses from public ones', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '0.0.0.0',
    ])
      expect(isPrivateAddress(address), address).toBe(true);
    for (const address of ['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])
      expect(isPrivateAddress(address), address).toBe(false);
  });

  it('refuses http and private hosts', async () => {
    await expect(assertPublicUrl('http://push.example/x')).rejects.toThrow();
    await expect(assertPublicUrl('https://127.0.0.1/x')).rejects.toThrow();
    await expect(assertPublicUrl('https://[::1]/x')).rejects.toThrow();
    await expect(assertPublicUrl('https://localhost/x')).rejects.toThrow();
    await expect(assertPublicUrl('https://1.1.1.1/x')).resolves.toBeUndefined();
  });
});
