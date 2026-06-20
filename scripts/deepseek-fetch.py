"""
DeepSeek conversation exporter.
Uses Playwright to open the conversation page in a real browser,
scans all messages, and saves as structured Markdown.
"""

import sys, re, time, os, argparse
from pathlib import Path
from playwright.sync_api import sync_playwright

OBSIDIAN_VAULT = Path(os.environ.get("OBSIDIAN_VAULT_PATH", r"D:\notebooks\Lmc\brew"))
OUTPUT_DIR = "kb/raw/deepseek"

SEL = {
    "chatContainer": ".ds-virtual-list-visible-items",
    "userMsg": "._9663006",
    "userContent": ".fbb737a4",
    "aiMsg": "._4f9bf79",
    "thinkTime": "._5255ff8._4d41763",
    "thinkChain": ".e1675d8b",
    "answerWrapper": ".ds-assistant-message-main-content",
    "answerFallback": ".ds-markdown",
    "scrollArea": ".ds-scroll-area--enabled, .ds-scroll-area",
}


def html_to_md(html):
    if not html:
        return ""
    md = html
    md = re.sub(r'<pre><code>([\s\S]*?)</code></pre>', lambda m: '\n```\n' + unescape(m.group(1)) + '\n```\n', md)
    for i in range(1, 5):
        p = "#" * i
        md = re.sub(rf'<h{i}[^>]*>', f'\n{p} ', md, flags=re.I)
        md = re.sub(rf'</h{i}>', '\n', md, flags=re.I)
    md = re.sub(r'<strong>([\s\S]*?)</strong>', r'**\1**', md, flags=re.I)
    md = re.sub(r'<b>([\s\S]*?)</b>', r'**\1**', md, flags=re.I)
    md = re.sub(r'<em>([\s\S]*?)</em>', r'*\1*', md, flags=re.I)
    md = re.sub(r'<i>([\s\S]*?)</i>', r'*\1*', md, flags=re.I)
    md = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>', r'[\2](\1)', md, flags=re.I)
    md = re.sub(r'<hr\s*/?>', '\n---\n', md)
    oi = [0]

    def ol_start(m):
        oi[0] = 1
        return "\n"

    def li_start(m):
        if oi[0] > 0:
            oi[0] += 1
            return f'\n{oi[0] - 1}. '
        return "\n- "
    md = re.sub(r'<ol[^>]*>', ol_start, md)
    md = re.sub(r'</ol>', '\n', md)
    md = re.sub(r'<li[^>]*>', li_start, md)
    md = re.sub(r'</li>', '', md)
    md = re.sub(r'<p[^>]*>', '\n', md)
    md = re.sub(r'</p>', '\n', md)
    md = re.sub(r'<br\s*/?>', '\n', md)
    md = re.sub(r'<code>([\s\S]*?)</code>', r'`\1`', md)
    md = re.sub(r'<[^>]+>', '', md)
    md = unescape(md)
    md = re.sub(r'\n{4,}', '\n\n\n', md)
    md = re.sub(r'[ \t]+$', '', md, flags=re.M)
    return md.strip()


def unescape(s):
    for (a, b) in [("&lt;", "<"), ("&gt;", ">"), ("&amp;", "&"), ("&quot;", '"'), ("&#39;", "'"), ("&#x27;", "'"), ("&#x2F;", "/")]:
        s = s.replace(a, b)
    return s


def clean_text(el):
    return el.text_content().replace("\xa0", " ").strip() if el else ""


def extract_messages(page):
    messages = []
    container = page.query_selector(SEL["chatContainer"])
    if not container:
        print("[!] Chat container not found")
        return messages

    children = container.query_selector_all(":scope > *")
    user_count = 0
    ai_count = 0

    for child in children:
        class_name = child.get_attribute("class") or ""

        if SEL["userMsg"].lstrip(".") in class_name:
            text_el = child.query_selector(SEL["userContent"])
            if text_el and text_el.text_content().strip():
                messages.append({"role": "user", "content": text_el.text_content().strip()})
                user_count += 1

        elif SEL["aiMsg"].lstrip(".") in class_name:
            msg = {"role": "assistant", "content": "", "thinkingText": "", "thinkingMd": ""}

            te = child.query_selector(SEL["thinkTime"])
            if te:
                msg["thinkingText"] = clean_text(te)

            tke = child.query_selector(SEL["thinkChain"])
            if tke:
                msg["thinkingMd"] = html_to_md(tke.inner_html())

            ae = child.query_selector(SEL["answerWrapper"])
            if ae:
                msg["content"] = html_to_md(ae.inner_html())
            else:
                all_md = child.query_selector_all(SEL["answerFallback"])
                for md_el in all_md:
                    in_think = md_el.evaluate("el => !!el.closest('.e1675d8b')")
                    if not in_think:
                        msg["content"] = html_to_md(md_el.inner_html())
                        break

            if msg["content"] or msg["thinkingMd"]:
                messages.append(msg)
                ai_count += 1

    print(f"  Extracted: {user_count} user + {ai_count} AI = {len(messages)} total")
    return messages


def scroll_to_load_all(page, timeout=30):
    scroll_el = page.query_selector(SEL["scrollArea"])
    if not scroll_el:
        visible = page.query_selector(SEL["chatContainer"])
        if visible:
            scroll_el = visible.evaluate_handle("el => el.parentElement").as_element()
    if not scroll_el:
        print("  No scroll container found")
        return

    prev_count = 0
    stuck = 0
    start = time.time()

    while time.time() - start < timeout:
        children = page.query_selector_all(SEL["chatContainer"] + " > *")
        count = len(children)
        if count > prev_count:
            print(f"  Messages in DOM: {count}")

        scroll_el.evaluate("el => { el.scrollTop = 0; }")
        page.wait_for_timeout(800)
        scroll_el.evaluate("el => { el.scrollTop = el.scrollHeight; }")
        page.wait_for_timeout(800)

        if count == prev_count and count > 0:
            stuck += 1
            if stuck > 4:
                break
        else:
            stuck = 0
            prev_count = count


