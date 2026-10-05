import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  currentAdmin,
  currentApprovedStaff,
  currentStaff,
  currentStudent,
} from '../../src/middleware/auth.js';
import type { Principal } from '../../src/modules/auth/principal.js';

const identity = { uid: 'u1', email: 'u1@example.edu', emailVerified: false };
const req = (principal: Principal | null): Request =>
  ({ auth: { ...identity, principal } }) as Request;

const student: Principal = {
  role: 'STUDENT',
  id: 's1',
  firebaseUid: 'u1',
  email: 'u1@example.edu',
  name: 'S',
  isActive: true,
  hostelId: 'h1',
  defaultCanteenId: 'c1',
};
const staff = (
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEACTIVATED',
  canteenId: string | null,
): Principal => ({
  role: 'STAFF',
  id: 'st1',
  firebaseUid: 'u1',
  email: 'u1@example.edu',
  name: 'T',
  status,
  isActive: status !== 'DEACTIVATED',
  canteenId,
});
const admin: Principal = {
  role: 'ADMIN',
  id: 'a1',
  firebaseUid: 'u1',
  email: 'u1@example.edu',
  name: 'A',
  isActive: true,
};

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
};

describe('bearerToken', () => {
  it('extracts only well-formed bearer tokens', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc')).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe('role guards (database-backed principal)', () => {
  it('requires a registered account', () => {
    expect(codeOf(() => currentStudent(req(null)))).toBe('ACCOUNT_NOT_REGISTERED');
    expect(codeOf(() => currentAdmin(req(null)))).toBe('ACCOUNT_NOT_REGISTERED');
  });

  it('rejects the wrong role', () => {
    expect(codeOf(() => currentStudent(req(admin)))).toBe('FORBIDDEN_ROLE');
    expect(codeOf(() => currentAdmin(req(student)))).toBe('FORBIDDEN_ROLE');
    expect(codeOf(() => currentStaff(req(student)))).toBe('FORBIDDEN_ROLE');
  });

  it('rejects disabled students and admins', () => {
    expect(codeOf(() => currentStudent(req({ ...student, isActive: false })))).toBe(
      'ACCOUNT_DISABLED',
    );
    expect(codeOf(() => currentAdmin(req({ ...admin, isActive: false })))).toBe('ACCOUNT_DISABLED');
  });

  it('distinguishes pending, approved and deactivated staff', () => {
    expect(codeOf(() => currentStaff(req(staff('PENDING', null))))).toBeUndefined();
    expect(codeOf(() => currentApprovedStaff(req(staff('PENDING', null))))).toBe(
      'STAFF_NOT_APPROVED',
    );
    expect(codeOf(() => currentApprovedStaff(req(staff('REJECTED', null))))).toBe(
      'STAFF_NOT_APPROVED',
    );
    expect(codeOf(() => currentStaff(req(staff('DEACTIVATED', null))))).toBe('STAFF_DEACTIVATED');
    expect(currentApprovedStaff(req(staff('APPROVED', 'c1'))).canteenId).toBe('c1');
  });
});
