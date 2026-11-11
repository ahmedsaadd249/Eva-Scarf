import { Router } from 'express';
import * as account from '../controllers/account.js';
import * as ownerLogin from '../controllers/owner-login.js';
import { customersOnly, requireUser } from '../middlewares/auth.js';
import { authLimiter, ownerLoginLimiter } from '../middlewares/rate-limit.js';

const router = Router();

// Every /account page needs a signed-in user except these, so a page added later is private by default.
const PUBLIC_ACCOUNT_PAGES = /^\/(login|code\/(send|verify|change)|register|forgot|reset\/[^/]+|logout)\/?$/;
router.use('/account', (req, res, next) => (PUBLIC_ACCOUNT_PAGES.test(req.path) ? next() : requireUser(req, res, next)));

router.get('/account', requireUser, account.home);

// Customers: sign in with a code sent by email (also used by checkout).
router.get('/account/login', account.loginPage);
router.post('/account/code/send', authLimiter, account.sendCode);
router.post('/account/code/verify', authLimiter, account.verifyCode);
router.post('/account/code/change', account.changeEmail);
router.post('/account/logout', account.logout);

// Pages from the time customers had passwords: old links (and emails) lead to the sign-in page.
for (const old of ['/account/register', '/account/forgot', '/account/reset/:token']) {
  router.all(old, (req, res) => res.redirect(301, '/account/login'));
}
router.all('/account/password', (req, res) => res.redirect(301, '/account/profile'));

router.get('/account/profile', requireUser, customersOnly, account.profile);
router.post('/account/profile', requireUser, customersOnly, account.saveProfileForm);
router.get('/account/orders', requireUser, customersOnly, account.orders);
router.get('/account/orders/:no', requireUser, account.order);

// The store owner: email + password, then (when switched on) a code by email.
router.get('/admin/login', ownerLogin.showLogin);
router.post('/admin/login', authLimiter, ownerLoginLimiter, ownerLogin.login);
router.get('/admin/login/code', ownerLogin.codePage);
router.post('/admin/login/code', authLimiter, ownerLogin.verifyCode);
router.post('/admin/login/code/resend', authLimiter, ownerLogin.resendCode);

export default router;
