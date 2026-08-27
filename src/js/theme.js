'use strict';
/* ================= 样式切换 ================= */
var theme = storageGet(LS_THEME, 'light') || 'light';
var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  const dark = theme === 'dark' || (theme === 'auto' && mq && mq.matches);
  document.body.classList.toggle('dark', !!dark);
  themePop.querySelectorAll('.popitem').forEach(it => {
    const on = it.dataset.theme === theme;
    it.querySelector('.ck').textContent = on ? '✓' : '';
  });
}
if (mq) mq.addEventListener('change', applyTheme);
themeBtn.onclick = e => { e.stopPropagation(); themePop.hidden = !themePop.hidden; };
themePop.addEventListener('click', e => {
  const it = e.target.closest('.popitem');
  if (!it) return;
  theme = it.dataset.theme;
  storageSet(LS_THEME, theme);
  applyTheme();
  themePop.hidden = true;
  toast(theme === 'dark' ? '已切换深色模式' : (theme === 'light' ? '已切换浅色模式' : '已设为跟随系统'));
});
document.addEventListener('click', e => {
  if (!e.target.closest('.popwrap') && !themePop.hidden) themePop.hidden = true;
});
