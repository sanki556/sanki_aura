/* ============================================================
   Discord Mobile Status & CustomRP — Client Logic
   ============================================================ */

const SERVER_WS = `ws://${window.location.host}`;
let wsClient = null;
let gwConnected = false;
let startEpoch = null;
let timerInterval = null;

// Local presence state
const rp = {
  token:     '',
  appId:     '',
  type:      0,
  name:      '',
  details:   '',
  state:     '',
  streamUrl: '',
  largeUrl:  '',
  largeText: '',
  smallUrl:  '',
  smallText: '',
  btn1Label: '',
  btn1Url:   '',
  btn2Label: '',
  btn2Url:   '',
  partySize: '',
  partyMax:  '',
  tsMode:    'local_time',
  platform:  'mobile_android',
  customStart: '',
  customEnd:   '',
  keepOnline: true
};

const $ = id => document.getElementById(id);
const TYPE_LABELS = ['PLAYING A GAME', 'LIVE ON TWITCH', 'LISTENING TO', 'WATCHING', '', 'COMPETING IN'];

/* ── SERVER CONNECTION ── */
function connectServer() {
  wsClient = new WebSocket(SERVER_WS);

  wsClient.onopen = () => {
    console.log('[WS] Connected to backend server.');
  };

  wsClient.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      switch (msg.type) {
        case 'init':
          gwConnected = msg.gwConnected;
          if (msg.rp) {
            Object.assign(rp, msg.rp);
            syncFieldsFromRp();
          }
          updateGatewayUI(msg.gwConnected, msg.userInfo);
          updatePreview();
          break;

        case 'status':
          gwConnected = msg.gwConnected;
          updateGatewayUI(msg.gwConnected, msg.userInfo);
          if (msg.gwConnected) {
            showToast('Connected to Discord Gateway!', 'success');
          } else {
            showToast('Disconnected from Discord.', 'error');
          }
          updatePreview();
          break;

        case 'rp_update':
          Object.assign(rp, msg.rp);
          syncFieldsFromRp();
          updatePreview();
          break;

        case 'presence_pushed':
          showToast('Presence updated on Discord!', 'success');
          break;
      }
    } catch (err) {
      console.error('[WS] Message parsing error:', err);
    }
  };

  wsClient.onclose = () => {
    console.warn('[WS] Connection closed. Retrying in 3 seconds...');
    updateGatewayUI(false, null);
    setTimeout(connectServer, 3000);
  };
}

function sendToServer(payload) {
  if (wsClient && wsClient.readyState === WebSocket.OPEN) {
    wsClient.send(JSON.stringify(payload));
  }
}

/* ── UI BINDING AND SYNCRONIZATION ── */
function syncFieldsFromRp() {
  const bindings = {
    tokenInput:  'token',
    appId:       'appId',
    actType:     'type',
    platform:    'platform',
    actName:     'name',
    actDetails:  'details',
    streamUrl:   'streamUrl',
    actState:    'state',
    stateUrl:    'stateUrl',
    partySize:   'partySize',
    partyMax:    'partyMax',
    largeUrl:    'largeUrl',
    largeText:   'largeText',
    smallUrl:    'smallUrl',
    smallText:   'smallText',
    btn1Label:   'btn1Label',
    btn1Url:     'btn1Url',
    btn2Label:   'btn2Label',
    btn2Url:     'btn2Url'
  };
  
  // Set checkbox state for keepOnline
  const keepOnlineChk = $('keepOnline');
  if (keepOnlineChk) {
    keepOnlineChk.checked = !!rp.keepOnline;
  }

  for (const [domId, rpKey] of Object.entries(bindings)) {
    const el = $(domId);
    if (el) {
      el.value = rp[rpKey] || '';
    }
  }

  // Handle radio buttons for timestamp
  const tsRadio = document.querySelector(`input[name="tsMode"][value="${rp.tsMode}"]`);
  if (tsRadio) {
    tsRadio.checked = true;
  }

  // Handle stream URL activation
  toggleStreamUrl();
  toggleCustomTimestampFields();
}

