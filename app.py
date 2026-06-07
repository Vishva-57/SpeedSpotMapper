import os
import time
from flask import Flask, request, jsonify, send_file, Response, stream_with_context
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import requests
import io
import urllib.request
import urllib.error
import ssl
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Ultimate bypass for local SSL certificate issues on Windows/Python
unverified_ctx = ssl._create_unverified_context()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

@app.route('/')
def index():
    return send_file('index.html')

# Database Configuration
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'speedspot_v4.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# Measurement Model
class Measurement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    latitude = db.Column(db.Float, nullable=False)
    longitude = db.Column(db.Float, nullable=False)
    rssi = db.Column(db.Integer)  # Estimated from browser Network Info
    download_speed_mbps = db.Column(db.Float)
    upload_speed_mbps = db.Column(db.Float)
    latency_ms = db.Column(db.Float)
    carrier = db.Column(db.String(50))  # Network operator info
    isp = db.Column(db.String(100))  # Internet Service Provider
    timestamp = db.Column(db.Float, default=time.time)

    def to_dict(self):
        return {
            'id': self.id,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'rssi': self.rssi,
            'download_speed': self.download_speed_mbps,
            'upload_speed': self.upload_speed_mbps,
            'latency': self.latency_ms,
            'carrier': self.carrier,
            'isp': self.isp,
            'timestamp': self.timestamp
        }

with app.app_context():
    db.create_all()

@app.route('/api/measurements', methods=['GET'])
def get_measurements():
    measurements = Measurement.query.all()
    return jsonify([m.to_dict() for m in measurements])

@app.route('/api/measurements', methods=['POST'])
def add_measurement():
    data = request.json
    new_m = Measurement(
        latitude=data['latitude'],
        longitude=data['longitude'],
        rssi=data.get('rssi'),
        download_speed_mbps=data.get('download_speed'),
        upload_speed_mbps=data.get('upload_speed'),
        latency_ms=data.get('latency'),
        carrier=data.get('carrier'),
        isp=data.get('isp')
    )
    db.session.add(new_m)
    db.session.commit()
    return jsonify(new_m.to_dict()), 201