def generate_markdown(messages, title, url):
    md = f"# {title}\nSource: {url}\n\n"
    for msg in messages:
        if msg["role"] == "user":
            md += f"## User\n\n{msg['content']}\n\n---\n\n"
        else:
            md += "## Assistant\n\n"
            if msg["thinkingText"]:
                md += f"_{msg['thinkingText']}_\n\n"
            if msg["thinkingMd"]:
                md += "> " + msg["thinkingMd"].replace("\n", "\n> ") + "\n\n"
            content = msg["content"] or ""
            md += content + "\n\n---\n\n"
    return md


def find_chrome_profile():
    candidates = [
        (r"C:\Users\LMC\AppData\Local\Microsoft\Edge\User Data\Default", "msedge"),
        (r"C:\Users\LMC\AppData\Local\Google\Chrome\User Data\Default", "chrome"),
        (r"C:\Users\LMC\AppData\Local\Google\Chrome\User Data\Profile 1", "chrome"),
    ]
    for path, channel in candidates:
        if os.path.isdir(path):
            return path, channel
    return None, None


def main():
    parser = argparse.ArgumentParser(description="Export DeepSeek conversation to Markdown")
    parser.add_argument("url", nargs="?", help="DeepSeek conversation URL")
    parser.add_argument("--output", help="Output file path (default: auto)")
    args = parser.parse_args()

    url = args.url
    if not url:
        url = input("DeepSeek URL: ").strip()
        if not url:
            print("No URL provided")
            sys.exit(1)

    is_share = "/share/" in url
    m = re.search(r"/(?:s|share)/([a-z0-9-]+)", url)
    session_id = m.group(1) if m else "unknown"
    title = f"DeepSeek Chat ({session_id[:8]})"

    print(f"Opening: {url}")
    print(f"Type: {'share (public)' if is_share else 'private session'}")

    context = None
    browser = None

    with sync_playwright() as p:
        if is_share:
            browser = p.chromium.launch(headless=False)
            page = browser.new_page()
        else:
            profile_path, channel = find_chrome_profile()
            if profile_path:
                print(f"Using profile: {profile_path} (channel: {channel})")
                try:
                    launch_args = {
                        "user_data_dir": profile_path,
                        "headless": False,
                        "args": ["--no-sandbox"],
                    }
                    if channel:
                        launch_args["channel"] = channel
                    context = p.chromium.launch_persistent_context(**launch_args)
                    page = context.pages[0] if context.pages else context.new_page()
                except Exception as e:
                    print(f"  Profile launch failed: {e}")
                    browser = p.chromium.launch(headless=False)
                    page = browser.new_page()
            else:
                print("No Chrome profile found, launching fresh browser")
                browser = p.chromium.launch(headless=False)
                page = browser.new_page()

        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(3000)

        if not is_share and "/sign_in" in page.url:
            print("[!] Not logged in. Log in manually in the browser window (60s timeout)...")
            try:
                page.wait_for_url("**/chat/**", timeout=60000)
                page.wait_for_selector(SEL["chatContainer"], timeout=30000)
            except:
                print("[!] Timeout waiting for chat.")
                if context:
                    context.close()
                if browser:
                    browser.close()
                sys.exit(1)

        try:
            page.wait_for_selector(f"{SEL['userMsg']}, {SEL['aiMsg']}", timeout=20000)
            print("[+] Chat messages rendered")
        except:
            print("[!] Messages not found on page")
            page.wait_for_timeout(5000)

        # Check current DOM count
        initial = len(page.query_selector_all(SEL["chatContainer"] + " > *"))
        print(f"  Initial DOM items: {initial}")

        if initial < 8:
            print("[+] Scrolling to load more...")
            scroll_to_load_all(page)
        else:
            print("[+] All messages appear loaded, skipping scroll")

        print("[+] Extracting messages...")
        messages = extract_messages(page)

        if context:
            context.close()
        elif browser:
            browser.close()

    if not messages:
        print("[!] No messages extracted")
        sys.exit(1)

    print(f"[+] Total: {len(messages)} messages")

    md = generate_markdown(messages, title, url)

    # Save locally only (avoid duplication via API)
    ts = time.strftime("%Y-%m-%dT%H-%M-%S")
    fname = f"deepseek_{ts}.md"
    out_path = OBSIDIAN_VAULT / OUTPUT_DIR / fname
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")
    print(f"[+] Saved: {out_path}")

    # Also try Obsidian REST API with PUT (overwrite, not append)
    try:
        import requests
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        OBSIDIAN_TOKEN = "YOUR_OBSIDIAN_TOKEN_HERE"
        r = requests.put(
            f"https://127.0.0.1:27124/vault/{OUTPUT_DIR}/{fname}",
            headers={"Authorization": f"Bearer {OBSIDIAN_TOKEN}", "Content-Type": "text/markdown"},
            data=md.encode("utf-8"),
            verify=False,
            timeout=10,
        )
        if r.ok:
            print(f"[+] Sent to Obsidian API")
    except Exception as e:
        print(f"[!] Obsidian API unavailable: {e}")


if __name__ == "__main__":
    main()
