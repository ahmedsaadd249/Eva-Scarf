// The store owner's account: signing in with the password (then, when switched on, a code sent to a
// confirmed inbox) and changing those settings in Dashboard → Settings.
import * as userRepo from '../repositories/users.js';
import { endOtherSessions, hashPassword, needsRehash, verifyPassword } from './auth.js';

/**
 * The owner for this email and password, or null. Takes as long for an unknown email as for a wrong
 * password. A password saved with older, weaker hash settings is upgraded now that we have the plain text.
 */
export async function checkOwnerSignIn(email, password) {
  const owner = email ? await userRepo.findOwnerByEmail(email) : null;
  const ok = await verifyPassword(password, owner?.password_hash ?? undefined);
  if (!owner || !ok) return null;
  if (needsRehash(owner.password_hash)) await userRepo.setPasswordHash(owner.id, await hashPassword(password));
  return owner;
}

/** The owner waiting for a sign-in code, if their second step is still switched on. */
export async function findOwnerAwaitingCode(userId) {
  const owner = await userRepo.findOwnerById(userId);
  return owner?.otp_email ? owner : null;
}

export const isCurrentPassword = (user, password) => verifyPassword(password, user.password_hash);

/** New password; every other device is signed out. */
export async function changePassword(userId, newPassword, keepSid) {
  await userRepo.setPasswordHash(userId, await hashPassword(newPassword));
  await endOtherSessions(userId, keepSid);
}

/** Codes now go to `email`; other devices sign in again, with a code this time. */
export async function switchOnSignInCodes(userId, email, keepSid) {
  await userRepo.setOtpEmail(userId, email);
  await endOtherSessions(userId, keepSid);
}

export const switchOffSignInCodes = (userId) => userRepo.setOtpEmail(userId, null);
