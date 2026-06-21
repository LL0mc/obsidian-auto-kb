// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      5.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  var SEL = {
    chatContainer: '.ds-virtual-list-visible-items',
    userMessage: '._9663006',
    userContent: '.fbb737a4',
    aiMessage: '._4f9bf79',
    thinkChain: '.e1675d8b',
    answerMain: '.ds-markdown',
  };

  function collectFromDOM() {
    var msgs = [];
    var userEls = document.querySelectorAll(SEL.userMessage);
    var aiEls = document.querySelectorAll(SEL.aiMessage);
    var all = [];
    userEls.forEach(function (el) { all.push({ el: el, role: 'user' }); });
    aiEls.forEach(function (el) { all.push({ el: el, role: 'assistant' }); });
    all.sort(function (a, b) {
      var p = a.el.compareDocumentPosition(b.el);
      return (p & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : (p & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : 0;
    });
    for (var i = 0; i < all.length; i++) {
      var item = all[i];
      if (item.role === 'user') {
        var ce = item.el.querySelector(SEL.userContent);
        if (ce && ce.textContent.trim()) msgs.push({ role: 'user', content: ce.textContent.trim() });
      } else {
        var msg = { role: 'assistant', content: '', thinkingMd: '' };
        var tke = item.el.querySelector(SEL.thinkChain);
        if (tke) msg.thinkingMd = tke.textContent.replace(/\s+/g, ' ').trim();
        var allMd = item.el.querySelectorAll(SEL.answerMain);
        for (var j = 0; j < allMd.length; j++) {
          if (!allMd[j].closest(SEL.thinkChain)) {
            msg.content = allMd[j].textContent.replace(/\s+/g, ' ').trim();
            break;
          }
        }
        if (msg.content || msg.thinkingMd) msgs.push(msg);
      }
    }
    return msgs;
  }

  function findScrollContainer() {
    var area = document.querySelector('.ds-scroll-area--enabled, .ds-scroll-area');
    if (area && area.scrollHeight > area.clientHeight + 2) return area;
    var visible = document.querySelector(SEL.chatContainer);
    if (!visible) return null;
    var el = visible.parentElement;
    while (el) {
      var s = getComputedStyle(el);
      if (s.overflowY === 'auto' || s.overflowY === 'scroll' || el.scrollHeight > el.clientHeight + 2) return el;
      el = el.parentElement;
    }
    return visible.parentElement;
  }

  // Scroll through entire conversation, collecting messages at each position
  function scrollAndCollect() {
    return new Promise(function (resolve) {
      var sc = findScrollContainer();
      if (!sc) { resolve(collectFromDOM()); return; }

      var allMsgs = new Map();
      var savedPos = sc.scrollTop;
      var done = false;

      function key(m) { return m.role + '::' + m.content.slice(0, 200); }
      function collect() {
        collectFromDOM().forEach(function (m) { allMsgs.set(key(m), m); });
      }

      function finish() {
        if (done) return;
        done = true;
        sc.scrollTop = savedPos;
        resolve(Array.from(allMsgs.values()));
      }

      // Safety timeout
      setTimeout(finish, 20000);

      var step = Math.max(sc.clientHeight * 0.5, 100);
      var prevPos = -1;
      var stuck = 0;

      // Start from bottom
      sc.scrollTop = sc.scrollHeight;

      var timer = setInterval(function () {
        try {
          collect();
          var cur = sc.scrollTop;
          sc.scrollTop = Math.max(0, cur - step);

          if (sc.scrollTop === prevPos) { stuck++; } else { stuck = 0; }
          prevPos = sc.scrollTop;

          if (sc.scrollTop <= 0 || stuck > 3) {
            collect();
            finish();
          }
        } catch (e) { finish(); }
      }, 400);
    });
  }

  function getChatTitle() {
    var m = window.location.href.match(/\/(?:s|share)\/([a-z0-9-]+)/);
    return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
  }

  function generateMd(messages) {
    var md = '# ' + getChatTitle() + '\nSource: ' + window.location.href + '\n\n';
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg.role === 'user') {
        md += '## User\n\n' + msg.content + '\n\n---\n\n';
      } else {
        md += '## Assistant\n\n';
        if (msg.thinkingMd) md += '> ' + msg.thinkingMd.replace(/\n/g, '\n> ') + '\n\n';
        md += msg.content + '\n\n---\n\n';
      }
    }
    return md;
  }

  function saveMd(md) {
    var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    var name = 'deepseek_' + ts + '.md';
    var path = 'kb/raw/deepseek/' + name;

    return fetch('https://127.0.0.1:27124/vault/' + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer YOUR_OBSIDIAN_TOKEN_HERE', 'Content-Type': 'text/markdown' },
      body: md,
    }).then(function (r) { if (r.ok) return 'Saved to ' + path; throw new Error(); }).catch(function () {
      // Download as file fallback
      try { navigator.clipboard.writeText(md); } catch (e) {}
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
      a.download = name;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
      return 'Downloaded ' + name;
    });
  }

  // === UI ===
  function initUI() {
    var btn = null;
    function addButton() {
      if (btn) return;
      btn = document.createElement('div');
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
        btn.textContent = 'Scrolling & exporting...';
        btn.style.background = '#888';
        scrollAndCollect().then(function (messages) {
          btn.textContent = 'Export';
          btn.style.background = '#3964fe';
          if (!messages.length) { alert('No messages found.'); return; }
          var md = generateMd(messages);
          return saveMd(md).then(function (r) {
            if (r) alert(r + ' (' + messages.length + ' msgs)');
          });
        });
      });
      document.body.appendChild(btn);
    }

    var id = setInterval(function () {
      if (document.querySelector(SEL.chatContainer)) {
        clearInterval(id);
        addButton();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
