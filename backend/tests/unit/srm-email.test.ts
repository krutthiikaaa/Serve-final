import { describe, expect, it } from 'vitest';
import {
  isSrmEmail,
  normalizeEmail,
  srmIdentityRejection,
} from '../../src/modules/auth/srm-email.js';

describe('SRM email rule', () => {
  it.each([
    'student@srmap.edu.in',
    'Student@SRMAP.EDU.IN',
    '  first.last@srmap.edu.in  ',
    'ap21110010001@srmap.edu.in',
    'a_b-c+d@srmap.edu.in',
  ])('allows %s', (email) => {
    expect(isSrmEmail(email)).toBe(true);
  });

  it.each([
    'student@gmail.com',
    'student@yahoo.com',
    'student@srmap.edu.in.attacker.com',
    'student@fake-srmap.edu.in',
    'student@mail.srmap.edu.in',
    'student@srmap.edu',
    'student@srmap.edu.in.',
    'srmap.edu.in',
    '@srmap.edu.in',
    'a@b@srmap.edu.in',
    '"a@b"@srmap.edu.in',
    'stu dent@srmap.edu.in',
    '.student@srmap.edu.in',
    'stu..dent@srmap.edu.in',
    'student@srmаp.edu.in', // Cyrillic "а"
    'stüdent@srmap.edu.in',
    '',
  ])('rejects %j', (email) => {
    expect(isSrmEmail(email)).toBe(false);
  });

  it('rejects non-strings', () => {
    for (const value of [null, undefined, 42, {}, ['a@srmap.edu.in']]) {
      expect(isSrmEmail(value)).toBe(false);
      expect(normalizeEmail(value)).toBeNull();
    }
  });

  it('normalises by trimming and lower-casing only', () => {
    expect(normalizeEmail('  A.B@SRMAP.edu.IN ')).toBe('a.b@srmap.edu.in');
  });

  it('requires the provider to have verified the address', () => {
    expect(srmIdentityRejection({ email: 'a@srmap.edu.in', emailVerified: true })).toBeNull();
    expect(srmIdentityRejection({ email: 'a@srmap.edu.in', emailVerified: 'true' })).toBeNull();
    for (const verified of [false, 'false', undefined, null, 1]) {
      expect(srmIdentityRejection({ email: 'a@srmap.edu.in', emailVerified: verified })).toBe(
        'EMAIL_NOT_VERIFIED',
      );
    }
    expect(srmIdentityRejection({ email: 'a@gmail.com', emailVerified: true })).toBe(
      'EMAIL_DOMAIN_NOT_ALLOWED',
    );
  });
});
