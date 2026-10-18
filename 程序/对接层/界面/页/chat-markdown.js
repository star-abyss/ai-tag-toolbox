(function installChatMarkdown(root) {
  'use strict';

  const languageNames = Object.freeze({
    bash: 'Bash',
    css: 'CSS',
    html: 'HTML',
    javascript: 'JavaScript',
    js: 'JavaScript',
    json: 'JSON',
    markdown: 'Markdown',
    md: 'Markdown',
    plaintext: '纯文本',
    python: 'Python',
    sh: 'Shell',
    text: '纯文本',
    ts: 'TypeScript',
    typescript: 'TypeScript',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML'
  });

  function createRenderer() {
    const MarkdownIt = root.markdownit;
    if (typeof MarkdownIt !== 'function') throw new Error('Markdown-it 尚未加载');

    const parser = new MarkdownIt({ html: false, linkify: false, breaks: false });
    const renderFence = parser.renderer.rules.fence;
    parser.renderer.rules.fence = (tokens, index, options, env, renderer) => {
      const token = tokens[index];
      const language = String(token.info || '').trim().split(/\s+/)[0].toLowerCase();
      const label = languageNames[language] || language || '代码';
      const content = renderFence(tokens, index, options, env, renderer);
      return `<div class="agent-markdown-code"><div class="agent-markdown-code-head"><span class="agent-markdown-language">${parser.utils.escapeHtml(label)}</span><button class="agent-markdown-copy" type="button" aria-label="复制代码">复制</button></div>${content}</div>\n`;
    };
    parser.renderer.rules.table_open = () => '<div class="agent-markdown-table-scroll"><table>\n';
    parser.renderer.rules.table_close = () => '</table></div>\n';
    return parser;
  }

  const parser = createRenderer();

  function render(text, options = {}) {
    const doc = options.document || root.document;
    if (!doc) throw new Error('Markdown 渲染需要 document');

    const element = doc.createElement('div');
    element.className = `dsh-md-text agent-markdown${options.compact ? ' agent-markdown-compact' : ''}`;
    element.innerHTML = parser.render(String(text ?? ''));

    for (const button of element.querySelectorAll('.agent-markdown-copy')) {
      button.addEventListener('click', async () => {
        const code = button.closest('.agent-markdown-code')?.querySelector('pre code');
        const clipboard = doc.defaultView?.navigator?.clipboard || root.navigator?.clipboard;
        if (!code || !clipboard?.writeText) return;
        const label = button.textContent;
        try {
          await clipboard.writeText(code.textContent);
          button.textContent = '已复制';
          setTimeout(() => { button.textContent = label; }, 1200);
        } catch {
          button.textContent = '复制失败';
          setTimeout(() => { button.textContent = label; }, 1200);
        }
      });
    }

    return element;
  }

  root.ChatMarkdown = Object.freeze({ render });
})(typeof window === 'undefined' ? globalThis : window);
