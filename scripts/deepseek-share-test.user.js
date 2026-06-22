// ==UserScript==
// @name         DeepSeek Share Fallback Test
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  测试分享链接降级：创建分享 → 获取消息 → 保存到 Obsidian → 删除分享
// @match        https://chat.deepseek.com/*
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const OAPI = 'https://127.0.0.1:27124'
    const OAPI_KEY = 'YOUR_OBSIDIAN_TOKEN_HERE'

    function initUI() {
        if (document.getElementById('ds-test-panel')) return
        const panel = document.createElement('div')
        panel.id = 'ds-test-panel'
        panel.innerHTML = `
          <div id="ds-test-btn" style="position:fixed;top:10px;right:10px;z-index:99999;background:#ff6b00;color:#fff;padding:8px 16px;border-radius:8px;cursor:pointer;font:bold 13px/1 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)">🧪 Test Share</div>
          <div id="ds-test-log" style="position:fixed;top:50px;right:10px;z-index:99999;background:#1a1a2e;color:#e0e0e0;padding:12px;border-radius:8px;font:12px/1.5 monospace;min-width:300px;max-width:450px;max-height:70vh;overflow:auto;display:none"></div>`
        document.body.appendChild(panel)
        document.getElementById('ds-test-btn').onclick = runTest
    }

    function log(msg, ok) {
        const el = document.getElementById('ds-test-log')
        if (!el) return
        el.style.display = 'block'
        const c = ok === true ? '#4caf50' : ok === false ? '#f44336' : '#ffa726'
        el.innerHTML += `<div style="color:${c}">${msg}</div>`
        el.scrollTop = el.scrollHeight
    }

    async function runTest() {
        log('--- 开始测试 ---')
        const m = location.href.match(/\/chat\/s\/([a-f0-9-]+)/)
        if (!m) { log('请在私聊页面运行', false); return }
        const sessionId = m[1]
        log(`Session: ${sessionId.substring(0, 8)}...`)

        // Get message IDs from IndexedDB
        log('    Reading IndexedDB...')
        const msgIds = await new Promise((resolve) => {
            const req = indexedDB.open('deepseek-chat', 1)
            req.onsuccess = (e) => {
                const db = e.target.result
                const tx = db.transaction('history-message', 'readonly')
                const store = tx.objectStore('history-message')
                const getAll = store.getAll()
                getAll.onsuccess = () => {
                    const target = getAll.result.find(d => d.data?.chat_session?.id === sessionId)
                    db.close()
                    if (target?.data?.chat_messages) {
                        resolve(target.data.chat_messages.map(m => m.message_id))
                    } else { resolve([]) }
                }
                getAll.onerror = () => { db.close(); resolve([]) }
            }
            req.onerror = () => resolve([])
        })
        log(`    ${msgIds.length} messages: [${msgIds.slice(0, 5).join(',')}${msgIds.length > 5 ? '...' : ''}]`)

        // Step 1: Create share
        log('[1] 创建分享链接...')
        let shareId
        try {
            const r = await fetch('/api/v0/share/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ message_ids: msgIds })
            })
            const data = await r.json()
            log(`    Status: ${r.status}`)
            if (r.status !== 200 || !data.data?.share_id) {
                log(`    Failed: ${JSON.stringify(data).substring(0, 200)}`, false)
                return
            }
            shareId = data.data.share_id
            log(`    Share ID: ${shareId}`, true)
        } catch (e) { log(`    Error: ${e.message}`, false); return }

        // Step 2: Fetch messages
        log('[2] 获取消息...')
        let msgs = [], title = ''
        try {
            const r = await fetch(`/api/v0/share/content?share_id=${shareId}`, { credentials: 'include' })
            const data = await r.json()
            const bizData = data.data?.data?.biz_data
            title = bizData?.title || ''
            const raw = bizData?.messages || []
            for (const m of raw) {
                const role = (m.role || '').toUpperCase()
                const frags = m.fragments || []
                let content = '', thinking = []
                for (const f of frags) {
                    if (f.type === 'REQUEST') content = f.content || ''
                    else if (f.type === 'RESPONSE') content = f.content || ''
                    else if (f.type === 'THINK' && f.content) thinking.push(f.content)
                }
                if (role === 'USER' && content) msgs.push({ role: 'user', content })
                else if (role === 'ASSISTANT') msgs.push({ role: 'assistant', content, thinkingMd: thinking.join('\n\n') })
            }
            log(`    Title: ${title}`, true)
            log(`    Messages: ${msgs.length}`, true)
        } catch (e) { log(`    Error: ${e.message}`, false) }

        // Step 3: Save to Obsidian
        if (msgs.length) {
            log('[3] 保存到 Obsidian...')
            const safeTitle = (title || '').replace(/[\\/:*?"<>|]/g, '_').substring(0, 80)
            const fname = safeTitle ? `${safeTitle}.md` : `test_${shareId.substring(0, 8)}.md`
            const path = `kb/raw/deepseek/${fname}`

            let md = `# ${title}\nSource: https://chat.deepseek.com/share/${shareId}\n\n`
            for (const msg of msgs) {
                if (msg.role === 'user') {
                    md += `## User\n\n${msg.content}\n\n---\n\n`
                } else {
                    md += `## Assistant\n\n`
                    if (msg.thinkingMd) md += `> ${msg.thinkingMd.replace(/\n/g, '\n> ')}\n\n`
                    md += `${msg.content}\n\n---\n\n`
                }
            }

            try {
                const r = await fetch(`${OAPI}/vault/${path}`, {
                    method: 'PUT',
                    headers: { Authorization: `Bearer ${OAPI_KEY}`, 'Content-Type': 'text/markdown' },
                    body: md
                })
                if (r.ok) log(`    ✓ Saved to ${path}`, true)
                else log(`    Failed: ${r.status}`, false)
            } catch (e) {
                log(`    Obsidian 不可用: ${e.message}`, false)
                // Fallback: download
                const a = document.createElement('a')
                a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
                a.download = fname
                a.click()
                log(`    已下载 ${fname}`, true)
            }
        }

        // Step 4: Delete share
        log('[4] 删除分享链接...')
        try {
            const r = await fetch('/api/v0/share/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ share_id: shareId })
            })
            const data = await r.json()
            log(`    Status: ${r.status}`, r.status === 200)
            log(`    Response: ${JSON.stringify(data).substring(0, 150)}`)
        } catch (e) { log(`    Error: ${e.message}`, false) }

        log('--- 测试完成 ---', true)
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI)
    } else {
        initUI()
    }
})();