function updateGatewayUI(connected, user) {
  const badge = $('connectionBadge');
  const tag = $('userStatusTag');
  
  // Form buttons
  $('connectBtn').disabled = connected;
  $('disconnectBtn').disabled = !connected;
  $('updateBtn').disabled = !connected;

  // Preview elements
  const avatar = $('dpAvatar');
  const statusBadge = $('dpStatusBadge');
  const gName = $('dpGlobalName');
  const uName = $('dpUsername');

  if (connected && user) {
    badge.textContent = 'Connected';
    badge.className = 'status-connection-badge connected';
    
    const displayTag = `${user.username}#${user.discriminator || '0000'}`;
    tag.textContent = displayTag;

    // Discord Card details
    gName.textContent = user.global_name || user.username;
    uName.textContent = user.username;
    
    if (user.avatar) {
      avatar.innerHTML = `<img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.webp?size=128" alt="avatar">`;
    } else {
      avatar.textContent = (user.global_name || user.username)[0].toUpperCase();
      avatar.innerHTML = avatar.textContent;
    }

    // Set preview status shape based on platform
    updateStatusBadgeShape(rp.platform, true);
    
    // Set start epoch if not already running
    if (!startEpoch) startEpoch = Date.now();
  } else {
    badge.textContent = 'Disconnected';
    badge.className = 'status-connection-badge disconnected';
    tag.textContent = 'Disconnected';

    gName.textContent = 'Not connected';
    uName.textContent = 'Disconnected';
    avatar.innerHTML = '?';
    avatar.textContent = '?';
    
    updateStatusBadgeShape(null, false);
    startEpoch = null;
  }
}

function updateStatusBadgeShape(platform, isOnline) {
  const badge = $('dpStatusBadge');
  badge.className = 'dp-status-badge'; // reset

  if (!isOnline) {
    badge.classList.add('offline');
    return;
  }

  if (platform === 'mobile_android' || platform === 'mobile_ios') {
    badge.classList.add('mobile');
  } else {
    badge.classList.add('online');
  }
}

function toggleStreamUrl() {
  const typeSelect = $('actType');
  const streamInput = $('streamUrl');
  if (typeSelect.value === '1') {
    streamInput.removeAttribute('disabled');
  } else {
    streamInput.setAttribute('disabled', 'true');
    streamInput.value = '';
    rp.streamUrl = '';
  }
}

function toggleCustomTimestampFields() {
  const selectedMode = document.querySelector('input[name="tsMode"]:checked').value;
  const group = $('customTsGroup');
  if (selectedMode === 'custom') {
    group.style.display = 'flex';
  } else {
    group.style.display = 'none';
  }
}

/* ── LIVE PREVIEW & JSON GENERATOR ── */
function updatePreview() {
  // 1. Activity Label Header
  const typeVal = parseInt(rp.type);
  const header = $('dpActivityTypeHeader');
  header.textContent = TYPE_LABELS[typeVal] || 'PLAYING A GAME';

  // 2. Activity texts
  $('dpActName').textContent = rp.name || '—';
  $('dpActDetails').textContent = rp.details || '';
  $('dpActState').textContent = rp.state || '';

  // 3. Images update
  const $large = $('dpLargeImage');
  const $small = $('dpSmallImage');

  if (rp.largeUrl) {
    $large.innerHTML = `<img src="${rp.largeUrl}" alt="Large Asset" onerror="handleImageError(this)">`;
  } else {
    $large.innerHTML = `<div class="dp-image-placeholder">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="3"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <path d="M21 15l-5-5L5 21"></path>
      </svg>
    </div>`;
  }

  if (rp.smallUrl) {
    $small.style.display = 'block';
    $small.innerHTML = `<img src="${rp.smallUrl}" alt="Small Asset" onerror="this.style.display='none'">`;
  } else {
    $small.style.display = 'none';
    $small.innerHTML = '';
  }

  // 4. Buttons
  const btnsContainer = $('dpButtons');
  btnsContainer.innerHTML = '';
  if (rp.btn1Label) {
    btnsContainer.innerHTML += `<div class="dp-btn-mock">${esc(rp.btn1Label)}</div>`;
  }
  if (rp.btn2Label) {
    btnsContainer.innerHTML += `<div class="dp-btn-mock">${esc(rp.btn2Label)}</div>`;
  }

  // 5. Update timestamp
  updateTimerUI();

  // 6. Generate JSON representation
  generateJsonPayload();
}

