// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      6.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // Strategy 1: Call DeepSeek API directly (uses browser cookies)
  // ================================================================
  function fetchMessagesFromAPI() {
    var url = window.location.href;

    // Extract session/share ID from URL
    var shareMatch = url.match(/\/share\/([a-z0-9]+)/);
    var sessionMatch = url.match(/\/chat\/s\/([a-f0-9-]+)/);

    if (shareMatch) {
      // Share page: public API
      return fetch('/api/v0/share/content?share_id=' + shareMatch[1])
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var msgs = extractFromApiResponse(data);
          return msgs;
        });
    } else if (sessionMatch) {
      // Private page: try conversation history API
      var sid = sessionMatch[1];
      return fetch('/api/v0/chat/' + sid + '/conversation')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data) {
            var msgs = extractFromApiResponse(data);
            if (msgs && msgs.length > 0) return msgs;
          }
          // Fallback: try other API patterns
          return fetch('/api/v1/chat/' + sid)
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data2) {
              if (data2) return extractFromApiResponse(data2);
              return null;
            });
        });
    }
    return Promise.resolve(null);
  }

  function extractFromApiResponse(data) {
    if (!data || typeof data !== 'object') return null;

    // Navigate nested structure
    var bizData = null;
    try { bizData = data.data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data; } catch (e) {}

    var rawMsgs = null;
    if (bizData && bizData.messages) rawMsgs = bizData.messages;
    else if (data.data && Array.isArray(data.data)) rawMsgs = data.data;
    else if (Array.isArray(data)) rawMsgs = data;

    if (!rawMsgs || rawMsgs.length === 0) return null;

    return rawMsgs.map(function (m) {
      var role = (m.role || '').toUpperCase();
      var fragments = m.fragments || [];
      var content = '', thinkingParts = [];

      for (var j = 0; j < fragments.length; j++) {
        var frag = fragments[j];
        var ftype = frag.type || '';
        var c = frag.content || '';
        if (ftype === 'REQUEST') content = c;
        else if (ftype === 'RESPONSE') content = c;
        else if (ftype === 'THINK' && c) thinkingParts.push(c);
      }

      // Also check simple content field
      if (!content && m.content) content = m.content;

      if (role === 'USER' && content) return { role: 'user', content: content };
      if (role === 'ASSISTANT') return { role: 'assistant', content: content, thinkingMd: thinkingParts.join('\n\n') };
      return null;
    }).filter(Boolean);
  }

  // ================================================================
  // Strategy 2: React fiber scan (fallback)
  // ================================================================
  function findMessagesViaReact() {
    try {
      var root = document.getElementById('root');
      if (!root) return null;
      var fk = Object.keys(root).find(function (k) {
        return k.indexOf('__reactContainer$') === 0 || k.indexOf('__reactFiber$') === 0;
      });
      if (!fk) return null;

      function isMsgArray(arr) {
        return Array.isArray(arr) && arr.length > 2 && arr[0] && arr[0].role && (arr[0].fragments || arr[0].content !== undefined);
      }

      function scan(node, depth) {
        if (!node || depth > 60) return null;
        if (node.memoizedState) {
          var chain = node.memoizedState;
          var idx = 0;
          while (chain && idx < 30) {
            var val = chain.memoizedState;
            if (isMsgArray(val)) return val;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              for (var k of Object.keys(val)) {
                var v = val[k];
                if (isMsgArray(v)) return v;
                if (v && typeof v === 'object' && v.messages && isMsgArray(v.messages)) return v.messages;
              }
            }
            chain = chain.next;
            idx++;
          }
        }
        return scan(node.child, depth + 1) || scan(node.sibling, depth + 1);
      }
      var result = scan(root[fk], 0);
      if (result) {
        return result.map(function (m) {
          var role = (m.role || '').toUpperCase();
          var fragments = m.fragments || [];
          var content = '', thinkingParts = [];
          for (var j = 0; j < fragments.length; j++) {
            var frag = fragments[j];
            if (frag.type === 'REQUEST') content = frag.content || '';
            else if (frag.type === 'RESPONSE') content = frag.content || '';
            else if (frag.type === 'THINK' && frag.content) thinkingParts.push(frag.content);
          }
          if (!content && m.content) content = m.content;
          if (role === 'USER' && content) return { role: 'user', content: content };
          if (role === 'ASSISTANT') return { role: 'assistant', content: content, thinkingMd: thinkingParts.join('\n\n') };
          return null;
        }).filter(Boolean);
      }
    } catch (e) {}
    return null;
  }

  // ================================================================
  // Strategy 3: DOM scroll-and-collect (last resort)
  // ================================================================
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

  function scrollAndCollect() {
    return new Promise(function (resolve) {
      var area = document.querySelector('.ds-scroll-area--enabled, .ds-scroll-area');
      if (!area) { resolve(collectFromDOM()); return; }

      var allMsgs = new Map();
      var savedPos = area.scrollTop;
      var done = false;

      function key(m) { return m.role + '::' + m.content.slice(0, 200); }
      function collect() {
        collectFromDOM().forEach(function (m) { allMsgs.set(key(m), m); });
      }
      function finish() {
        if (done) return;
        done = true;
        area.scrollTop = savedPos;
        resolve(Array.from(allMsgs.values()));
      }

      setTimeout(finish, 25000);
      area.scrollTop = area.scrollHeight;
      var step = Math.max(area.clientHeight * 0.4, 80);
      var prevPos = -1;
      var stuck = 0;

      var timer = setInterval(function () {
        try {
          collect();
          area.scrollTop = Math.max(0, area.scrollTop - step);
          if (area.scrollTop === prevPos) stuck++; else stuck = 0;
          prevPos = area.scrollTop;
          if (area.scrollTop <= 0 || stuck > 4) { collect(); finish(); }
        } catch (e) { finish(); }
      }, 500);
    });
  }

  // ================================================================
  // Unified getter
  // ================================================================
  function getOrderedMessages() {
    // Try API first
    return fetchMessagesFromAPI().then(function (msgs) {
      if (msgs && msgs.length > 0) return { msgs: msgs, source: 'API' };

      // Try React fiber
      var reactMsgs = findMessagesViaReact();
      if (reactMsgs && reactMsgs.length > 0) return { msgs: reactMsgs, source: 'React' };

      // Try DOM scroll
      return scrollAndCollect().then(function (domMsgs) {
        return { msgs: domMsgs, source: 'DOM' };
      });
    }).catch(function () {
      // Fallback to React then DOM
      var reactMsgs = findMessagesViaReact();
      if (reactMsgs && reactMsgs.length > 0) return { msgs: reactMsgs, source: 'React' };
      return scrollAndCollect().then(function (domMsgs) {
        return { msgs: domMsgs, source: 'DOM' };
      });
    });
  }

  // ================================================================
  // UI
  // ================================================================
  function initUI() {
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
        try { navigator.clipboard.writeText(md); } catch (e) {}
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        return 'Downloaded ' + name;
      });
    }

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
        btn.textContent = 'Exporting...';
        btn.style.background = '#888';
        getOrderedMessages().then(function (result) {
          btn.textContent = 'Export';
          btn.style.background = '#3964fe';
          if (!result.msgs.length) { alert('No messages found.'); return; }
          var md = generateMd(result.msgs);
          return saveMd(md).then(function (r) {
            if (r) alert(r + ' (' + result.msgs.length + ' msgs via ' + result.source + ')');
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
