#!/usr/bin/env python3
"""
GVE Knowledgebase Server
Simple HTTP server for browsing the knowledgebase locally
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    os.chdir(DIRECTORY)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"🚀 GVE Knowledgebase Server")
        print(f"📍 Directory: {DIRECTORY}")
        print(f"🌐 URL: http://localhost:{PORT}")
        print(f"")
        print(f"Press Ctrl+C to stop")
        print(f"")

        # Open browser
        webbrowser.open(f"http://localhost:{PORT}")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print(f"\n👋 Server stopped")
            sys.exit(0)


if __name__ == "__main__":
    main()