@app.route('/api/measurements/clear', methods=['POST'])
def clear_measurements():
    try:
        num_deleted = db.session.query(Measurement).delete()
        db.session.commit()
        return jsonify({"status": "success", "deleted": num_deleted}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/isp-stats', methods=['GET'])
def get_isp_stats():
    measurements = Measurement.query.all()
    if not measurements:
        return jsonify({
            "status": "success",
            "best_isp": None,
            "stats": [],
            "message": "No data available yet. Please run some scans!"
        }), 200

    stats = {}
    for m in measurements:
        isp = m.isp or "Unknown ISP"
        if isp not in stats:
            stats[isp] = {'count': 0, 'dl_sum': 0, 'rssi_sum': 0}
        stats[isp]['count'] += 1
        stats[isp]['dl_sum'] += (m.download_speed_mbps or 0)
        stats[isp]['rssi_sum'] += (m.rssi or 0)

    results = []
    for isp, data in stats.items():
        avg_dl = data['dl_sum'] / data['count']
        avg_rssi = data['rssi_sum'] / data['count']
        # Score = 0.6 * DL + 0.4 * RSSI (normalized approx)
        score = (0.6 * avg_dl) + (0.4 * (avg_rssi / 10))
        results.append({
            'isp': isp,
            'avg_download': round(avg_dl, 2),
            'avg_signal': round(avg_rssi, 1),
            'samples': data['count'],
            'score': round(score, 2)
        })

    # Sort by score descending
    results.sort(key=lambda x: x['score'], reverse=True)
    
    return jsonify({
        "status": "success",
        "best_isp": results[0]['isp'] if results else None,
        "stats": results
    })

@app.route('/api/ping', methods=['GET'])
def ping():
    return jsonify({"status": "ok", "time": time.time()})

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify({
        "google_maps_api_key": os.getenv("GOOGLE_MAPS_API_KEY", "")
    })


@app.route('/api/proxy/ping', methods=['GET'])
def proxy_ping():
    try:
        # Use requests with verify=False for the ping
        requests.get("https://www.google.com/generate_204", timeout=5, verify=False)
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Global state for authentic real-time UI tracking during backend network measuring
test_state = {"dl_bytes": 0, "ul_bytes": 0, "dl_start": 0, "ul_start": 0, "active": "none"}

@app.route('/api/speed-status', methods=['GET'])
def speed_status():
    return jsonify({
        "active": test_state["active"],
        "dl_bytes": test_state["dl_bytes"],
        "ul_bytes": test_state["ul_bytes"],
        "dl_time": time.time() - test_state["dl_start"] if test_state["dl_start"] else 0,
        "ul_time": time.time() - test_state["ul_start"] if test_state["ul_start"] else 0
    })

@app.route('/api/download-test', methods=['GET'])
def download_test():
    global test_state
    import threading
    import time
    import requests

    # Highly reliable global test file connected via ANYCAST (e.g., fast in India)
    TEST_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.4.120/build/pdf.worker.js.map"  
    THREADS = 4
    TEST_DURATION = 8  # seconds

    total_bytes = 0
    stop_flag = False
    lock = threading.Lock()
    
    test_state["active"] = "dl"
    test_state["dl_bytes"] = 0
    test_state["dl_start"] = time.time()

    def worker():
        nonlocal total_bytes, stop_flag
        while not stop_flag:
            try:
                r = requests.get(TEST_URL, stream=True, timeout=5, verify=False)
                for chunk in r.iter_content(1024 * 64):  # small chunks
                    if stop_flag:
                        break
                    if chunk:
                        with lock:
                            total_bytes += len(chunk)
                            test_state["dl_bytes"] = total_bytes
            except:
                continue

    threads = []
    start_time = time.time()
    for _ in range(THREADS):
        t = threading.Thread(target=worker)
        t.start()
        threads.append(t)

    time.sleep(TEST_DURATION)
    stop_flag = True

    for t in threads:
        t.join(timeout=1.0)

    actual_duration = time.time() - start_time
    test_state["active"] = "none"

    return jsonify({
        "bytes": total_bytes,
        "duration": actual_duration
    })

@app.route('/api/upload-test', methods=['GET', 'POST'])
def upload_test():
    global test_state
    import threading
    import time
    import requests

    TEST_URL = "http://httpbin.org/post"
    THREADS = 4
    TEST_DURATION = 8  # seconds

    total_bytes = 0
    stop_flag = False
    lock = threading.Lock()
    
    test_state["active"] = "ul"
    test_state["ul_bytes"] = 0
    test_state["ul_start"] = time.time()

    def generate_dummy_data():
        nonlocal total_bytes
        chunk = b'0' * 1024 * 64
        while not stop_flag:
            yield chunk
            with lock:
                total_bytes += len(chunk)
                test_state["ul_bytes"] = total_bytes

    def worker():
        try:
            requests.post(TEST_URL, data=generate_dummy_data(), timeout=TEST_DURATION + 1, verify=False)
        except Exception:
            pass

    threads = []
    start_time = time.time()
    for _ in range(THREADS):
        t = threading.Thread(target=worker)
        t.start()
        threads.append(t)

    time.sleep(TEST_DURATION)
    stop_flag = True

    for t in threads:
        t.join(timeout=1.0)

    actual_duration = time.time() - start_time

    return jsonify({
        "bytes": total_bytes,
        "duration": actual_duration
    })

@app.route('/api/proxy/download', methods=['GET'])
def proxy_download():
    return download_test()

@app.route('/api/proxy/upload', methods=['POST'])
def proxy_upload():
    return upload_test()

@app.route('/api/download-stream')
def download_stream():
    """Streams data for real-time speed measurement. Proxies from a Fast CDN or generates random data."""
    target_url = "http://speedtest.tele2.net/100MB.zip"
    try:
        def generate():
            try:
                # Try proxying from a fast source first
                with requests.get(target_url, stream=True, timeout=3) as r:
                    r.raise_for_status()
                    for chunk in r.iter_content(chunk_size=131072): # 128KB
                        if chunk: yield chunk
            except Exception as e:
                print(f"Proxy failed ({e}), switching to random data generation.")
                # Fallback: High-speed local random data generation
                # This ensures the test ALWAYS works regardless of proxy health
                import os
                chunk = os.urandom(262144) # 256KB of random data
                for _ in range(400): # ~100MB total
                    yield chunk
                    time.sleep(0.01) # Small delay to prevent CPU saturation while still being fast

        return Response(stream_with_context(generate()), content_type='application/octet-stream')
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/upload-sink', methods=['POST'])
def upload_sink():
    """Receives and discards data for upload testing."""
    try:
        # Just consume the stream
        _ = request.get_data()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
