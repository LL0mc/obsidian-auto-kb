// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      4.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // React fiber extraction — full tree scan for messages array
  // ================================================================
  function findMessagesViaReact() {
    try {
      // Find any element with a React fiber key
      var chatContainer = document.querySelector('.ds-virtual-list-visible-items');
      var scanRoot = chatContainer || document.querySelector('[class*="chat"]') || document.getElementById('root');
      if (!scanRoot) return null;

      var fk = Object.keys(scanRoot).find(function (k) { return k.indexOf('__reactFiber$') === 0; });
      if (!fk) return null;

      function hasMessages(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.messages && Array.isArray(obj.messages) && obj.messages.length > 2) {
          var first = obj.messages[0];
          if (first && first.role && (first.fragments || first.content !== undefined)) {
            return obj.messages;
          }
        }
        return null;
      }

      // Walk up from the chat container
      var f = scanRoot[fk];
      for (var i = 0; i < 30; i++) {
        if (!f) break;
        if (f.memoizedState) {
          var chain = f.memoizedState;
          var idx = 0;
          while (chain && idx < 20) {
            var val = chain.memoizedState;
            var found = hasMessages(val);
            if (found) return found;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              for (var k of Object.keys(val)) {
                found = hasMessages(val[k]);
                if (found) return found;
              }
            }
            chain = chain.next;
            idx++;
          }
        }
        f = f.return;
      }

      // Full tree scan as fallback
      function scan(node, depth) {
        if (!node || depth > 50) return null;
        if (node.memoizedState) {
          var chain = node.memoizedState;
          var idx = 0;
          while (chain && idx < 20) {
            var val = chain.memoizedState;
            var found = hasMessages(val);
            if (found) return found;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
              for (var k of Object.keys(val)) {
                found = hasMessages(val[k]);
                if (found) return found;
              }
            }
            chain = chain.next;
            idx++;
          }
        }
        return scan(node.child, depth + 1) || scan(node.sibling, depth + 1);
      }

      return scan(scanRoot[fk], 0);
    } catch (e) {}
    return null;
  }

  // ================================================================
  // API interceptor (best-effort backup)
  // ================================================================
  var apiMessagesById = new Map();
  var API_PATTERNS = ['/api/v0/share/content', '/api/v0/chat/', '/api/v1/chat/'];

  function parseApiMessages(data) {
    if (!data || typeof data !== 'object') return;
    var bizData = null;
    try { bizData = data.data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data.biz_data; } catch (e) {}
    if (!bizData || !bizData.messages) return;

    for (var i = 0; i < bizData.messages.length; i++) {
      var m = bizData.messages[i];
      var mid = m.message_id;
      if (!mid || apiMessagesById.has(mid)) continue;
      var role = (m.role || '').toUpperCase();
      var fragments = m.fragments || [];
      var userContent = '', aiContent = '', thinkingParts = [];
      for (var j = 0; j < fragments.length; j++) {
        var frag = fragments[j];
        if (frag.type === 'REQUEST') userContent = frag.content || '';
        else if (frag.type === 'RESPONSE') aiContent = frag.content || '';
        else if (frag.type === 'THINK' && frag.content) thinkingParts.push(frag.content);
      }
      if (role === 'USER' && userContent) apiMessagesById.set(mid, { role: 'user', content: userContent });
      else if (role === 'ASSISTANT') apiMessagesById.set(mid, { role: 'assistant', content: aiContent, thinkingMd: thinkingParts.join('\n\n') });
    }
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return origFetch(input, init).then(function (response) {
      if (response.ok) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (API_PATTERNS.some(function (p) { return url.indexOf(p) !== -1; })) {
          response.clone().json().then(function (data) { parseApiMessages(data); }).catch(function () {});
        }
      }
      return response;
    }).catch(function (e) { throw e; });
  };

  // ================================================================
  // Normalize messages from either source
  // ================================================================
  function normalizeMessages(rawMsgs, source) {
    // React fiber format: {id, role, fragments: [{type, content}]}
    if (rawMsgs.length > 0 && rawMsgs[0].fragments) {
      return rawMsgs.map(function (m) {
        var fragments = m.fragments || [];
        var content = '', thinkingParts = [];
        for (var j = 0; j < fragments.length; j++) {
          var frag = fragments[j];
          if (frag.type === 'REQUEST') content = frag.content || '';
          else if (frag.type === 'RESPONSE') content = frag.content || '';
          else if (frag.type === 'THINK' && frag.content) thinkingParts.push(frag.content);
        }
        var role = (m.role || '').toUpperCase() === 'USER' ? 'user' : 'assistant';
        return { role: role, content: content, thinkingMd: thinkingParts.join('\n\n') };
      });
    }
    // Already normalized
    return rawMsgs;
  }

  function getOrderedMessages() {
    return new Promise(function (resolve) {
      // Strategy 1: React fiber (most reliable for share pages)
      var reactMsgs = findMessagesViaReact();
      if (reactMsgs && reactMsgs.length > 0) {
        resolve({ msgs: normalizeMessages(reactMsgs, 'React'), source: 'React' });
        return;
      }

      // Strategy 2: API intercepted
      if (apiMessagesById.size > 0) {
        var msgs = Array.from(apiMessagesById.values()).sort(function (a, b) { return (a.message_id || 0) - (b.message_id || 0); });
        resolve({ msgs: msgs, source: 'API' });
        return;
      }

      // Strategy 3: Wait and retry
      var attempts = 0;
      var checker = setInterval(function () {
        attempts++;
        var rm = findMessagesViaReact();
        if (rm && rm.length > 0) {
          clearInterval(checker);
          resolve({ msgs: normalizeMessages(rm, 'React'), source: 'React' });
        } else if (apiMessagesById.size > 0) {
          clearInterval(checker);
          var msgs = Array.from(apiMessagesById.values()).sort(function (a, b) { return (a.message_id || 0) - (b.message_id || 0); });
          resolve({ msgs: msgs, source: 'API' });
        } else if (attempts > 20) {
          clearInterval(checker);
          resolve({ msgs: [], source: 'none' });
        }
      }, 500);
    });
  }

  // ================================================================
  // UI
  // ================================================================
  function initUI() {
    function getChatTitle() {
      var m = window.location.href.match(/\/(?:s|share)\/([a-z0-9]+)/);
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
        return 'Obsidian offline - downloaded instead';
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
        getOrderedMessages().then(function (result) {
          btn.textContent = 'Export';
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
      if (document.querySelector('.ds-virtual-list-visible-items')) {
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
