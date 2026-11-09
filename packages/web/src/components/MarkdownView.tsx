import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('diff', diff);

interface MarkdownViewProps {
  content: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
  const sanitizedHtml = useMemo(() => {
    if (!content) return '';

    // Configure marked renderer for code syntax highlighting
    const renderer = new marked.Renderer();
    renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
      const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      let highlighted = '';
      try {
        highlighted = hljs.highlight(text, { language: validLang }).value;
      } catch {
        highlighted = DOMPurify.sanitize(text);
      }

      return `
        <div class="code-block-container" style="position: relative; margin: 10px 0; background-color: var(--code-bg); border: 1px solid var(--border); border-radius: 6px; overflow: hidden;">
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 12px; background-color: var(--surface); border-bottom: 1px solid var(--border); font-size: 11px; color: var(--muted);">
            <span>${validLang}</span>
            <button class="copy-code-btn" data-code="${encodeURIComponent(text)}" style="padding: 2px 8px; font-size: 11px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">Copy</button>
          </div>
          <pre style="padding: 12px; margin: 0; overflow-x: auto; font-family: var(--font-mono); font-size: 13px; line-height: 1.4;"><code>${highlighted}</code></pre>
        </div>
      `;
    };

    const rawHtml = marked.parse(content, { renderer, async: false }) as string;
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'rel', 'data-code'],
    });
  }, [content]);

  // Click handler for copy code buttons
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target && target.classList.contains('copy-code-btn')) {
      const code = decodeURIComponent(target.getAttribute('data-code') || '');
      if (code) {
        navigator.clipboard.writeText(code);
        const originalText = target.innerText;
        target.innerText = 'Copied!';
        setTimeout(() => {
          target.innerText = originalText;
        }, 1500);
      }
    }
  };

  return (
    <div
      className="markdown-content"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      style={{ wordBreak: 'break-word', lineHeight: 1.6 }}
    />
  );
};
