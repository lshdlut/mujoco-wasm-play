import json
import urllib.request
import urllib.error
import urllib.parse
import sys
import time

def fetch(url: str, headers: dict | None = None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = resp.read()
        ctype = resp.headers.get('content-type', '')
        return resp.status, ctype, len(body)

if __name__ == '__main__':
    url = sys.argv[1]
    headers = {}
    if len(sys.argv) > 2:
        headers['If-Modified-Since'] = sys.argv[2]
    try:
        status, ctype, length = fetch(url, headers)
        print(json.dumps({'status': status, 'ctype': ctype, 'length': length}))
    except Exception as e:
        print(json.dumps({'error': str(e)}))