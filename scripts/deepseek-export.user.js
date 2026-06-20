// ==UserScript==
// @name         DeepSeek Chat Exporter (Adapted for KB)
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  Export DeepSeek chat to structured Markdown for KB ingestion
// @author       Adapted for Obsidian KB
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ================================================================
  // Phase 1: API interceptor — accumulate ALL messages
  // ================================================================
  const apiMessagesById = new Map();
  let apiReady = false;

  const API_PATTERNS = [
    '/api/v0/share/content',
    '/api/v0/chat/',
    '/api/v1/chat/',
    '/api/conversation',
    '/api/session',
  ];

  function parseApiMessages(data) {
    if (!data || typeof data !== 'object') return;
    var bizData = null;
    try { bizData = data.data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.data.biz_data; } catch (e) {}
    if (!bizData) try { bizData = data.biz_data; } catch (e) {}
    if (!bizData || !bizData.messages) return;

    var messages = bizData.messages;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var mid = m.message_id;
      if (!mid || apiMessagesById.has(mid)) continue;

      var role = (m.role || '').toUpperCase();
      var fragments = m.fragments || [];
      var userContent = '';
      var aiContent = '';
      var thinkingParts = [];

      for (var j = 0; j < fragments.length; j++) {
        var frag = fragments[j];
        var ftype = frag.type || '';
        var content = frag.content || '';

        if (ftype === 'REQUEST') userContent = content;
        else if (ftype === 'RESPONSE') aiContent = content;
        else if (ftype === 'THINK' && content) thinkingParts.push(content);
      }

      if (role === 'USER' && userContent) {
        apiMessagesById.set(mid, {
          role: 'user',
          message_id: mid,
          content: userContent,
        });
      } else if (role === 'ASSISTANT') {
        apiMessagesById.set(mid, {
          role: 'assistant',
          message_id: mid,
          content: aiContent,
          thinkingMd: thinkingParts.join('\n\n'),
        });
      }
    }
    apiReady = true;
  }

  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    return origFetch(input, init).then(function (response) {
      if (response.ok) {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        var matched = API_PATTERNS.some(function (p) { return url.indexOf(p) !== -1; });
        if (matched) {
          response.clone().json().then(function (data) { parseApiMessages(data); }).catch(function () {});
        }
      }
      return response;
    }).catch(function (e) { throw e; });
  };

  // ================================================================
  // Phase 2: UI & Export logic (runs when DOM is ready)
  // ================================================================
  function initUI() {
    function getChatTitle() {
      var m = window.location.href.match(/\/(?:s|share)\/([a-z0-9]+)/);
      return m ? 'DeepSeek Chat (' + m[1].slice(0, 8) + ')' : 'DeepSeek Chat';
    }

    function getOrderedMessages() {
      return new Promise(function (resolve) {
        // Strategy 1: API-intercepted data (most reliable)
        if (apiMessagesById.size > 0) {
          var msgs = Array.from(apiMessagesById.values())
            .sort(function (a, b) { return (a.message_id || 0) - (b.message_id || 0); });
          resolve(msgs);
          return;
        }

        // Strategy 2: Wait a bit for API to load, then retry
        var attempts = 0;
        var checker = setInterval(function () {
          attempts++;
          if (apiMessagesById.size > 0 || attempts > 20) {
            clearInterval(checker);
            var msgs = Array.from(apiMessagesById.values())
              .sort(function (a, b) { return (a.message_id || 0) - (b.message_id || 0); });
            resolve(msgs);
          }
        }, 500);
      });
    }

    // === Markdown helpers ===
    function unescape(s) {
      return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/');
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
        getOrderedMessages().then(function (messages) {
          if (!messages.length) { alert('No messages found.'); return; }
          var md = generateMd(messages);
          return saveMd(md).then(function (result) { if (result) alert(result); });
        });
      });
      document.body.appendChild(btn);
    }

    // === Wait for chat container or API data ===
    var id = setInterval(function () {
      if (document.querySelector('.ds-virtual-list-visible-items') || apiReady) {
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
