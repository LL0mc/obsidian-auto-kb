// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      2.6.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  var OBSIDIAN_API = 'https://127.0.0.1:27124';
  var OBSIDIAN_TOKEN = 'YOUR_OBSIDIAN_TOKEN_HERE';

  var SEL = {
    chatContainer: '.ds-virtual-list-visible-items',
    userMessage:   '._9663006',
    userContent:   '.fbb737a4',
    aiMessage:     '._4f9bf79',
    thinkTime:     '._5255ff8._4d41763',
    thinkChain:    '.e1675d8b',
    answerMain:    '.ds-assistant-message-main-content',
    answerMarkdown: '.ds-markdown',
  };

  function htmlToMd(html) {
    if (!html) return '';
    var md = html;
    md = md.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, function (_, c) { return '\n```\n' + unescape(c) + '\n```\n'; });
    for (var i = 1; i <= 4; i++) { var p = '#'.repeat(i); md = md.replace(new RegExp('<h' + i + '[^>]*>', 'gi'), '\n' + p + ' '); md = md.replace(new RegExp('</h' + i + '>', 'gi'), '\n'); }
    md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**').replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*').replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
    var oi = 0; md = md.replace(/<ol[^>]*>/gi, function () { oi = 1; return '\n'; }).replace(/<\/ol>/gi, function () { oi = 0; return '\n'; });
    md = md.replace(/<li[^>]*>/gi, function () { return oi > 0 ? '\n' + oi++ + '. ' : '\n- '; }).replace(/<\/li>/gi, '');
    md = md.replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    md = md.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`').replace(/<[^>]+>/g, '');
    md = unescape(md);
    md = md.replace(/\n{4,}/g, '\n\n\n').replace(/[ \t]+$/gm, '').trim();
    return md;
  }

  function unescape(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
  }

  function getChatTitle() {
    var m = window.location.href.match(/\/s\/([a-z0-9-]+)/);
    return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
  }

  function cleanText(el) {
    if (!el) return '';
    return el.textContent.replace(/\s+/g, ' ').trim();
  }

  function getOrderedMessages() {
    var messages = [];
    var container = document.querySelector(SEL.chatContainer);
    if (!container) return messages;

    for (var ci = 0; ci < container.children.length; ci++) {
      var child = container.children[ci];

      // User message
      if (child.classList.contains(SEL.userMessage.slice(1))) {
        var textEl = child.querySelector(SEL.userContent);
        if (textEl && textEl.textContent.trim()) {
          messages.push({ role: 'user', content: textEl.textContent.trim() });
          continue;
        }
      }

      // AI message
      if (child.classList.contains(SEL.aiMessage.slice(1))) {
        var msg = { role: 'assistant', content: '', thinkingText: '', thinkingMd: '' };

        var timeEl = child.querySelector(SEL.thinkTime);
        if (timeEl) msg.thinkingText = cleanText(timeEl);

        var thinkEl = child.querySelector(SEL.thinkChain);
        if (thinkEl) msg.thinkingMd = htmlToMd(thinkEl.innerHTML);

        // Try main content wrapper first, then fall back to markdown
        var answerEl = child.querySelector(SEL.answerMain);
        if (answerEl) {
          msg.content = htmlToMd(answerEl.innerHTML);
        } else {
          // Fallback: first .ds-markdown NOT inside thinking chain
          var allMd = child.querySelectorAll(SEL.answerMarkdown);
          for (var mi = 0; mi < allMd.length; mi++) {
            if (!allMd[mi].closest(SEL.thinkChain)) {
              msg.content = htmlToMd(allMd[mi].innerHTML);
              break;
            }
          }
        }

        if (msg.content || msg.thinkingMd) messages.push(msg);
      }
    }

    return messages;
  }

  function generateMd() {
    var title = getChatTitle();
    var url = window.location.href;
    var messages = getOrderedMessages();

    var md = '# ' + title + '\nSource: ' + url + '\n\n';

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.role === 'user') {
        md += '## User\n\n' + msg.content + '\n\n---\n\n';
      } else {
        md += '## Assistant\n\n';
        if (msg.thinkingText) md += '_' + msg.thinkingText + '_\n\n';
        if (msg.thinkingMd) {
          md += '> ' + msg.thinkingMd.replace(/\n/g, '\n> ') + '\n\n';
        }
        md += msg.content + '\n\n---\n\n';
      }
    }

    return md;
  }

  function saveMd(md) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var name = 'deepseek_' + ts + '.md';
    var path = 'kb/raw/deepseek/' + name;

    return fetch(OBSIDIAN_API + '/vault/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + OBSIDIAN_TOKEN, 'Content-Type': 'text/markdown' },
      body: md,
    }).then(function (r) {
      if (r.ok) return 'Saved to ' + path;
      throw new Error();
    }).catch(function () {
      try { navigator.clipboard.writeText(md); } catch (e) {}
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      return 'Obsidian offline - downloaded instead';
    });
  }

  function addButton() {
    if (document.getElementById('ds-export-btn')) return;
    var btn = document.createElement('div');
    btn.id = 'ds-export-btn';
    btn.textContent = 'Export';
    Object.assign(btn.style, {
      position: 'fixed', left: '16px', bottom: '100px', zIndex: 999999,
      padding: '8px 14px', background: '#3964fe', color: '#fff', border: 'none',
      borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)', userSelect: 'none', lineHeight: '1',
    });
    btn.addEventListener('mouseenter', function () { btn.style.background = '#2851e0'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = '#3964fe'; });
    btn.addEventListener('click', function () {
      var md = generateMd();
      var count = (md.match(/^## /gm) || []).length;
      if (!count) { alert('No messages found.'); return; }
      saveMd(md).then(function (result) { if (result) alert(result + ' (' + count + ' msgs)'); });
    });
    document.body.appendChild(btn);
  }

  var id = setInterval(function () {
    if (document.querySelector(SEL.chatContainer)) {
      clearInterval(id);
      addButton();
    }
  }, 500);

})();
