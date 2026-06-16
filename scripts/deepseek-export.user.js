// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // Phase 1: Install API interceptor BEFORE page JS runs
  // ================================================================
  let capturedApiMessages = null;

  function scanForMessages(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      if (obj.length > 2 && obj[0].role && obj[0].content !== undefined && typeof obj[0].content === 'string') {
        capturedApiMessages = obj;
        return;
      }
      for (const item of obj) { scanForMessages(item); if (capturedApiMessages) return; }
    } else {
      for (const k of Object.keys(obj)) {
        if (capturedApiMessages) return;
        scanForMessages(obj[k]);
      }
    }
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return origFetch(input, init).then(function (response) {
      if (response.ok && !capturedApiMessages) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/chat/') !== -1 || url.indexOf('/session') !== -1 || url.indexOf('/message') !== -1 || url.indexOf('/conversation') !== -1 || url.indexOf('/history') !== -1) {
          response.clone().json().then(function (data) { scanForMessages(data); }).catch(function () {});
        }
      }
      return response;
    }).catch(function (e) { throw e; });
  };

  // ================================================================
  // Phase 2: UI & Export logic (runs when DOM is ready)
  // ================================================================
  function initUI() {
    // === Selectors ===
    var SEL = {
      chatContainer: '.ds-virtual-list-visible-items',
      userMessage: '._9663006',
      userContent: '.fbb737a4',
      aiMessage: '._4f9bf79',
      thinkTime: '._5255ff8._4d41763',
      thinkChain: '.e1675d8b',
      answerMain: '.ds-markdown',
    };

    // === Helpers ===
    function cleanText(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

    function unescape(s) {
      return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
    }

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

    function getChatTitle() {
      var m = window.location.href.match(/\/s\/([a-z0-9]+)/);
      return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
    }

    // === React fiber helpers ===
    function navigateFiber(element, path) {
      if (!element || !path) return null;
      var key = Object.keys(element).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
      if (!key) return null;
      var fiber = element[key];
      var steps = path.replace(/^\$0\.?/, '').split('.');
      for (var si = 0; si < steps.length; si++) { if (!steps[si]) continue; fiber = fiber ? fiber[steps[si]] : null; if (!fiber) return null; }
      return fiber;
    }

    function extractAIMarkdown(answerEl) {
      if (!answerEl) return null;
      for (var pi = 0; pi < 3; pi++) {
        var path = ['$0.return.return.return', '$0.return.return', '$0.return.return.return.return'][pi];
        try { var f = navigateFiber(answerEl, path); if (f && f.memoizedProps && f.memoizedProps.markdown) return f.memoizedProps.markdown; } catch (e) {}
      }
      try {
        var key = Object.keys(answerEl).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
        if (key) { var f = answerEl[key]; for (var fi = 0; fi < 25; fi++) { if (!f) break; if (f.memoizedProps && f.memoizedProps.markdown) return f.memoizedProps.markdown; f = f.return; } }
      } catch (e) {}
      return null;
    }

    function extractAIThinking(thinkEl) {
      if (!thinkEl) return null;
      for (var pi = 0; pi < 3; pi++) {
        var path = ['$0.child.child.child.return.return.return.return.return.return.return', '$0.return.return.return.return', '$0.return.return.return'][pi];
        try { var f = navigateFiber(thinkEl, path); if (f && f.memoizedProps && f.memoizedProps.content) return f.memoizedProps.content; } catch (e) {}
      }
      try {
        var inner = thinkEl.querySelector('div.ds-markdown');
        if (inner) {
          var key = Object.keys(inner).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
          if (key) { var f = inner[key]; for (var fi = 0; fi < 25; fi++) { if (!f) break; if (f.memoizedProps && f.memoizedProps.content) return f.memoizedProps.content; f = f.return; } }
        }
      } catch (e) {}
      return null;
    }

    function findChatDataViaReact() {
      try {
        var msgEl = document.querySelector(SEL.aiMessage) || document.querySelector(SEL.userMessage);
        if (msgEl) {
          var key = Object.keys(msgEl).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
          if (key) {
            var fiber = msgEl[key];
            for (var fi = 0; fi < 30; fi++) {
              if (!fiber) break;
              if (fiber.memoizedState) {
                var chain = fiber.memoizedState;
                while (chain) {
                  var val = chain.memoizedState;
                  if (Array.isArray(val) && val.length > 1 && val[0] && val[0].role && val[0].content !== undefined) return val;
                  if (val && typeof val === 'object' && !Array.isArray(val)) { for (var k of Object.keys(val)) { var v = val[k]; if (Array.isArray(v) && v.length > 1 && v[0] && v[0].role && v[0].content !== undefined) return v; } }
                  chain = chain.next;
                }
              }
              if (fiber.stateNode && fiber.stateNode.state) { for (var sk of Object.keys(fiber.stateNode.state)) { var sv = fiber.stateNode.state[sk]; if (Array.isArray(sv) && sv.length > 1 && sv[0] && sv[0].role && sv[0].content !== undefined) return sv; } }
              fiber = fiber.return;
            }
          }
        }
      } catch (e) {}
      try {
        var root = document.getElementById('root');
        if (!root) return null;
        var fk = Object.keys(root).find(function (k) { return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0; });
        if (!fk) return null;
        function scan(fiber, depth) {
          if (!fiber || depth > 40) return null;
          if (fiber.memoizedState) { var c = fiber.memoizedState; while (c) { var v = c.memoizedState; if (Array.isArray(v) && v.length > 1) { if (v[0] && v[0].content !== undefined && (v[0].role === 'user' || v[0].role === 'assistant')) return v; } if (v && typeof v === 'object' && !Array.isArray(v)) { for (var k of Object.keys(v)) { var iv = v[k]; if (Array.isArray(iv) && iv.length > 1 && iv[0] && iv[0].role && iv[0].content !== undefined) return iv; } } c = c.next; } }
          return scan(fiber.child, depth + 1) || scan(fiber.sibling, depth + 1);
        }
        return scan(root[fk], 0);
      } catch (e) {}
      return null;
    }

    // === Find answer element (first .ds-markdown NOT inside thinking chain) ===
    function findAnswerEl(node) {
      var all = node.querySelectorAll(SEL.answerMain);
      for (var i = 0; i < all.length; i++) { if (!all[i].closest(SEL.thinkChain)) return all[i]; }
      return null;
    }

    // === Collect messages from current DOM ===
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
          var msg = { role: 'assistant', content: '', thinkingText: '', thinkingMd: '' };
          var te = item.el.querySelector(SEL.thinkTime);
          if (te) msg.thinkingText = cleanText(te);
          var tke = item.el.querySelector(SEL.thinkChain);
          if (tke) { var rt = extractAIThinking(tke); msg.thinkingMd = rt || htmlToMd(tke.innerHTML); }
          var ae = findAnswerEl(item.el);
          if (ae) { var rm = extractAIMarkdown(ae); msg.content = rm || htmlToMd(ae.innerHTML); }
          if (msg.content || msg.thinkingMd) msgs.push(msg);
        }
      }
      return msgs;
    }

    // === Get ordered messages (async, multiple strategies) ===
    function getOrderedMessages() {
      return new Promise(function (resolve) {
        // Strategy 1: Use API-captured data (most reliable)
        if (capturedApiMessages && capturedApiMessages.length > 2) {
          var msgs = capturedApiMessages.map(function (m) {
            if (m.role === 'user') return { role: 'user', content: m.content };
            return { role: 'assistant', content: m.content || '', thinkingText: '', thinkingMd: '' };
          });
          resolve(msgs); return;
        }

        // Strategy 2: Collect from DOM (fast if all items loaded)
        try {
          var fromDom = collectFromDOM();
          if (fromDom.length > 2) { resolve(fromDom); return; }
        } catch (e) {}

        // Strategy 3: React fiber tree extraction
        try {
          var fromReact = findChatDataViaReact();
          if (fromReact && fromReact.length > 2) {
            var frmsgs = fromReact.map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', content: m.content || '', thinkingText: '', thinkingMd: '' }; });
            resolve(frmsgs); return;
          }
        } catch (e) {}

        // Strategy 4: Scroll the virtual list to load all items, then collect
        var scrollContainer = findScrollContainer();
        if (!scrollContainer) { resolve([]); return; }
        doScrollLoad(scrollContainer, resolve);
      });
    }

    function findScrollContainer() {
      var area = document.querySelector('.ds-scroll-area--enabled, .ds-scroll-area');
      if (area && area.scrollHeight > area.clientHeight + 2) return area;
      var visible = document.querySelector(SEL.chatContainer);
      if (!visible) return null;
      var el = visible.parentElement;
      while (el) {
        var s = getComputedStyle(el);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'auto' || s.overflow === 'scroll' || el.scrollHeight > el.clientHeight + 2) return el;
        el = el.parentElement;
      }
      return visible.parentElement;
    }

    function doScrollLoad(sc, resolve) {
      var allMsgs = new Map();
      var savedPos = sc.scrollTop;
      var done = false;

      function finish(msgs) {
        if (done) return;
        done = true;
        clearInterval(timer);
        sc.scrollTop = savedPos;
        if (msgs) { resolve(msgs); return; }
        resolve(Array.from(allMsgs.values()));
      }

      setTimeout(finish, 30000);
      var step = Math.max(sc.clientHeight * 0.6, 100);
      var prevPos = -1;
      var stuck = 0;

      function tick() {
        try {
          if (done) return;

          // Collect at current position
          try {
            var fromDom = collectFromDOM();
            for (var i = 0; i < fromDom.length; i++) {
              var m = fromDom[i]; var k = m.role + '::' + m.content.slice(0, 300);
              if (!allMsgs.has(k)) allMsgs.set(k, m);
            }
          } catch (e) {}

          var cur = sc.scrollTop;
          sc.scrollTop = Math.max(0, cur - step);

          if (sc.scrollTop === prevPos) { stuck++; } else { stuck = 0; }
          prevPos = sc.scrollTop;

          if (sc.scrollTop <= 0 || stuck > 3) {
            collectFromDOM().forEach(function (m) { var k = m.role + '::' + m.content.slice(0, 300); allMsgs.set(k, m); });
            finish();
            return;
          }
        } catch (e) { finish(); }
      }

      sc.scrollTop = sc.scrollHeight;
      var timer = setInterval(tick, 300);
    }

    // === Generate markdown ===
    function generateMd() {
      return getOrderedMessages().then(function (messages) {
        var md = '# ' + getChatTitle() + '\nSource: ' + window.location.href + '\n\n';
        for (var i = 0; i < messages.length; i++) {
          var msg = messages[i];
          if (msg.role === 'user') {
            md += '## User\n\n' + msg.content + '\n\n---\n\n';
          } else {
            md += '## Assistant\n\n';
            if (msg.thinkingText) md += '_' + msg.thinkingText + '_\n\n';
            if (msg.thinkingMd) md += '> ' + msg.thinkingMd.replace(/\n/g, '\n> ') + '\n\n';
            md += msg.content + '\n\n---\n\n';
          }
        }
        return md;
      });
    }

    // === Save ===
    function saveMd(md) {
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      var name = 'deepseek_' + ts + '.md';
      var path = 'kb/raw/deepseek/' + name;

      return fetch('https://127.0.0.1:27124/vault/' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer YOUR_OBSIDIAN_TOKEN_HERE', 'Content-Type': 'text/markdown' },
        body: md,
      }).then(function (r) { if (r.ok) return 'Saved to ' + path; throw new Error(); }).catch(function () {
        try { navigator.clipboard.writeText(md); } catch (e) {}
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        return 'Obsidian offline - downloaded instead';
      });
    }

    // === Button ===
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
        generateMd().then(function (md) {
          var count = (md.match(/^## /gm) || []).length;
          if (!count) { alert('No messages found.'); return; }
          return saveMd(md).then(function (result) { if (result) alert(result); });
        });
      });
      document.body.appendChild(btn);
    }

    // === Wait for chat container ===
    var id = setInterval(function () {
      if (document.querySelector(SEL.chatContainer)) {
        clearInterval(id);
        addButton();
      }
    }, 500);
  }

  // === Wait for DOM before launching UI ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
