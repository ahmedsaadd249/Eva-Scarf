/** Render a dashboard page (views/admin/<view>) inside the dashboard layout. */
export const adminPage = (res, view, locals = {}) => res.page(`admin/${view}`, { layout: 'layouts/admin', ...locals });
