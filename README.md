# SpeedSpot Mapper 📡📍

SpeedSpot Mapper is a smart city internet speed mapping and navigation utility designed to help users map network speeds, identify the best internet service providers (ISPs) in their area, and navigate to local "optimal signal spots" to get the fastest download and upload rates.

Developed with a premium, sleek glassmorphic UI, it provides real-time speed indicators, historical speed mapping on Google Maps, and navigation guides.

---

## Features 🚀

- **Live Speedometers**: Beautiful SVG gauges measuring download speed, upload speed, ping, and signal strength.
- **Interactive Map Dashboard**: High-fidelity Google Maps integration with customized dark map themes showing localized speed test records.
- **Local Tower Estimation**: Determines approximate nearest tower location based on localized coordinate grids.
- **Optimal Spot Finder**: Recommends the direction (e.g., North-West, East) and exact distance (in meters) to walk to achieve the highest network speed boost.
- **ISP/SIM Comparison**: Tracks statistics of local operators and displays a scoreboard ranking the best SIM providers (e.g. Airtel, Jio) based on empirical local speed test results.
- **Secure Architecture**: Decoupled environment setup where API keys are dynamically requested from a secure Flask backend, maintaining code hygiene and preventing credentials from leaking into Git.

---

## System Architecture 🏗️

```
   [ Web Browser / Client ]
      │
      ├── (Dynamic Load) ──> Fetches Maps JS using backend key
      ├── (API Requests) ──> Submits & fetches speed test logs
      │
      ▼
   [ Flask Backend Server ]
      │
      ├── (dotenv) ──> Loads secure GOOGLE_MAPS_API_KEY from `.env`
      └── (SQLAlchemy) ──> Queries & updates sqlite database (`speedspot_v4.db`)
```

---

## Installation & Setup 🛠️

### Prerequisites
- Python 3.10+
- A Google Maps API Key (with *Maps JavaScript API* and *Geocoding API* enabled)

### Local Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/SpeedSpotMapper.git
   cd SpeedSpotMapper
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt flask-sqlalchemy
   ```

3. **Configure environment variables**:
   Create a `.env` file in the root directory and add your Google Maps API Key:
   ```env
   GOOGLE_MAPS_API_KEY=AIzaSyYourKeyHere
   ```

4. **Run the application**:
   ```bash
   python app.py
   ```

5. **Access the application**:
   Open [http://127.0.0.1:5000/](http://127.0.0.1:5000/) in your web browser.

---

## Security Best Practices Applied 🔒
- **Secrets Isolation**: The Google Maps API key is fully isolated in `.env` and kept out of Git tracking via `.gitignore`.
- **API Restricting**: The key is designed to be locked using Google Cloud Console referrer limits so it can only execute from trusted domains (e.g. `http://localhost:5000/*`), preventing abuse even if inspected in the browser.
