import { overview } from '../../services/dashboard.js';
import { adminPage } from './render.js';

export async function show(req, res) {
  adminPage(res, 'overview', {
    title: res.locals.t('admin.overview'),
    otpOff: !req.user.otp_email, // a reminder to switch on the second sign-in step
    ...(await overview()),
  });
}
