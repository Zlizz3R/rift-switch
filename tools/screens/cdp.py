"""Tiny CDP driver for headless Edge — stdlib only.

Why this exists: `msedge --window-size=390,844` clamps the window to ~492px, so
"screenshot at phone width" was a 492px layout cropped to 390. device metrics
overrides are the only honest way to render a 390px phone viewport.

Usage:
    with EdgeSession() as page:
        page.navigate(url)
        page.wait_until("typeof renderShop === 'function'")
        page.evaluate("openTheShop()")
        page.device(390, 844, dsf=2)      # or page.device(1100, 900, dsf=2)
        page.screenshot(path)
"""
import base64
import json
import os
import socket
import struct
import subprocess
import time
import urllib.request
from pathlib import Path

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
DEBUG_PORT = 9333


class CdpError(RuntimeError):
    pass


class WebSocket:
    def __init__(self, url, timeout=20):
        rest = url.split("://", 1)[1]
        host_port, path = rest.split("/", 1)
        host, port = host_port.split(":")
        self.sock = socket.create_connection((host, int(port)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise CdpError("websocket handshake closed")
            response += chunk
        head, _, leftover = response.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise CdpError("websocket handshake failed: " + head.decode(errors="replace"))
        self.buffer = leftover

    def _read_exact(self, count):
        while len(self.buffer) < count:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise CdpError("websocket closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:count], self.buffer[count:]
        return data

    def _read_frame(self):
        first, second = self._read_exact(2)
        opcode = first & 0x0F
        masked = second & 0x80
        length = second & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read_exact(8))[0]
        mask = self._read_exact(4) if masked else None
        payload = self._read_exact(length)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return opcode, payload

    def send_text(self, text):
        payload = text.encode()
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        header += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + masked)

    def recv_text(self):
        """Returns one complete text message; answers pings."""
        parts = []
        while True:
            opcode, payload = self._read_frame()
            if opcode == 0x8:
                raise CdpError("websocket closed by peer")
            if opcode == 0x9:  # ping
                # pong: FIN + opcode 0xA, masked
                mask = os.urandom(4)
                masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                self.sock.sendall(bytes([0x8A, 0x80 | len(payload)]) + mask + masked)
                continue
            if opcode in (0x1, 0x0):
                parts.append(payload)
                if opcode == 0x1 and (payload is not None):
                    pass
            # We only care about text messages; Edge sends one frame per message.
            if opcode == 0x1:
                return b"".join(parts).decode()

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class EdgeSession:
    def __init__(self, port=DEBUG_PORT, headless=True, width=1200, height=900):
        self.port = port
        self.width = width
        self.height = height
        self.proc = None
        self.ws = None
        self.next_id = 0
        self.headless = headless

    # -- lifecycle -----------------------------------------------------
    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.stop()
        return False

    def start(self, timeout=30):
        user_dir = Path(os.environ["TEMP"]) / f"rs-edge-profile-{os.getpid()}-{self.port}"
        self.user_dir = user_dir
        args = [
            EDGE,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--mute-audio",
            "--disable-extensions",
            "--no-first-run",
            "--no-default-browser-check",
            f"--remote-debugging-port={self.port}",
            f"--user-data-dir={user_dir}",
            f"--window-size={max(self.width, 800)},{max(self.height, 600)}",
            "about:blank",
        ]
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.time() + timeout
        target = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json/list", timeout=2) as response:
                    targets = json.load(response)
                pages = [t for t in targets if t.get("type") == "page"]
                if pages:
                    target = pages[0]
                    break
            except Exception:
                time.sleep(0.25)
        if not target:
            self.stop()
            raise CdpError("could not reach Edge devtools endpoint")
        self.ws = WebSocket(target["webSocketDebuggerUrl"])
        self.call("Page.enable")
        self.call("Runtime.enable")
        return self

    def stop(self):
        if self.ws:
            self.ws.close()
            self.ws = None
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.sweep()

    def sweep(self):
        """Ends every Edge still running on this session's own profile folder, and removes the folder.

        Edge hands its work to other processes and the one that was started ends, so terminating it leaves
        the page alive: it goes on running until it is ended by name.
        """
        user_dir = getattr(self, "user_dir", None)
        if not user_dir:
            return
        subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*"
                        + user_dir.name + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        import shutil
        for _ in range(5):
            shutil.rmtree(user_dir, ignore_errors=True)
            if not user_dir.exists():
                break
            time.sleep(0.5)
        self.user_dir = None

    # -- commands ------------------------------------------------------
    def call(self, method, params=None, timeout=30):
        self.next_id += 1
        message_id = self.next_id
        payload = {"id": message_id, "method": method}
        if params:
            payload["params"] = params
        self.ws.send_text(json.dumps(payload))
        deadline = time.time() + timeout
        while time.time() < deadline:
            raw = self.ws.recv_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if message.get("id") == message_id:
                if "error" in message:
                    raise CdpError(f"{method}: {message['error']}")
                return message.get("result", {})
        raise CdpError(f"{method}: timed out")

    def navigate(self, url):
        self.call("Page.navigate", {"url": url})
        # Wait for the document to be usable.
        self.wait_until("document.readyState === 'complete'", timeout=30)

    def evaluate(self, expression, await_promise=False, timeout=30):
        result = self.call(
            "Runtime.evaluate",
            {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": await_promise,
                "userGesture": True,
            },
            timeout=timeout,
        )
        if result.get("exceptionDetails"):
            details = result["exceptionDetails"]
            text = details.get("exception", {}).get("description") or details.get("text")
            raise CdpError(f"page error: {text}")
        return result.get("result", {}).get("value")

    def wait_until(self, expression, timeout=20, interval=0.1):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.evaluate(expression):
                return True
            time.sleep(interval)
        raise CdpError(f"timed out waiting for: {expression}")

    def device(self, width, height, dsf=2, mobile=False):
        self.call(
            "Emulation.setDeviceMetricsOverride",
            {
                "width": int(width),
                "height": int(height),
                "deviceScaleFactor": float(dsf),
                "mobile": bool(mobile),
                "screenWidth": int(width),
                "screenHeight": int(height),
            },
        )
        # devicePixelRatio is what the thumbnail renderer caps on; set it too.
        return self.evaluate(
            f"window.innerWidth + 'x' + window.innerHeight + '@' + window.devicePixelRatio"
        )

    def screenshot(self, path, full_page=False):
        params = {"format": "png", "fromSurface": True, "captureBeyondViewport": bool(full_page)}
        result = self.call("Page.captureScreenshot", params, timeout=60)
        data = base64.b64decode(result["data"])
        Path(path).write_bytes(data)
        return len(data)