function handleImageError(img) {
  const parent = img.parentElement;
  parent.innerHTML = `<div class="dp-image-placeholder">!</div>`;
}

function updateTimerUI() {
  const el = $('dpActTime');
  if (!rp.name || rp.tsMode === 'none') {
    el.textContent = '';
    return;
  }

  if (rp.tsMode === 'custom') {
    const startVal = $('customStartCheck').checked ? $('customStartVal').value : null;
    const endVal = $('customEndCheck').checked ? $('customEndVal').value : null;
    
    if (startVal && endVal) {
      const s = new Date(startVal).getTime();
      const e = new Date(endVal).getTime();
      const diff = e - s;
      el.textContent = formatTimeDiff(diff > 0 ? diff : 0) + ' remaining';
    } else if (startVal) {
      const s = new Date(startVal).getTime();
      const elapsed = Date.now() - s;
      el.textContent = formatTimeDiff(elapsed > 0 ? elapsed : 0) + ' elapsed';
    } else {
      el.textContent = '';
    }
    return;
  }

  // Standard modes
  if (!startEpoch) {
    el.textContent = '00:00 elapsed';
    return;
  }

  const elapsed = Date.now() - startEpoch;
  el.textContent = formatTimeDiff(elapsed) + ' elapsed';
}

function formatTimeDiff(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);

  if (h > 0) {
    return `${h}:${pad(m % 60)}:${pad(s % 60)}`;
  }
  return `${m}:${pad(s % 60)}`;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateJsonPayload() {
  if (!rp.name) {
    $('payloadJson').innerHTML = '<span class="jn">No activity configured</span>';
    return;
  }

  const activities = {
    type: parseInt(rp.type),
    name: rp.name,
    ...(rp.details && { details: rp.details }),
    ...(rp.state && { state: rp.state })
  };

  if (parseInt(rp.type) === 1 && rp.streamUrl) {
    activities.url = rp.streamUrl;
  }
  if (rp.appId) {
    activities.application_id = rp.appId;
  }

  if (rp.largeUrl || rp.smallUrl) {
    activities.assets = {};
    if (rp.largeUrl) {
      activities.assets.large_image = rp.largeUrl;
      if (rp.largeText) activities.assets.large_text = rp.largeText;
    }
    if (rp.smallUrl) {
      activities.assets.small_image = rp.smallUrl;
      if (rp.smallText) activities.assets.small_text = rp.smallText;
    }
  }

  const opPayload = {
    op: 3,
    d: {
      status: 'online',
      since: null,
      activities: [activities],
      afk: false
    }
  };

  $('payloadJson').innerHTML = syntaxHighlightJson(JSON.stringify(opPayload, null, 2));
}

function syntaxHighlightJson(json) {
  return json.replace(/("(\\u[\dA-Fa-f]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, match => {
    let cls = 'jnum';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'jk';
      } else {
        cls = 'js';
      }
    } else if (/true|false|null/.test(match)) {
      cls = 'jb';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

/* ── UI TOAST NOTIFICATION ── */
function showToast(msg, type = 'info') {
  const toast = $('toastNotification');
  toast.textContent = msg;
  toast.className = `toast-notif show ${type}`;
  
  clearTimeout(toast._timeoutId);
  toast._timeoutId = setTimeout(() => {
    toast.className = 'toast-notif';
  }, 3000);
}

/* ── DEBOUNCED UPDATE TO PREVENT GATEWAY RATE LIMITS ── */
let debounceTimer = null;
function queuePresenceUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    sendToServer({
      type: 'update_rp',
      data: { ...rp }
    });
  }, 650);
}

