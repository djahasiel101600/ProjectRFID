# RFID Scan Feature Troubleshooting Guide

## Common WebSocket Connection Errors

### Error: "RFID scan WebSocket error: Event {isTrusted: true, type: 'error'...}"

This error occurs when the WebSocket connection cannot be established. Here's how to fix it:

## Checklist

### 1. **Verify Backend is Running**

```bash
cd backend
python manage.py runserver
```

Expected output: `Starting development server at http://127.0.0.1:8000/`

### 2. **Verify Django Channels is Installed**

```bash
pip install channels channels-redis
```

### 3. **Check WebSocket Endpoint**

The WebSocket should be accessible at: `ws://localhost:8000/ws/admin/rfid-scan/`

To test manually in browser console:

```javascript
const ws = new WebSocket("ws://localhost:8000/ws/admin/rfid-scan/");
ws.onopen = () => console.log("Connected!");
ws.onerror = (e) => console.error("Error:", e);
```

### 4. **Verify Django Settings**

Check `backend/settings.py` has:

```python
INSTALLED_APPS = [
    ...
    'channels',
    ...
]

ASGI_APPLICATION = 'backend.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer'
    }
}
```

### 5. **Check ASGI Configuration**

Verify `backend/asgi.py` contains:

```python
from channels.routing import ProtocolTypeRouter, URLRouter
from core.routing import websocket_urlpatterns

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": URLRouter(websocket_urlpatterns),
})
```

### 6. **Verify Routing**

Check `backend/core/routing.py` has:

```python
re_path(r'ws/admin/rfid-scan/$', consumers.AdminConsumer.as_asgi()),
```

### 7. **Environment Variables**

Check `aem/.env` file:

```bash
VITE_API_URL=http://localhost:8000/api
VITE_WS_URL=ws://localhost:8000
```

⚠️ Make sure `VITE_WS_URL` is **not commented out**!

### 8. **Restart Services**

After making changes:

```bash
# Backend
cd backend
python manage.py runserver

# Frontend (new terminal)
cd aem
npm run dev
```

## Testing the RFID Scan Feature

### Step 1: Verify Backend

```bash
# Check if Django is running
curl http://localhost:8000/api/classrooms/
```

Should return JSON with classrooms.

### Step 2: Test WebSocket Connection

Open browser console and run:

```javascript
const ws = new WebSocket("ws://localhost:8000/ws/admin/rfid-scan/");
ws.onopen = () => console.log("✅ WebSocket Connected!");
ws.onerror = (e) => console.error("❌ WebSocket Error:", e);
ws.onmessage = (e) => console.log("📨 Message:", JSON.parse(e.data));

// After connection opens, send test message:
ws.send(JSON.stringify({ action: "start_scan", classroom_id: 1 }));
```

### Step 3: Test ESP32 Connection

Verify ESP32 firmware is uploaded and connected:

- Check Serial Monitor for "WebSocket Connected!" message
- LED indicators should work on power-on (both flash briefly)

### Step 4: Test Full Flow

1. Open Admin page → Teachers tab
2. Click "Add Teacher"
3. Click "Scan RFID" button
4. Check browser console for connection logs
5. ESP32 should show:
   - 🔴 Red LED ON
   - 🔊 Double beep
   - LCD shows "SCAN MODE"
6. Present RFID tag
7. ESP32 should show:
   - 🟢 Green LED ON
   - 🔊 Three beeps
   - RFID field auto-fills

## Common Issues & Solutions

### Issue: "Connection timeout"

- **Cause**: Backend not running or wrong URL
- **Fix**: Verify backend is running on port 8000

### Issue: "Connection failed"

- **Cause**: CORS or firewall blocking WebSocket
- **Fix**: Check Django CORS settings:

```python
# settings.py
CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",  # Vite dev server
]
```

### Issue: "Scan timeout" after 30 seconds

- **Cause**: ESP32 not receiving scan command
- **Fix**:
  - Verify ESP32 is connected to WiFi
  - Check ESP32 Serial Monitor for errors
  - Verify correct classroom ID is being used

### Issue: RFID not auto-filling

- **Cause**: WebSocket message not reaching frontend
- **Fix**: Check browser console for "RFID scan message" logs

## Debug Mode

To enable verbose logging, add to browser console:

```javascript
localStorage.setItem("debug", "rfid-scan");
```

Then refresh the page. You'll see detailed WebSocket logs.

## Need More Help?

1. Check browser DevTools → Network → WS tab for WebSocket traffic
2. Check ESP32 Serial Monitor for device logs
3. Check Django console for backend logs
4. Verify all three services are running:
   - Django backend (port 8000)
   - React frontend (port 5173)
   - ESP32 connected to WiFi
