/* ============================================================
   Discord Mobile Status & Custom Rich Presence Manager
   · Handles Express server to serve HTML/CSS/JS control panel
   · WebSocket server to coordinate settings and status with the browser
   · Direct Discord Gateway client that supports masquerading as a mobile client
   ============================================================ */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const path       = require('path');
const fs         = require('fs');

const PORT = parseInt(process.env.PORT || '3785');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Default initial state
let rp = {
  token:     '',
  appId:     '1505820670209163334',
  type:      3, // Watching
  name:      '🦤.',
  details:   'be mine ?',
  state:     "Lighting a fire -`♡`- | she's pure mag",
  streamUrl: '',
  largeUrl:  '',
  largeText: '',
  smallUrl:  '',
  smallText: '',
  btn1Label: 'Mathura',
  btn1Url:   'https://discord.gg/p3Bzg5wK2f',
  btn2Label: '',
  btn2Url:   '',
  partySize: '',
  partyMax:  '',
  tsMode:    'local_time', // none, connection, started, update, local_time, custom
  platform:  'mobile_android', // desktop, mobile_android, mobile_ios
  customStart: '',
  customEnd:   '',
  keepOnline: true
};

// Load saved config if exists
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(data);
      rp = { ...rp, ...parsed };
      console.log('[Config] Loaded settings from config.json');
    }
  } catch (err) {
    console.error('[Config] Failed to load config.json:', err.message);
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(rp, null, 2), 'utf8');
  } catch (err) {
    console.error('[Config] Failed to save config.json:', err.message);
  }
}

loadConfig();

/* ─────────────────────────────────────────────────────────────
   EXPRESS SERVER
   ───────────────────────────────────────────────────────────── */
const app = express();
app.use(express.static(__dirname));

const server = http.createServer(app);

/* ─────────────────────────────────────────────────────────────
   DISCORD GATEWAY CLIENT
   ───────────────────────────────────────────────────────────── */
let userWs      = null;
let gwConnected = false;
let userInfo    = null;
let hbTimer     = null;
let rcTimer     = null;
let seqNum      = null;
let sessionId   = null;
let manualClose = false;
let startTime   = Date.now(); // When the script started
let connTime    = null;       // When WebSocket connected
let updateTime  = null;       // When presence was last updated

const GW_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

function getGatewayProperties(platform) {
  switch (platform) {
    case 'mobile_android':
      return {
        os: 'Android',
        browser: 'Discord Android',
        device: 'Android',
        system_locale: 'en-US'
      };
    case 'mobile_ios':
      return {
        os: 'iOS',
        browser: 'Discord iOS',
        device: 'iPhone',
        system_locale: 'en-US'
      };
    case 'desktop':
    default:
      return {
        os: 'Windows',
        browser: 'Discord Client',
        device: '',
        system_locale: 'en-US'
      };
  }
}

function connectGateway() {
  if (!rp.token) {
    console.warn('[GW] Cannot connect: Token is empty.');
    return;
  }

  if (userWs) {
    manualClose = true;
    userWs.close();
  }

  manualClose = false;
  console.log(`[GW] Connecting with platform: ${rp.platform}...`);
  broadcastStatus();

  userWs = new WebSocket(GW_URL);

  userWs.on('open', () => {
    connTime = Date.now();
  });

  userWs.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.s) seqNum = msg.s;

      switch (msg.op) {
        case 10: // Hello
          startHB(msg.d.heartbeat_interval);
          identify();
          break;
        case 11: // HB ACK
          // Console.log('[GW] Heartbeat ACK');
          break;
        case 1:  // Server HB Request
          sendHB();
          break;
        case 0:  // Dispatch Events
          onDispatch(msg.t, msg.d);
          break;
        case 7:  // Reconnect Request
          console.log('[GW] Discord requested reconnect. Reconnecting...');
          scheduleReconnect(1000);
          break;
        case 9:  // Invalid Session
          console.warn('[GW] Invalid Session. Re-identifying in 5 seconds...');
          setTimeout(identify, 5000);
          break;
      }
    } catch (err) {
      console.error('[GW] Message processing error:', err.message);
    }
  });

  userWs.on('close', code => {
    stopHB();
    gwConnected = false;
    broadcastStatus();
    console.log(`[GW] Connection closed (Code: ${code})`);
    if (!manualClose) {
      console.log('[GW] Connection lost. Reconnecting in 5 seconds...');
      scheduleReconnect(5000);
    }
  });

  userWs.on('error', err => {
    console.error('[GW] WebSocket Error:', err.message);
  });
}

function identify() {
  if (!userWs || userWs.readyState !== WebSocket.OPEN) return;

  const payload = {
    op: 2,
    d: {
      token: rp.token,
      capabilities: 16381,
      properties: getGatewayProperties(rp.platform),
      presence: buildPresencePayload(),
      compress: false
    }
  };

  gwSend(payload);
  console.log('[GW] Sent Identify payload.');
}

function onDispatch(type, data) {
  if (type === 'READY') {
    sessionId   = data.session_id;
    userInfo    = data.user;
    gwConnected = true;
    console.log(`[GW] Successfully online as ${userInfo.username}#${userInfo.discriminator || '0'}`);
    broadcastStatus();
    // Wait a brief moment before pushing presence to ensure session is fully ready
    setTimeout(pushPresence, 1000);
  } else if (type === 'RESUMED') {
    gwConnected = true;
    console.log('[GW] Resumed connection session.');
    broadcastStatus();
  }
}