/* ── INIT EVENT LISTENERS ── */
function init() {
  // Connect/Disconnect triggers
  $('connectBtn').onclick = () => {
    const t = $('tokenInput').value.trim();
    if (!t) {
      showToast('Please enter a valid user token.', 'error');
      return;
    }
    rp.token = t;
    sendToServer({ type: 'connect_gateway', token: t });
    showToast('Connecting to Discord Gateway...', 'info');
  };

  $('disconnectBtn').onclick = () => {
    sendToServer({ type: 'disconnect_gateway' });
    showToast('Disconnecting...', 'info');
  };

  $('updateBtn').onclick = () => {
    sendToServer({ type: 'update_rp', data: { ...rp } });
    showToast('Presence update request sent.', 'info');
  };

  // Toggle token visibility
  $('toggleTokenVisibility').onclick = () => {
    const inp = $('tokenInput');
    const svg = $('toggleTokenVisibility').querySelector('svg');
    if (inp.type === 'password') {
      inp.type = 'text';
      svg.style.color = 'var(--text-primary)';
    } else {
      inp.type = 'password';
      svg.style.color = 'var(--text-muted)';
    }
  };

  // Setup form field key/change bindings
  const formFields = [
    ['appId', 'appId'],
    ['actName', 'name'],
    ['actDetails', 'details'],
    ['actState', 'state'],
    ['streamUrl', 'streamUrl'],
    ['partySize', 'partySize'],
    ['partyMax', 'partyMax'],
    ['largeKey', 'largeKey'],
    ['largeText', 'largeText'],
    ['largeUrl', 'largeUrl'],
    ['smallKey', 'smallKey'],
    ['smallText', 'smallText'],
    ['smallUrl', 'smallUrl'],
    ['btn1Label', 'btn1Label'],
    ['btn1Url', 'btn1Url'],
    ['btn2Label', 'btn2Label'],
    ['btn2Url', 'btn2Url']
  ];

  formFields.forEach(([domId, rpKey]) => {
    const el = $(domId);
    if (!el) return;
    el.oninput = e => {
      rp[rpKey] = e.target.value;
      updatePreview();
      if (gwConnected) queuePresenceUpdate();
    };
  });

  // Select bindings
  $('actType').onchange = e => {
    rp.type = parseInt(e.target.value);
    toggleStreamUrl();
    updatePreview();
    if (gwConnected) queuePresenceUpdate();
  };

  $('platform').onchange = e => {
    rp.platform = e.target.value;
    updateStatusBadgeShape(rp.platform, gwConnected);
    updatePreview();
    if (gwConnected) {
      // Platform changes require gateway reconnect to update the identify properties
      showToast('Reconnecting gateway to apply platform spoof...', 'info');
      sendToServer({ type: 'connect_gateway', token: rp.token });
    }
  };

  // Radio button binding
  document.querySelectorAll('input[name="tsMode"]').forEach(radio => {
    radio.onchange = e => {
      rp.tsMode = e.target.value;
      toggleCustomTimestampFields();
      updatePreview();
      if (gwConnected) queuePresenceUpdate();
    };
  });

  // Custom timestamps check and input triggers
  const customInputs = ['customStartCheck', 'customStartVal', 'customEndCheck', 'customEndVal'];
  customInputs.forEach(id => {
    const el = $(id);
    if (!el) return;
    el.onchange = el.oninput = () => {
      // Sync status
      $('customStartVal').disabled = !$('customStartCheck').checked;
      $('customEndVal').disabled = !$('customEndCheck').checked;

      rp.customStart = $('customStartCheck').checked ? $('customStartVal').value : '';
      rp.customEnd = $('customEndCheck').checked ? $('customEndVal').value : '';

      updatePreview();
      if (gwConnected) queuePresenceUpdate();
    };
  });

  // Keep online checkbox listener
  const keepOnlineEl = $('keepOnline');
  if (keepOnlineEl) {
    keepOnlineEl.onchange = e => {
      rp.keepOnline = e.target.checked;
      if (gwConnected) queuePresenceUpdate();
    };
  }

  // Start connection
  connectServer();

  // Keep mockup elapsed timer ticking
  timerInterval = setInterval(updateTimerUI, 1000);
}

document.addEventListener('DOMContentLoaded', init);
