"""
FreePass v2 — Flask API Server
Vite가 프론트엔드를 서빙하고, Flask는 API만 담당.
기존 freepasserp의 API 엔드포인트를 그대로 유지.
"""

from flask import Flask, Blueprint, jsonify, request, send_file
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
import io, os, re, time, zipfile

app = Flask(__name__)

# CORS (Vite dev server에서 접근)
@app.after_request
def add_cors(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Admin-Key'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    return response

MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024

# ─── 유틸 ──────────────────────────────────────────────────────────────────────

def _api_error(message, status=400):
    return jsonify({'ok': False, 'message': message}), status

def _require_json():
    if not request.is_json:
        return _api_error('Content-Type must be application/json', 415)
    return None

def _build_google_sheet_csv_url(source_url):
    text = str(source_url or '').strip()
    if not text: raise ValueError('링크를 입력하세요.')
    parsed = urlparse(text)
    if 'docs.google.com' not in (parsed.netloc or ''): raise ValueError('구글시트 링크만 사용 가능.')
    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', parsed.path or '')
    if not match: raise ValueError('링크 형식 확인 필요.')
    sheet_id = match.group(1)
    query = parse_qs(parsed.query or '')
    fragment = parse_qs((parsed.fragment or '').replace('#', '&'))
    gid = query.get('gid', [None])[0] or fragment.get('gid', [None])[0] or '0'
    return f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={quote(str(gid))}'

def _download_text(url):
    req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urlopen(req, timeout=20) as resp:
        body = resp.read(MAX_DOWNLOAD_BYTES + 1)
        if len(body) > MAX_DOWNLOAD_BYTES: raise ValueError('데이터 10MB 초과')
        charset = resp.headers.get_content_charset() or 'utf-8'
        text = body.decode(charset, errors='replace')
        if '<!DOCTYPE html' in text or '<html' in text.lower():
            raise ValueError('링크 공개 범위를 확인하세요.')
        return text

DRIVE_API_KEY = 'AIzaSyBSPo1kZOefX-6NuHoQdUF1htqQDSxXsCs'
_drive_folder_cache = {}
_DRIVE_CACHE_TTL = 3600

def _extract_drive_folder_id(value):
    if not value: return ''
    s = str(value).strip()
    m = re.search(r'/folders/([a-zA-Z0-9_-]+)', s)
    if m: return m.group(1)
    m = re.search(r'/drive/.*?/([a-zA-Z0-9_-]{20,})', s)
    if m: return m.group(1)
    if re.match(r'^[a-zA-Z0-9_-]{20,}$', s): return s
    return ''


# ─── API Blueprint ─────────────────────────────────────────────────────────────

api = Blueprint('api', __name__, url_prefix='/api')

@api.route('/partner/match', methods=['POST'])
def match_partner():
    err = _require_json()
    if err: return err
    payload = request.get_json(silent=True) or {}
    biz = str(payload.get('business_number') or '').replace('-', '').strip()
    if not biz: return jsonify({'ok': True, 'partner': None})
    try:
        import urllib.request, json
        fb_url = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app/partners.json'
        req = urllib.request.Request(fb_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8')) or {}
        for code, p in data.items():
            if not p or p.get('status') == 'deleted': continue
            pb = str(p.get('business_number') or '').replace('-', '').strip()
            if pb == biz:
                return jsonify({'ok': True, 'partner': {
                    'partner_code': p.get('partner_code', code),
                    'partner_name': p.get('partner_name', ''),
                    'partner_type': p.get('partner_type', ''),
                }})
        return jsonify({'ok': True, 'partner': None})
    except Exception as e:
        return jsonify({'ok': False, 'message': str(e)}), 500

@api.route('/vehicle-master/fetch', methods=['POST'])
def fetch_vehicle_master():
    err = _require_json()
    if err: return err
    payload = request.get_json(silent=True) or {}
    source_url = str(payload.get('source_url') or '').strip()
    if not source_url: return _api_error('source_url 필요')
    try:
        csv_url = _build_google_sheet_csv_url(source_url)
        csv_text = _download_text(csv_url)
        return jsonify({'ok': True, 'source_url': source_url, 'csv_url': csv_url, 'text': csv_text})
    except (ValueError, HTTPError, URLError) as e:
        return _api_error(str(e))

@api.route('/proxy-image', methods=['GET'])
def proxy_image():
    url = request.args.get('url', '').strip()
    if not url: return _api_error('url 필요')
    parsed = urlparse(url)
    allowed = ('drive.google.com', 'docs.google.com', 'lh3.googleusercontent.com', 'lh4.googleusercontent.com', 'lh5.googleusercontent.com', 'lh6.googleusercontent.com')
    if parsed.hostname not in allowed: return _api_error('허용되지 않는 도메인')
    if 'drive.google.com' in url and '/file/d/' in url:
        m = re.search(r'/file/d/([^/]+)', url)
        if m: url = f'https://drive.google.com/uc?export=download&id={m.group(1)}'
    try:
        req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urlopen(req, timeout=15) as resp:
            data = resp.read(MAX_DOWNLOAD_BYTES)
            ct = resp.headers.get('Content-Type', 'image/jpeg')
            return app.response_class(data, mimetype=ct, headers={'Cache-Control': 'public, max-age=86400'})
    except Exception:
        return _api_error('이미지 다운로드 실패')

@api.route('/drive-folder-images', methods=['GET'])
def drive_folder_images():
    import json as _json
    folder_input = request.args.get('folder', '').strip()
    size = max(200, min(4000, int(request.args.get('size', 1920))))
    folder_id = _extract_drive_folder_id(folder_input)
    if not folder_id: return _api_error('유효한 폴더가 아닙니다.')
    now = time.time()
    cached = _drive_folder_cache.get(folder_id)
    if cached and now - cached[0] < _DRIVE_CACHE_TTL:
        urls = [f'https://lh3.googleusercontent.com/d/{fid}=w{size}' for fid in cached[1]]
        return jsonify({'ok': True, 'urls': urls, 'count': len(urls), 'cached': True})
    try:
        query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
        api_url = f'https://www.googleapis.com/drive/v3/files?q={quote(query)}&key={DRIVE_API_KEY}&fields=files(id,name,mimeType)&pageSize=200&orderBy=name'
        req = Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urlopen(req, timeout=20) as resp:
            data = _json.loads(resp.read().decode('utf-8'))
        ids = [f['id'] for f in data.get('files', []) if f.get('id')]
        _drive_folder_cache[folder_id] = (now, ids)
        urls = [f'https://lh3.googleusercontent.com/d/{fid}=w{size}' for fid in ids]
        return jsonify({'ok': True, 'urls': urls, 'count': len(urls)})
    except Exception as e:
        return _api_error(f'폴더 조회 실패: {e}', 502)

@api.route('/photos/zip', methods=['POST'])
def download_photos_zip():
    err = _require_json()
    if err: return err
    payload = request.get_json(silent=True) or {}
    urls = [str(u).strip() for u in (payload.get('urls') or []) if str(u).strip()][:30]
    car_no = re.sub(r'[^\w가-힣\-]', '_', str(payload.get('car_no') or 'photos')) or 'photos'
    if not urls: return _api_error('urls 필요')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for i, url in enumerate(urls):
            try:
                req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urlopen(req, timeout=15) as resp:
                    data = resp.read()
                    ct = resp.headers.get('Content-Type', '')
                    ext = '.png' if 'png' in ct else '.webp' if 'webp' in ct else '.jpg'
                    zf.writestr(f'photo_{str(i+1).zfill(2)}{ext}', data)
            except Exception: pass
    buf.seek(0)
    return send_file(buf, mimetype='application/zip', as_attachment=True, download_name=f'{car_no}_사진.zip')

# ─── OCR (Google Vision proxy) ────────────────────────────────────────────────

import json as _json_ocr
VISION_API_KEY = os.environ.get('GOOGLE_VISION_API_KEY', '')

@api.route('/ocr', methods=['POST'])
def ocr_vision():
    """프론트는 base64 이미지만 보내고, 키는 서버에서 주입.
    body: { image: base64string }
    resp: { ok, text } or { ok: false, error }
    """
    if not VISION_API_KEY:
        return _api_error('OCR disabled — GOOGLE_VISION_API_KEY env 미설정', 503)
    err = _require_json()
    if err: return err
    payload = request.get_json(silent=True) or {}
    image_b64 = str(payload.get('image') or '').strip()
    if not image_b64:
        return _api_error('image(base64) 필수')
    try:
        body = _json_ocr.dumps({
            'requests': [{
                'image': {'content': image_b64},
                'features': [{'type': 'TEXT_DETECTION', 'maxResults': 1}],
            }]
        }).encode()
        req = Request(
            f'https://vision.googleapis.com/v1/images:annotate?key={VISION_API_KEY}',
            data=body, method='POST',
            headers={'Content-Type': 'application/json'},
        )
        with urlopen(req, timeout=30) as res:
            data = _json_ocr.loads(res.read().decode())
        text = ((data.get('responses') or [{}])[0].get('fullTextAnnotation') or {}).get('text', '')
        return jsonify({'ok': True, 'text': text})
    except HTTPError as e:
        return _api_error(f'Vision API HTTP {e.code}', 502)
    except Exception as e:
        return _api_error(f'OCR 실패: {e}', 500)

# ─── Kakao 알림톡 (Aligo) ──────────────────────────────────────────────────────
#
# 환경변수:
#   ALIGO_API_KEY      — Aligo 발급 API 키
#   ALIGO_USER_ID      — Aligo 계정 ID
#   ALIGO_SENDER_KEY   — 카카오 비즈채널 발신프로필 키 (+ 승인된 템플릿 코드별 매핑)
#   ALIGO_ADMIN_KEY    — 프론트에서 이 헤더(X-Admin-Key)로 인증
#
# 템플릿 (AlimTalk 승인 필수):
#   new_inquiry   — "고객님께 {차량} 문의가 들어왔습니다"
#   contract_sent — "{에이전트}님, 계약서가 발송되었습니다. 확인 링크: {url}"
#   contract_done — "{차량} 계약 체결 완료"
#   settle_ready  — "정산금 {금액} 지급 예정"

ALIGO_API_KEY = os.environ.get('ALIGO_API_KEY', '')
ALIGO_USER_ID = os.environ.get('ALIGO_USER_ID', '')
ALIGO_SENDER_KEY = os.environ.get('ALIGO_SENDER_KEY', '')
ALIGO_ADMIN_KEY = os.environ.get('ALIGO_ADMIN_KEY', '')

@api.route('/alimtalk/send', methods=['POST'])
def alimtalk_send():
    """body: { template_code, receiver_tel, variables: {key: value} }
    variables 는 템플릿 내 #{key} 치환."""
    if not (ALIGO_API_KEY and ALIGO_USER_ID and ALIGO_SENDER_KEY):
        return _api_error('알림톡 미설정 — ALIGO_* env 확인', 503)
    if ALIGO_ADMIN_KEY and request.headers.get('X-Admin-Key', '') != ALIGO_ADMIN_KEY:
        return _api_error('unauthorized', 401)
    err = _require_json()
    if err: return err
    payload = request.get_json(silent=True) or {}
    template = str(payload.get('template_code') or '').strip()
    tel = str(payload.get('receiver_tel') or '').replace('-', '').strip()
    variables = payload.get('variables') or {}
    if not template or not tel:
        return _api_error('template_code · receiver_tel 필수')
    try:
        # 치환: "#{name}" 형태. 템플릿 원문은 Aligo 콘솔에서 승인된 대로 보내야 함
        subject = str(variables.pop('_subject', '')) if isinstance(variables, dict) else ''
        message = str(variables.pop('_message', ''))
        if not message:
            return _api_error('variables._message 필수 (승인 템플릿 본문)')
        import urllib.parse as _up
        form = {
            'apikey': ALIGO_API_KEY,
            'userid': ALIGO_USER_ID,
            'senderkey': ALIGO_SENDER_KEY,
            'tpl_code': template,
            'sender': os.environ.get('ALIGO_SENDER_TEL', ''),
            'receiver_1': tel,
            'subject_1': subject or template,
            'message_1': message,
        }
        data = _up.urlencode(form).encode()
        req = Request('https://kakaoapi.aligo.in/akv10/alimtalk/send/', data=data, method='POST',
                     headers={'Content-Type': 'application/x-www-form-urlencoded'})
        with urlopen(req, timeout=10) as res:
            result = _json_ocr.loads(res.read().decode())
        return jsonify({'ok': True, 'result': result})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ─── SMS (Solapi) ──────────────────────────────────────────────────────────────

import hmac, hashlib, secrets, datetime, json as _json

SOLAPI_API_KEY = os.environ.get('SOLAPI_API_KEY', 'NCSV5JTOZ121DIDR')
SOLAPI_API_SECRET = os.environ.get('SOLAPI_API_SECRET', 'EHWRARRBCD9UYQ3HFBM8XINKZD8BHNE0')
SOLAPI_FROM = os.environ.get('SOLAPI_FROM', '01063930926')
SMS_API_ADMIN_KEY = os.environ.get('SMS_API_ADMIN_KEY', '')

def _solapi_auth_header():
    date = datetime.datetime.utcnow().isoformat(timespec='milliseconds') + 'Z'
    salt = secrets.token_hex(16)
    sig = hmac.new(SOLAPI_API_SECRET.encode(), (date + salt).encode(), hashlib.sha256).hexdigest()
    return f'HMAC-SHA256 apiKey={SOLAPI_API_KEY}, date={date}, salt={salt}, signature={sig}'

@app.route('/api/sms/send', methods=['POST'])
def sms_send():
    if not SMS_API_ADMIN_KEY: return jsonify({'ok': False, 'error': 'SMS disabled'}), 503
    if request.headers.get('X-Admin-Key', '') != SMS_API_ADMIN_KEY: return jsonify({'ok': False, 'error': 'unauthorized'}), 401
    try:
        body = request.get_json(silent=True) or {}
        to = str(body.get('to', '')).replace('-', '').strip()
        text = str(body.get('text', '')).strip()
        sender = str(body.get('from', '') or SOLAPI_FROM).replace('-', '').strip()
        if not to or not text: return _api_error('to/text 필수')
        payload = _json.dumps({'message': {'to': to, 'from': sender, 'text': text}}).encode()
        req = Request('https://api.solapi.com/messages/v4/send', data=payload, method='POST',
                     headers={'Authorization': _solapi_auth_header(), 'Content-Type': 'application/json; charset=utf-8'})
        with urlopen(req, timeout=10) as res:
            result = _json.loads(res.read().decode())
        return jsonify({'ok': True, 'result': result})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


# ─── 등록 ─────────────────────────────────────────────────────────────────────

app.register_blueprint(api)

@app.route('/')
def index():
    return jsonify({
        'name': 'FreePass v2 API',
        'status': 'running',
        'endpoints': ['/api/partner/match', '/api/vehicle-master/fetch', '/api/proxy-image', '/api/drive-folder-images', '/api/photos/zip', '/api/ocr', '/api/alimtalk/send', '/api/sms/send']
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=7001, debug=True)
