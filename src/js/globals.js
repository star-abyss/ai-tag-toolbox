'use strict';
window.__errs = [];
window.addEventListener('error', e => { window.__errs.push(String((e && e.error && e.error.stack) || (e && e.message) || e)); });
'use strict';
