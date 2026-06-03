// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      1.1.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // === Current selectors (chat.deepseek.com build 4ff42630) ===
  const SEL = {
    chatContainer: '.ds-virtual-list-visible-items',
    userMessage:   '._9663006',
    userContent:   '.fbb737a4',
    aiMessage:     '._4f9bf79',
    thinkTime:     '._5255ff8._4d41763',
    thinkChain:    '.e1675d8b',
    answerMain:    '.ds-assistant-message-main-content',
  };

  // === HTML 鈫?Markdown converter (no external deps) ===
  function htmlToMd(html) {
    if (!html) return '';
    let md = html;

    // Code blocks (before inline code)
    md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_, c) =>
      '\n```\n' + unescape(c) + '\n```\n');

    // Headings
    for (let i = 1; i <= 4; i++) {
      const prefix = '#'.repeat(i);
      md = md.replace(new RegExp(`<h${i}[^>]*>`, 'gi'), `\n${prefix} `);
      md = md.replace(new RegExp(`</h${i}>`, 'gi'), '\n');
    }

    // Bold / italic
    md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');

    // Links
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

    // Horizontal rules
    md = md.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Ordered lists: track index
    let olIdx = 0;
    md = md.replace(/<ol[^>]*>/gi, () => { olIdx = 1; return '\n'; });
    md = md.replace(/<\/ol>/gi, () => { olIdx = 0; return '\n'; });
    md = md.replace(/<li[^>]*>/gi, () => {
      if (olIdx > 0) return `\n${olIdx++}. `;
      return '\n- ';
    });
    md = md.replace(/<\/li>/gi, '');

    // Paragraphs
    md = md.replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n');

    // Breaks
    md = md.replace(/<br\s*\/?>/gi, '\n');

    // Inline code
    md = md.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');

    // Strip remaining tags (span, div, etc.)
    md = md.replace(/<[^>]+>/g, '');

    // Decode entities
    md = unescape(md);

    // Clean whitespace
    md = md.replace(/\n{4,}/g, '\n\n\n');
    md = md.replace(/[ \t]+$/gm, '');
    md = md.trim();

    return md;
  }

  function unescape(s) {
    return s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
  }

  // === Get chat title ===
  function getChatTitle() {
    // First try URL session ID
    const m = window.location.href.match(/\/s\/([a-z0-9]+)/);
    if (m) return `DeepSeek Chat (${m[1].slice(0, 8)})`;
    return 'DeepSeek Chat';
  }

  // === Extract text content from an element ===
  function cleanText(el) {
    if (!el) return '';
    return el.textContent.replace(/\s+/g, ' ').trim();
  }

  // === Get ordered messages ===
  function getOrderedMessages() {
    const messages = [];
    const container = document.querySelector(SEL.chatContainer);
    if (!container) return messages;

    for (const child of container.children) {
      // User message
      if (child.className && child.classList.contains(SEL.userMessage.slice(1))) {
        const textEl = child.querySelector(SEL.userContent);
        if (textEl && textEl.textContent.trim()) {
          messages.push({ role: 'user', content: textEl.textContent.trim() });
          continue;
        }
      }

      // AI message
      if (child.className && child.classList.contains(SEL.aiMessage.slice(1))) {
        const msg = { role: 'assistant', content: '', thinkingText: '', thinkingMd: '' };

        const timeEl = child.querySelector(SEL.thinkTime);
        if (timeEl) msg.thinkingText = cleanText(timeEl);

        const thinkEl = child.querySelector(SEL.thinkChain);
        if (thinkEl) msg.thinkingMd = htmlToMd(thinkEl.innerHTML);

        const answerEl = child.querySelector(SEL.answerMain);
        if (answerEl) msg.content = htmlToMd(answerEl.innerHTML);

        if (msg.content || msg.thinkingMd) messages.push(msg);
      }
    }

    return messages;
  }

  // === Generate full markdown ===
  function generateMd() {
    const title = getChatTitle();
    const url = window.location.href;
    const messages = getOrderedMessages();

    let md = `# ${title}\nSource: ${url}\n\n`;

    for (const msg of messages) {
      if (msg.role === 'user') {
        md += `## User\n\n${msg.content}\n\n---\n\n`;
      } else {
        md += `## Assistant\n\n`;
        if (msg.thinkingText) md += `_${msg.thinkingText}_\n\n`;
        if (msg.thinkingMd) {
          md += `> ${msg.thinkingMd.replace(/\n/g, '\n> ')}\n\n`;
        }
        md += `${msg.content}\n\n---\n\n`;
      }
    }

    return md;
  }

  // === Obsidian Local REST API config ===
  const OBSIDIAN = {
    base: 'https://127.0.0.1:27124',
    token: 'YOUR_OBSIDIAN_TOKEN_HERE', // 鏀逛负浣犵殑 Obsidian Local REST API token
    dir: 'kb/raw/deepseek',
  };

  // === Save to Obsidian vault via REST API ===
  async function saveMd(md) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `deepseek_${ts}.md`;
    const path = `${OBSIDIAN.dir}/${name}`;

    // Try Obsidian Local REST API
    try {
      const res = await fetch(`${OBSIDIAN.base}/vault/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OBSIDIAN.token}`,
          'Content-Type': 'text/markdown',
        },
        body: md,
      });
      if (res.ok) return `Saved to ${path}`;
    } catch (_) { /* fall through */ }

    // Fallback: copy to clipboard + download
    try { await navigator.clipboard.writeText(md); } catch (_) { }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'Obsidian offline 鈥?downloaded instead';
  }

  // === Button (bottom-left, won't overlap native UI) ===
  let btn = null;
  function addButton() {
    if (btn) return;
    btn = document.createElement('div');
    btn.textContent = '馃摑 Export';
    Object.assign(btn.style, {
      position: 'fixed', left: '16px', bottom: '100px', zIndex: 999999,
      padding: '8px 14px', background: '#3964fe', color: '#fff',
      border: 'none', borderRadius: '8px', cursor: 'pointer',
      fontSize: '13px', fontWeight: '500',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      userSelect: 'none', lineHeight: '1',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#2851e0'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#3964fe'; });
    btn.addEventListener('click', async () => {
      const md = generateMd();
      const count = (md.match(/^## /gm) || []).length;
      if (!count) { alert('No messages found.'); return; }
      const result = await saveMd(md);
      if (result) alert(result);
    });
    document.body.appendChild(btn);
  }

  // === Init ===
  function waitForChat() {
    const id = setInterval(() => {
      if (document.querySelector(SEL.chatContainer)) {
        clearInterval(id);
        addButton();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForChat);
  } else {
    waitForChat();
  }
})();

