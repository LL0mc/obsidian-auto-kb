"""
DeepSeek conversation exporter.
Uses Playwright to intercept API responses and extract ALL messages,
bypassing DOM virtual-list limitations.
"""

import sys, re, time, os, json, argparse
from pathlib import Path
from playwright.sync_api import sync_playwright

OBSIDIAN_VAULT = Path(os.environ.get("OBSIDIAN_VAULT_PATH", r"D:\notebooks\Lmc\brew"))
OUTPUT_DIR = "kb/raw/deepseek"

API_PATTERNS = [
    "/api/v0/share/content",
    "/api/v0/chat/",
    "/api/v1/chat/",
    "/api/conversation",
    "/api/session",
]


def extract_messages_from_api(data):
    """Extract messages from DeepSeek API response structure."""
    messages = []

    # Navigate: data -> data -> biz_data -> messages
    biz_data = None
    try:
        biz_data = data["data"]["data"]["biz_data"]
    except (KeyError, TypeError):
        try:
            biz_data = data["data"]["biz_data"]
        except (KeyError, TypeError):
            try:
                biz_data = data["biz_data"]
            except (KeyError, TypeError):
                return messages

    raw_msgs = biz_data.get("messages", []) if isinstance(biz_data, dict) else []

    for m in raw_msgs:
        role = m.get("role", "").upper()
        fragments = m.get("fragments", [])

        user_content = ""
        ai_content = ""
        thinking_parts = []
        tool_calls = []

        for frag in fragments:
            ftype = frag.get("type", "")
            content = frag.get("content") or ""

            if ftype == "REQUEST":
                user_content = content
            elif ftype == "RESPONSE":
                ai_content = content
            elif ftype == "THINK":
                if content:
                    thinking_parts.append(content)
            elif ftype in ("TOOL_SEARCH", "TOOL_OPEN"):
                queries = frag.get("queries", [])
                if queries:
                    tool_calls.append({"type": ftype, "queries": queries})

        if role == "USER" and user_content:
            messages.append({
                "role": "user",
                "message_id": m.get("message_id"),
                "content": user_content,
            })
        elif role == "ASSISTANT":
            thinking_md = "\n\n".join(thinking_parts) if thinking_parts else ""
            messages.append({
                "role": "assistant",
                "message_id": m.get("message_id"),
                "content": ai_content,
                "thinkingMd": thinking_md,
                "toolCalls": tool_calls,
            })

    return messages


def generate_markdown(messages, title, url):
    md = f"# {title}\nSource: {url}\n\n"
    for msg in messages:
        if msg["role"] == "user":
            md += f"## User\n\n{msg['content']}\n\n---\n\n"
        else:
            md += "## Assistant\n\n"
            if msg.get("thinkingMd"):
                md += "> " + msg["thinkingMd"].replace("\n", "\n> ") + "\n\n"
            md += msg["content"] + "\n\n---\n\n"
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
    api_messages = []

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

        # Intercept API responses
        def on_response(response):
            resp_url = response.url
            if any(pat in resp_url for pat in API_PATTERNS):
                try:
                    body = response.json()
                    msgs = extract_messages_from_api(body)
                    if msgs:
                        api_messages.extend(msgs)
                        print(f"  [API] {resp_url.split('?')[0].split('/')[-1]}: {len(msgs)} messages")
                except Exception:
                    pass

        page.on("response", on_response)

        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(5000)

        if not is_share and "/sign_in" in page.url:
            print("[!] Not logged in. Log in manually in the browser window (60s timeout)...")
            try:
                page.wait_for_url("**/chat/**", timeout=60000)
                page.wait_for_timeout(5000)
            except:
                print("[!] Timeout waiting for chat.")
                if context:
                    context.close()
                if browser:
                    browser.close()
                sys.exit(1)

        # For non-share pages, scroll up to trigger loading earlier messages
        if not is_share:
            scroll_el = page.query_selector(".ds-scroll-area--enabled, .ds-scroll-area")
            if scroll_el:
                print("[+] Scrolling to load full history...")
                for _ in range(10):
                    prev_count = len(api_messages)
                    scroll_el.evaluate("el => { el.scrollTop = 0; }")
                    page.wait_for_timeout(2000)
                    if len(api_messages) == prev_count:
                        break
                    print(f"    Messages so far: {len(api_messages)}")

        if context:
            context.close()
        elif browser:
            browser.close()

    # Deduplicate by message_id
    seen = set()
    unique_msgs = []
    for msg in api_messages:
        mid = msg.get("message_id")
        key = mid if mid else (msg["role"], msg["content"][:100])
        if key not in seen:
            seen.add(key)
            unique_msgs.append(msg)

    # Sort by message_id
    unique_msgs.sort(key=lambda m: m.get("message_id") or 0)

    if not unique_msgs:
        print("[!] No messages extracted from API")
        sys.exit(1)

    print(f"[+] Total: {len(unique_msgs)} unique messages")

    md = generate_markdown(unique_msgs, title, url)

    # Save locally
    ts = time.strftime("%Y-%m-%dT%H-%M-%S")
    fname = f"deepseek_{ts}.md"
    out_path = OBSIDIAN_VAULT / OUTPUT_DIR / fname
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")
    print(f"[+] Saved: {out_path}")

    # Also try Obsidian REST API
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
