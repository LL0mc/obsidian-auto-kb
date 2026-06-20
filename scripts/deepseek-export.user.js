// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      3.2.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // Phase 1: API interceptor (best-effort)
  // ================================================================
  const apiMessagesById = new Map();

  const API_PATTERNS = [
    '/api/v0/share/content',
    '/api/v0/chat/',
    '/api/v1/chat/',
  ];

  function parseApiMessages(data) {
    if (!data || typeof data !== 'object') return false;
    var bizData = null;
    try { bizData = data.data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.biz_data; } catch (e) {}
    if (!bizData || !bizData.messages) return false;

    var messages = bizData.messages;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var mid = m.message_id;
      if (!mid || apiMessagesById.has(mid)) continue;

      var role = (m.role || '').toUpperCase();
      var fragments = m.fragments || [];
      var userContent = '', aiContent = '', thinkingParts = [];

      for (var j = 0; j < fragments.length; j++) {
        var frag = fragments[j];
        var ftype = frag.type || '';
        var content = frag.content || '';
        if (ftype === 'REQUEST') userContent = content;
        else if (ftype === 'RESPONSE') aiContent = content;
        else if (ftype === 'THINK' && content) thinkingParts.push(content);
      }

      if (role === 'USER' && userContent) {
        apiMessagesById.set(mid, { role: 'user', message_id: mid, content: userContent });
      } else if (role === 'ASSISTANT') {
        apiMessagesById.set(mid, {
          role: 'assistant', message_id: mid, content: aiContent,
          thinkingMd: thinkingParts.join('\n\n'),
        });
      }
    }
    return true;
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
  // Phase 2: React fiber extraction (reliable fallback)
  // ================================================================
  function findMessagesViaReact() {
    try {
      var root = document.getElementById('root');
      if (!root) return null;
      var fk = Object.keys(root).find(function (k) {
        return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0;
      });
      if (!fk) return null;

      function isMessageArray(arr) {
        if (!Array.isArray(arr) || arr.length < 2) return false;
        var first = arr[0];
        if (!first || typeof first !== 'object') return false;
        // Check for DeepSeek API structure: {role, fragments/message_id}
        if (first.role && (first.fragments || first.message_id)) return true;
        // Check for simple structure: {role, content}
        if (first.role && first.content !== undefined && typeof first.content === 'string') return true;
        return false;
      }

      function scanFiberState(state) {
        if (!state) return null;
        var chain = state;
        while (chain) {
          var val = chain.memoizedState;
          if (isMessageArray(val)) return val;
          // Check objects inside memoizedState
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            for (var k of Object.keys(val)) {
              var v = val[k];
              if (isMessageArray(v)) return v;
            }
          }
          chain = chain.next;
        }
        return null;
      }

      function scan(node, depth) {
        if (!node || depth > 50) return null;
        // Check memoizedState linked list
        if (node.memoizedState) {
          var result = scanFiberState(node.memoizedState);
          if (result) return result;
        }
        // Check stateNode.state (class components)
        if (node.stateNode && node.stateNode.state) {
          for (var sk of Object.keys(node.stateNode.state)) {
            var sv = node.stateNode.state[sk];
            if (isMessageArray(sv)) return sv;
          }
        }
        // Check memoizedProps
        if (node.memoizedProps) {
          var props = node.memoizedProps;
          for (var pk of Object.keys(props)) {
            var pv = props[pk];
            if (isMessageArray(pv)) return pv;
          }
        }
        return scan(node.child, depth + 1) || scan(node.sibling, depth + 1);
      }

      return scan(root[fk], 0);
    } catch (e) {
      return null;
    }
  }

  // ================================================================
  // Phase 3: DOM extraction (last resort)
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

  // ================================================================
  // Phase 4: Unified message getter
  // ================================================================
  function normalizeApiMessage(m) {
    if (m.fragments) {
      // API format: extract from fragments
      var userContent = '', aiContent = '', thinkingParts = [];
      for (var j = 0; j < m.fragments.length; j++) {
        var frag = m.fragments[j];
        var ftype = frag.type || '';
        var content = frag.content || '';
        if (ftype === 'REQUEST') userContent = content;
        else if (ftype === 'RESPONSE') aiContent = content;
        else if (ftype === 'THINK' && content) thinkingParts.push(content);
      }
      var role = (m.role || '').toUpperCase();
      if (role === 'USER') return { role: 'user', content: userContent };
      if (role === 'ASSISTANT') return {
        role: 'assistant', content: aiContent,
        thinkingMd: thinkingParts.join('\n\n'),
      };
    }
    // Simple format: {role, content}
    if (m.role && m.content !== undefined) {
      return {
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content || '',
        thinkingMd: m.thinkingMd || '',
      };
    }
    return null;
  }

  function getOrderedMessages() {
    return new Promise(function (resolve) {
      // Strategy 1: API intercepted
      if (apiMessagesById.size > 0) {
        var msgs = Array.from(apiMessagesById.values())
          .sort(function (a, b) { return (a.message_id || 0) - (b.message_id || 0); })
          .map(normalizeApiMessage).filter(Boolean);
        if (msgs.length > 0) { resolve({ msgs: msgs, source: 'API' }); return; }
      }

      // Strategy 2: React fiber (wait up to 15s)
      var attempts = 0;
      var checker = setInterval(function () {
        attempts++;
        var reactMsgs = findMessagesViaReact();
        if (reactMsgs && reactMsgs.length > 0) {
          clearInterval(checker);
          var normalized = reactMsgs.map(normalizeApiMessage).filter(Boolean);
          if (normalized.length > 0) { resolve({ msgs: normalized, source: 'React' }); return; }
        }
        // Strategy 3: API data arrived
        if (apiMessagesById.size > 0) {
          clearInterval(checker);
          var msgs = Array.from(apiMessagesById.values())
            .sort(function (a, b) { return (a.message_id || 0) - (b.message_id || 0); })
            .map(normalizeApiMessage).filter(Boolean);
          resolve({ msgs: msgs, source: 'API' });
          return;
        }
        if (attempts > 30) {
          clearInterval(checker);
          // Strategy 4: DOM fallback
          resolve({ msgs: collectFromDOM(), source: 'DOM' });
        }
      }, 500);
    });
  }

  // ================================================================
  // Phase 5: UI
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