function pushPresence() {
  if (!gwConnected) return;
  updateTime = Date.now();
  const payload = {
    op: 3,
    d: buildPresencePayload()
  };
  gwSend(payload);
  console.log('[GW] Rich presence state updated.');
  broadcastAll({ type: 'presence_pushed' });
}

function buildPresencePayload() {
  const activities = [];

  if (rp.name) {
    const act = {
      type: parseInt(rp.type),
      name: rp.name,
      details: rp.details || undefined,
      state: rp.state || undefined
    };

    if (parseInt(rp.type) === 1 && rp.streamUrl) {
      act.url = rp.streamUrl;
    }
    if (rp.appId) {
      act.application_id = rp.appId;
    }

    // Assets (Large & Small Images)
    const li = rp.largeUrl;
    const si = rp.smallUrl;
    if (li || si) {
      act.assets = {};
      if (li) {
        act.assets.large_image = li;
        if (rp.largeText) act.assets.large_text = rp.largeText;
      }
      if (si) {
        act.assets.small_image = si;
        if (rp.smallText) act.assets.small_text = rp.smallText;
      }
    }

    // Timestamps
    let start = null;
    let end = null;
    
    switch (rp.tsMode) {
      case 'started':
        start = startTime;
        break;
      case 'connection':
        start = connTime || Date.now();
        break;
      case 'update':
        start = updateTime || Date.now();
        break;
      case 'local_time':
        // CustomRP's local time setting usually stamps the start as current time when connected
        start = connTime || Date.now();
        break;
      case 'custom':
        if (rp.customStart) start = new Date(rp.customStart).getTime();
        if (rp.customEnd) end = new Date(rp.customEnd).getTime();
        break;
      case 'none':
      default:
        break;
    }

    if (start || end) {
      act.timestamps = {};
      if (start) act.timestamps.start = start;
      if (end) act.timestamps.end = end;
    }

    // Party size
    if (rp.partySize && rp.partyMax) {
      act.party = {
        size: [parseInt(rp.partySize), parseInt(rp.partyMax)]
      };
    }

    // Buttons
    const buttons = [];
    if (rp.btn1Label && rp.btn1Url) {
      buttons.push({ label: rp.btn1Label, url: rp.btn1Url });
    }
    if (rp.btn2Label && rp.btn2Url) {
      buttons.push({ label: rp.btn2Label, url: rp.btn2Url });
    }
    if (buttons.length > 0) {
      act.buttons = buttons;
    }

    activities.push(act);
  }

  return {
    status: 'online',
    since: null,
    activities,
    afk: false
  };
}

function gwSend(payload) {
  if (userWs && userWs.readyState === WebSocket.OPEN) {
    userWs.send(JSON.stringify(payload));
  }
}

function startHB(interval) {
  stopHB();
  sendHB();
  hbTimer = setInterval(sendHB, interval);
}

function stopHB() {
  if (hbTimer) {
    clearInterval(hbTimer);
    hbTimer = null;
  }
}

function sendHB() {
  gwSend({ op: 1, d: seqNum });
}

function scheduleReconnect(ms) {
  clearTimeout(rcTimer);
  rcTimer = setTimeout(connectGateway, ms);
}

function disconnectGateway() {
  manualClose = true;
  clearTimeout(rcTimer);
  stopHB();
  if (userWs) {
    userWs.close();
    userWs = null;
  }
  gwConnected = false;
  userInfo = null;
  console.log('[GW] Disconnected from Discord.');
  broadcastStatus();
}

/* ─────────────────────────────────────────────────────────────
   WEBSOCKET SERVER (Control Panel Communication)
   ───────────────────────────────────────────────────────────── */
const wss = new WebSocket.Server({ server });
const browsers = new Set();

wss.on('connection', ws => {
  browsers.add(ws);

  // Send current state to newly connected client
  ws.send(JSON.stringify({
    type: 'init',
    gwConnected,
    userInfo,
    rp
  }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'connect_gateway':
          if (!msg.token) return;
          rp.token = msg.token;
          saveConfig();
          connectGateway();
          break;
        case 'disconnect_gateway':
          disconnectGateway();
          break;
        case 'update_rp':
          // Update rich presence state fields from client and save config
          Object.assign(rp, msg.data);
          saveConfig();
          broadcastAll({ type: 'rp_update', rp });
          if (gwConnected) {
            pushPresence();
          } else {
            console.log('[Config] Presence updated locally. Connect gateway to apply.');
          }
          break;
        case 'push':
          pushPresence();
          break;
      }
    } catch (err) {
      console.error('[WS] Error processing browser message:', err.message);
    }
  });

  ws.on('close', () => {
    browsers.delete(ws);
  });
});

function broadcastAll(payload) {
  const raw = JSON.stringify(payload);
  for (const client of browsers) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
}

function broadcastStatus() {
  broadcastAll({
    type: 'status',
    gwConnected,
    userInfo
  });
}

/* ─────────────────────────────────────────────────────────────
   START SERVER
   ───────────────────────────────────────────────────────────── */
server.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🟢 Discord Mobile Status & CustomRP Manager`);
  console.log(`👉 UI Dashboard: http://localhost:${PORT}`);
  console.log(`==================================================\n`);

  // Auto-connect at startup if keepOnline is enabled and token is set
  if (rp.keepOnline && rp.token) {
    console.log('[Config] Auto-connect enabled. Attempting 24/7 gateway connection...');
    connectGateway();
  }
});
