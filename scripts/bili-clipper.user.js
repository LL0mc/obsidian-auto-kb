// ==UserScript==
// @name         B站 → Obsidian KB 抓取器
// @namespace    https://github.com/LL0mc
// @version      1.4
// @description  在 B站视频页一键抓取标题/字幕/评论到 Obsidian KB
// @author       opencode
// @match        *://*.bilibili.com/video/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict'

    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    const OAPI = 'https://127.0.0.1:27124'
    // Token 通过 scripts/sync-token.ps1 自动同步
    const OAPI_KEY = 'YOUR_OBSIDIAN_TOKEN_HERE'
    const KB_SUBDIR = 'kb/raw/bilibili'

    /* ---- UI (re-created on SPA navigation) ---- */
    let btn = null, log = null, lastUrl = ''

    function initUI() {
        if (document.getElementById('obkb-panel')) return
        const panel = document.createElement('div')
        panel.id = 'obkb-panel'
        panel.innerHTML = `
          <div id="obkb-btn" style="position:fixed;bottom:80px;right:20px;z-index:99999;background:#00a1d6;color:#fff;padding:10px 18px;border-radius:24px;cursor:pointer;font:bold 14px/1 sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.35);user-select:none">⬇ KB</div>
          <div id="obkb-log" style="position:fixed;bottom:132px;right:20px;z-index:99999;background:#1a1a2e;color:#e0e0e0;padding:12px 16px;border-radius:10px;font:12px/1.6 monospace;min-width:280px;max-width:380px;box-shadow:0 2px 12px rgba(0,0,0,.4);display:none"></div>`
        document.body.appendChild(panel)
        btn = document.getElementById('obkb-btn')
        log = document.getElementById('obkb-log')
        btn.onclick = onFetchClick
    }

    function logMsg(m, ok) {
        if (!log) return
        log.style.display = 'block'
        const c = ok === true ? '#4caf50' : ok === false ? '#f44336' : '#ffa726'
        log.innerHTML += `<div style="color:${c}">${m}</div>`
        log.scrollTop = log.scrollHeight
    }
    function logClear() { if (log) { log.innerHTML = ''; log.style.display = 'none' } }

    /* ---- B站 Cookie: 菜单设置 ---- */
    // 点击 Tampermonkey 图标 → "设置 B站 SESSDATA"，粘贴一次永久保存
    GM_registerMenuCommand('设置 B站 SESSDATA...', () => {
        const curr = GM_getValue('bili_sess', '')
        const v = prompt('粘贴 SESSDATA 的值（F12→Application→Cookies→SESSDATA→Value）', curr)
        if (v !== null && v.trim()) { GM_setValue('bili_sess', v.trim()); alert('已保存！') }
    })
    GM_registerMenuCommand('查看 SESSDATA 状态', () => {
        const v = GM_getValue('bili_sess', '')
        alert(v ? `已设置（前20位: ${v.slice(0,20)}...）` : '未设置 — 点击上方菜单设置')
    })
    function getSessFromStorage() { return GM_getValue('bili_sess', '') }

    function safeFilename(title, bvid) {
        const clean = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim()
        return (clean.length > 50 ? clean.slice(0, 50) : clean) + '_' + bvid
    }

    async function biliFetch(url) {
        const r = await fetch(url, { credentials: 'include', headers: { Referer: 'https://www.bilibili.com/' } })
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
    }

    /* ---- Pure-JS MD5 for WBI signing ---- */
    const md5 = (function() {
        function F(x, y, z) { return (x & y) | (~x & z) }
        function G(x, y, z) { return (x & z) | (y & ~z) }
        function H(x, y, z) { return x ^ y ^ z }
        function I(x, y, z) { return y ^ (x | ~z) }
        function add32(a, b) { return (a + b) & 0xFFFFFFFF }
        function cmn(q, a, b, x, s, t) { return add32(rot(add32(add32(a, q), add32(x, t)), s), b) }
        function rot(a, n) { return (a << n) | (a >>> (32 - n)) }
        function f(a, b, c, d, x, s, t) { return cmn(F(b, c, d), a, b, x, s, t) }
        function g(a, b, c, d, x, s, t) { return cmn(G(b, c, d), a, b, x, s, t) }
        function h(a, b, c, d, x, s, t) { return cmn(H(b, c, d), a, b, x, s, t) }
        function i(a, b, c, d, x, s, t) { return cmn(I(b, c, d), a, b, x, s, t) }
        function md5cycle(x, k) {
            let a = x[0], b = x[1], c = x[2], d = x[3]
            a = f(a, b, c, d, k[0], 7, -680876936); d = f(d, a, b, c, k[1], 12, -389564586)
            c = f(c, d, a, b, k[2], 17, 606105819); b = f(b, c, d, a, k[3], 22, -1044525330)
            a = f(a, b, c, d, k[4], 7, -176418897); d = f(d, a, b, c, k[5], 12, 1200080426)
            c = f(c, d, a, b, k[6], 17, -1473231341); b = f(b, c, d, a, k[7], 22, -45705983)
            a = f(a, b, c, d, k[8], 7, 1770035416); d = f(d, a, b, c, k[9], 12, -1958414417)
            c = f(c, d, a, b, k[10], 17, -42063); b = f(b, c, d, a, k[11], 22, -1990404162)
            a = f(a, b, c, d, k[12], 7, 1804603682); d = f(d, a, b, c, k[13], 12, -40341101)
            c = f(c, d, a, b, k[14], 17, -1502002290); b = f(b, c, d, a, k[15], 22, 1236535329)
            a = g(a, b, c, d, k[1], 5, -165796510); d = g(d, a, b, c, k[6], 9, -1069501632)
            c = g(c, d, a, b, k[11], 14, 643717713); b = g(b, c, d, a, k[0], 20, -373897302)
            a = g(a, b, c, d, k[5], 5, -701558691); d = g(d, a, b, c, k[10], 9, 38016083)
            c = g(c, d, a, b, k[15], 14, -660478335); b = g(b, c, d, a, k[4], 20, -405537848)
            a = g(a, b, c, d, k[9], 5, 568446438); d = g(d, a, b, c, k[14], 9, -1019803690)
            c = g(c, d, a, b, k[3], 14, -187363961); b = g(b, c, d, a, k[8], 20, 1163531501)
            a = g(a, b, c, d, k[13], 5, -1444681467); d = g(d, a, b, c, k[2], 9, -51403784)
            c = g(c, d, a, b, k[7], 14, 1735328473); b = g(b, c, d, a, k[12], 20, -1926607734)
            a = h(a, b, c, d, k[5], 4, -378558); d = h(d, a, b, c, k[8], 11, -2022574463)
            c = h(c, d, a, b, k[11], 16, 1839030562); b = h(b, c, d, a, k[14], 23, -35309556)
            a = h(a, b, c, d, k[1], 4, -1530992060); d = h(d, a, b, c, k[4], 11, 1272893353)
            c = h(c, d, a, b, k[7], 16, -155497632); b = h(b, c, d, a, k[10], 23, -1094730640)
            a = h(a, b, c, d, k[13], 4, 681279174); d = h(d, a, b, c, k[0], 11, -358537222)
            c = h(c, d, a, b, k[3], 16, -722521979); b = h(b, c, d, a, k[6], 23, 76029189)
            a = h(a, b, c, d, k[9], 4, -640364487); d = h(d, a, b, c, k[12], 11, -421815835)
            c = h(c, d, a, b, k[2], 16, 530742520); b = h(b, c, d, a, k[15], 23, -995338651)
            a = i(a, b, c, d, k[0], 6, -198630844); d = i(d, a, b, c, k[7], 10, 1126891415)
            c = i(c, d, a, b, k[14], 15, -1416354905); b = i(b, c, d, a, k[5], 21, -57434055)
            a = i(a, b, c, d, k[12], 6, 1700485571); d = i(d, a, b, c, k[3], 10, -1894986606)
            c = i(c, d, a, b, k[10], 15, -1051523); b = i(b, c, d, a, k[1], 21, -2054922799)
            a = i(a, b, c, d, k[8], 6, 1873313359); d = i(d, a, b, c, k[15], 10, -30611744)
            c = i(c, d, a, b, k[6], 15, -1560198380); b = i(b, c, d, a, k[13], 21, 1309151649)
            a = i(a, b, c, d, k[4], 6, -145523070); d = i(d, a, b, c, k[11], 10, -1120210378)
            c = i(c, d, a, b, k[2], 15, 718787259); b = i(b, c, d, a, k[9], 21, -343485551)
            x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3])
        }
        function str2binl(s) {
            const b = []
            for (let i = 0; i < s.length * 8; i += 8) b[i >> 5] |= (s.charCodeAt(i / 8) & 255) << (i % 32)
            return b
        }
        function binl2hex(b) {
            const hex = '0123456789abcdef'; let s = ''
            for (let i = 0; i < b.length * 4; i++) s += hex[(b[i >> 2] >> ((i % 4) * 8 + 4)) & 0xF] + hex[(b[i >> 2] >> ((i % 4) * 8)) & 0xF]
            return s
        }
        function core(s) {
            const b = str2binl(s); const len = s.length * 8
            b[len >> 5] |= 0x80 << (len % 32); b[((len + 64 >>> 9) << 4) + 14] = len
            let h = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476]
            for (let i = 0; i < b.length; i += 16) md5cycle(h, b.slice(i, i + 16))
            return h
        }
        return function(s) { return binl2hex(core(unescape(encodeURIComponent(s)))) }
    })()

    /* ---- WBI signing ---- */
    const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]

    async function getWbiKeys() {
        const d = await biliFetch('https://api.bilibili.com/x/web-interface/nav')
        if (d.code !== 0 || !d.data?.wbi_img) throw new Error('WBI keys unavailable')
        const sub = d.data.wbi_img.img_url.replace(/https?:\/\/[^/]+\//, '').split('.')[0]
        const img = d.data.wbi_img.sub_url.replace(/https?:\/\/[^/]+\//, '').split('.')[0]
        return { img_key: img, sub_key: sub }
    }

    async function wbiSign(params) {
        const k = await getWbiKeys()
        const mixinKey = (() => {
            let s = ''
            for (let i = 0; i < 32; i++) s += (k.img_key + k.sub_key)[MIXIN_TAB[i]]
            return s
        })()
        const wts = Math.floor(Date.now() / 1000)
        params.wts = wts
        const q = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]).replace(/[!'()*]/g, ''))}`).join('&')
        const w_rid = md5(q + mixinKey)
        return { wts, w_rid }
    }

    /* ---- Build Markdown from raw data ---- */
    function buildMd(r) {
        const lines = ['---']
        lines.push('bvid: ' + r.bvid)
        lines.push('aid: ' + r.aid)
        lines.push('cid: ' + r.cid)
        lines.push('title: ' + JSON.stringify(r.title))
        lines.push('owner: ' + r.owner.name)
        lines.push('duration: ' + r.duration)
        lines.push('pubdate: ' + r.pubdate)
        lines.push('pages: ' + r.pages)
        lines.push('fetched_at: ' + r.fetched_at)
        if (r.subtitle) lines.push('subtitle_segments: ' + r.subtitle.segments)
        if (r.subtitle) lines.push('subtitle_lang: ' + JSON.stringify(r.subtitle.lang))
        if (r.comments) lines.push('comments: ' + r.comments.total)
        const stat = r.stat
        if (stat) lines.push('views: ' + stat.view + ' | danmaku: ' + stat.danmaku + ' | likes: ' + stat.like + ' | coins: ' + stat.coin + ' | favorite: ' + stat.favorite + ' | reply: ' + stat.reply)
        lines.push('---')
        lines.push('')
        lines.push('# ' + r.title)
        lines.push('')
        if (r.desc) {
            lines.push('## 简介')
            lines.push(r.desc)
            lines.push('')
        }
        if (r.subtitle?.list?.length) {
            lines.push('## 字幕 (' + r.subtitle.lang + ', ' + r.subtitle.segments + ' 条)')
            lines.push('')
            for (const seg of r.subtitle.list) {
                const m = Math.floor(seg.from / 60)
                const s = String(Math.floor(seg.from % 60)).padStart(2, '0')
                lines.push(m + ':' + s + ' ' + seg.text)
            }
            lines.push('')
        }
        if (r.comments?.top_hot?.length) {
            lines.push('## 热门评论')
            for (const c of r.comments.top_hot) {
                lines.push('- **' + (c.member?.uname || '匿名') + '**: ' + (c.content?.message || ''))
            }
            lines.push('')
        }
        lines.push('---')
        lines.push('_抓取于 ' + r.fetched_at + '，由 @clipper 处理_')
        return lines.join('\n')
    }

    /* ---- Main ---- */
    async function onFetchClick() {
        logClear()
        logMsg('开始抓取...')

        const bvid = location.pathname.match(/BV[A-Za-z0-9]+/)?.[0]
        if (!bvid) { logMsg('无法解析 BVID', false); return }
        logMsg(`BVID: ${bvid}`)

        try {
            // 1. Info (no WBI needed)
            logMsg('[1/3] 视频信息...')
            const info = await biliFetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
            if (info.code !== 0) { logMsg('获取视频信息失败', false); return }
            const v = info.data
            const raw = {
                bvid, aid: v.aid, cid: v.cid,
                title: v.title, desc: v.desc,
                owner: v.owner, stat: v.stat,
                pubdate: v.pubdate, duration: v.duration, pages: v.pages?.length || 1,
                subtitle: null, comments: null,
                fetched_at: new Date().toISOString()
            }
            logMsg(`✓ ${v.title}`, true)

            // 2. Subtitle
            logMsg('[2/3] 字幕...')
            const fetchSub = async (url) => {
                const r = await fetch(url, { credentials: 'include', headers: { Referer: 'https://www.bilibili.com/' } })
                if (!r.ok) throw new Error(`HTTP ${r.status}`)
                return r.json()
            }

            try {
                // Try v2 first, then wbi/v2
                let subs = null
                for (const ep of [
                    { name: 'v2', url: `https://api.bilibili.com/x/player/v2?aid=${v.aid}&cid=${v.cid}` },
                    { name: 'wbi/v2', url: `https://api.bilibili.com/x/player/wbi/v2?aid=${v.aid}&cid=${v.cid}` },
                ]) {
                    if (subs) break
                    for (let retry = 0; retry < 3; retry++) {
                        try {
                            const data = await fetchSub(ep.url)
                            const list = data?.data?.subtitle?.subtitles
                            if (list?.length) { subs = list; logMsg(`  ${ep.name}: ${list.length} 条字幕`, true); break }
                            if (retry < 2) await new Promise(r => setTimeout(r, 800))
                        } catch (e) { if (retry === 2) logMsg(`  ${ep.name}: ${e.message}`) }
                    }
                }

                if (subs?.length) {
                    const t = subs.find(x => !x.lan?.startsWith('ai-')) || subs.find(x => x.lan === 'ai-zh') || subs[0]
                    const subUrl = (t.subtitle_url || '').startsWith('//') ? 'https:' + t.subtitle_url : t.subtitle_url
                    if (subUrl) {
                        const sj = await fetch(subUrl, { headers: { Referer: 'https://www.bilibili.com/' } }).then(r => r.json())
                        if (sj?.body?.length) {
                            raw.subtitle = { segments: sj.body.length, lang: t.lan_doc, list: sj.body.map(x => ({ from: x.from, to: x.to, text: x.content })) }
                            logMsg(`✓ ${sj.body.length} 条 (${t.lan_doc})`, true)
                        }
                    }
                }
            } catch (e) { logMsg(`字幕: ${e.message}`) }

            // Fallback: load subtitle from existing file
            if (!raw.subtitle) {
                try {
                    const fname = safeFilename(v.title, bvid)
                    const existing = await fetch(`${OAPI}/vault/${KB_SUBDIR}/${fname}.md`, {
                        headers: { Authorization: `Bearer ${OAPI_KEY}` }
                    })
                    if (existing.ok) {
                        const text = await existing.text()
                        const segCount = text.match(/subtitle_segments:\s*(\d+)/)?.[1]
                        const lang = text.match(/subtitle_lang:\s*"([^"]+)"/)?.[1]
                        if (segCount && parseInt(segCount) > 0) {
                            // Extract subtitle lines
                            const lines = text.split('\n')
                            const subLines = []
                            let inSub = false
                            for (const line of lines) {
                                if (line.match(/^## 字幕/)) { inSub = true; continue }
                                if (inSub && line.match(/^\d+:\d{2} /)) {
                                    const ts = line.split(' ')[0]
                                    const parts = ts.split(':')
                                    const from = parseInt(parts[0]) * 60 + parseInt(parts[1])
                                    subLines.push({ from, to: from + 3, text: line.substring(ts.length + 1) })
                                }
                                if (inSub && line.match(/^## /)) break
                            }
                            if (subLines.length > 0) {
                                raw.subtitle = { segments: subLines.length, lang: lang || 'zh', list: subLines }
                                logMsg(`✓ ${subLines.length} 条 (从已有文件恢复)`, true)
                            }
                        }
                    }
                } catch (e) {}
            }
            if (!raw.subtitle) logMsg('字幕: 无', false)

            // 3. Comments
            logMsg('[3/3] 评论...')
            try {
                const cm = await biliFetch(`https://api.bilibili.com/x/v2/reply/main?type=1&oid=${v.aid}&pn=1&ps=8&mode=3`)
                if (cm.code === 0 && cm.data?.replies?.length) {
                    raw.comments = { total: cm.data.cursor?.all_count || 0, top_hot: cm.data.replies.slice(0, 8) }
                    logMsg(`✓ ${raw.comments.top_hot.length} 条`, true)
                }
            } catch (e) { logMsg(`评论: ${e.message}`) }
            if (!raw.comments) logMsg('评论: 无', false)

            // 4. Build Markdown and push to Obsidian
            logMsg('推送到 Obsidian...')
            const md = buildMd(raw)
            try {
                const fname = safeFilename(v.title, bvid)
                const res = await fetch(`${OAPI}/vault/${KB_SUBDIR}/${fname}.md`, {
                    method: 'PUT',
                    headers: { Authorization: `Bearer ${OAPI_KEY}`, 'Content-Type': 'text/markdown' },
                    body: md
                })
                if (res.ok) {
                    logMsg('✓ 已保存到 KB', true)
                    btn.style.background = '#4caf50'
                    setTimeout(() => { btn.style.background = '#00a1d6' }, 3000)
                } else { logMsg(`保存失败: ${res.status}`, false) }
            } catch (e) { logMsg(`推送失败: ${e.message}`, false) }
        } catch (e) { logMsg(e.message, false) }
    }

    // Init on page load
    initUI()
    lastUrl = location.href

    // SPA navigation detection: intercept pushState + popstate + polling
    const origPush = history.pushState
    history.pushState = function() { origPush.apply(this, arguments); onUrlChange() }
    window.addEventListener('popstate', onUrlChange)
    let prevUrl = location.href
    setInterval(() => {
        if (location.href !== prevUrl) { prevUrl = location.href; onUrlChange() }
    }, 800)

    function onUrlChange() {
        if (location.href === lastUrl) return
        lastUrl = location.href
        initUI()
    }
})()
