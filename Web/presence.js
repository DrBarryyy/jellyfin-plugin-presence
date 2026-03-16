(function () {
    'use strict';

    var HEARTBEAT_INTERVAL = 10000;
    var IDLE_TIMEOUT = 120000;
    var RECONNECT_DELAY = 5000;
    var API_BASE = window.location.origin + '/api/Presence';

    var lastActivity = Date.now();
    var currentUsers = [];
    var sidebarOpen = false;
    var heartbeatTimer = null;
    var sseController = null;

    // ── Auth ──

    function getCredentials() {
        try {
            var creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            var server = (creds.Servers || [])[0];
            if (!server) return null;
            return {
                token: server.AccessToken,
                userId: server.UserId,
                serverId: server.Id
            };
        } catch (e) {
            return null;
        }
    }

    function getHeaders() {
        var creds = getCredentials();
        if (!creds || !creds.token) return null;
        return {
            'Authorization': 'MediaBrowser Token="' + creds.token + '"',
            'Content-Type': 'application/json'
        };
    }

    // ── Activity Tracking ──

    var activityEvents = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    activityEvents.forEach(function (evt) {
        document.addEventListener(evt, function () {
            lastActivity = Date.now();
        }, { passive: true });
    });

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) {
            lastActivity = Date.now();
        }
    });

    // ── Heartbeat ──

    function sendHeartbeat() {
        var headers = getHeaders();
        if (!headers) return;

        var isActive = !document.hidden && (Date.now() - lastActivity < IDLE_TIMEOUT);

        fetch(API_BASE + '/Heartbeat', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ IsActive: isActive })
        }).catch(function () { });
    }

    // ── SSE Stream (using fetch + ReadableStream for auth header support) ──

    function connectSSE() {
        var headers = getHeaders();
        if (!headers) {
            setTimeout(connectSSE, RECONNECT_DELAY);
            return;
        }

        if (sseController) {
            sseController.abort();
        }

        sseController = new AbortController();

        fetch(API_BASE + '/Events', {
            headers: headers,
            signal: sseController.signal
        }).then(function (response) {
            if (!response.ok || !response.body) {
                throw new Error('SSE connection failed');
            }

            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            function read() {
                reader.read().then(function (result) {
                    if (result.done) {
                        setTimeout(connectSSE, RECONNECT_DELAY);
                        return;
                    }

                    buffer += decoder.decode(result.value, { stream: true });
                    var lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    lines.forEach(function (line) {
                        if (line.startsWith('data: ')) {
                            try {
                                currentUsers = JSON.parse(line.substring(6));
                                renderUsers();
                            } catch (e) { }
                        }
                    });

                    read();
                }).catch(function () {
                    setTimeout(connectSSE, RECONNECT_DELAY);
                });
            }

            read();
        }).catch(function () {
            setTimeout(connectSSE, RECONNECT_DELAY);
        });
    }

    // ── Initial Fetch ──

    function fetchUsers() {
        var headers = getHeaders();
        if (!headers) return;

        fetch(API_BASE + '/Users', { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                currentUsers = data;
                renderUsers();
            })
            .catch(function () { });
    }

    // ── UI ──

    function injectStyles() {
        var style = document.createElement('style');
        style.textContent = '\
#presence-sidebar {\
    position: fixed;\
    left: 0;\
    top: 0;\
    bottom: 0;\
    width: 240px;\
    background: rgba(16, 16, 20, 0.95);\
    border-right: 1px solid rgba(255, 255, 255, 0.08);\
    z-index: 99999;\
    transform: translateX(-100%);\
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);\
    display: flex;\
    flex-direction: column;\
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\
    color: #e0e0e0;\
    box-shadow: 2px 0 12px rgba(0, 0, 0, 0.4);\
    backdrop-filter: blur(12px);\
}\
#presence-sidebar.open {\
    transform: translateX(0);\
}\
#presence-header {\
    display: flex;\
    align-items: center;\
    justify-content: space-between;\
    padding: 16px;\
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);\
    font-size: 14px;\
    font-weight: 600;\
    letter-spacing: 0.5px;\
    text-transform: uppercase;\
    color: #aaa;\
}\
#presence-close {\
    background: none;\
    border: none;\
    color: #888;\
    cursor: pointer;\
    font-size: 18px;\
    padding: 0 4px;\
    line-height: 1;\
}\
#presence-close:hover {\
    color: #fff;\
}\
#presence-list {\
    flex: 1;\
    overflow-y: auto;\
    padding: 8px 0;\
}\
.presence-group {\
    padding: 0 0 8px 0;\
}\
.presence-group-label {\
    padding: 8px 16px 4px;\
    font-size: 11px;\
    font-weight: 600;\
    text-transform: uppercase;\
    letter-spacing: 0.8px;\
    color: #666;\
}\
.presence-user {\
    display: flex;\
    align-items: center;\
    padding: 6px 16px;\
    gap: 10px;\
    transition: background 0.15s;\
}\
.presence-user:hover {\
    background: rgba(255, 255, 255, 0.05);\
}\
.presence-avatar-wrap {\
    position: relative;\
    flex-shrink: 0;\
    width: 32px;\
    height: 32px;\
}\
.presence-avatar {\
    width: 32px;\
    height: 32px;\
    border-radius: 50%;\
    background: #333;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    font-size: 13px;\
    font-weight: 600;\
    color: #ccc;\
    overflow: hidden;\
}\
.presence-avatar img {\
    width: 100%;\
    height: 100%;\
    object-fit: cover;\
}\
.presence-initial {\
    width: 100%;\
    height: 100%;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
}\
.presence-dot {\
    position: absolute;\
    bottom: -1px;\
    right: -1px;\
    width: 10px;\
    height: 10px;\
    border-radius: 50%;\
    border: 2px solid rgba(16, 16, 20, 0.95);\
    z-index: 1;\
}\
.presence-dot.online {\
    background: #43b581;\
}\
.presence-dot.idle {\
    background: #faa61a;\
}\
.presence-dot.offline {\
    background: #555;\
}\
.presence-dot.donotdisturb {\
    background: #ed4245;\
}\
.presence-user.is-self {\
    cursor: pointer;\
}\
.presence-user.is-self:hover {\
    background: rgba(255, 255, 255, 0.08);\
}\
.presence-name {\
    font-size: 14px;\
    white-space: nowrap;\
    overflow: hidden;\
    text-overflow: ellipsis;\
}\
.presence-name.offline {\
    color: #666;\
}\
#presence-toggle {\
    position: fixed;\
    left: 12px;\
    bottom: 20px;\
    z-index: 99998;\
    width: 42px;\
    height: 42px;\
    border-radius: 50%;\
    background: rgba(30, 30, 36, 0.9);\
    border: 1px solid rgba(255, 255, 255, 0.1);\
    color: #ccc;\
    cursor: pointer;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    transition: all 0.25s;\
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);\
    backdrop-filter: blur(8px);\
}\
#presence-toggle:hover {\
    background: rgba(50, 50, 60, 0.95);\
    color: #fff;\
    border-color: rgba(255, 255, 255, 0.2);\
}\
#presence-toggle svg {\
    width: 20px;\
    height: 20px;\
    fill: currentColor;\
}\
#presence-toggle .presence-badge {\
    position: absolute;\
    top: -2px;\
    right: -2px;\
    min-width: 16px;\
    height: 16px;\
    border-radius: 8px;\
    background: #43b581;\
    color: #fff;\
    font-size: 10px;\
    font-weight: 700;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    padding: 0 4px;\
}\
';
        document.head.appendChild(style);
    }

    function createSidebar() {
        if (document.getElementById('presence-sidebar')) return;
        injectStyles();

        // Toggle button
        var toggle = document.createElement('button');
        toggle.id = 'presence-toggle';
        toggle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>'
            + '<span class="presence-badge" id="presence-badge">0</span>';
        document.body.appendChild(toggle);

        // Sidebar
        var sidebar = document.createElement('div');
        sidebar.id = 'presence-sidebar';

        var header = document.createElement('div');
        header.id = 'presence-header';
        header.innerHTML = '<span>Users</span>';
        var closeBtn = document.createElement('button');
        closeBtn.id = 'presence-close';
        closeBtn.textContent = '\u2715';
        closeBtn.addEventListener('click', function () {
            sidebarOpen = false;
            sidebar.classList.remove('open');
        });
        header.appendChild(closeBtn);

        var list = document.createElement('div');
        list.id = 'presence-list';

        sidebar.appendChild(header);
        sidebar.appendChild(list);
        document.body.appendChild(sidebar);

        toggle.addEventListener('click', function () {
            sidebarOpen = !sidebarOpen;
            sidebar.classList.toggle('open', sidebarOpen);
        });
    }

    function renderUsers() {
        var list = document.getElementById('presence-list');
        if (!list) return;

        var creds = getCredentials();
        var myUserId = creds ? creds.userId : null;

        var groups = { Online: [], Idle: [], DoNotDisturb: [], Offline: [] };
        currentUsers.forEach(function (user) {
            groups[user.State] = groups[user.State] || [];
            groups[user.State].push(user);
        });

        var onlineCount = (groups.Online || []).length + (groups.Idle || []).length + (groups.DoNotDisturb || []).length;
        var badge = document.getElementById('presence-badge');
        if (badge) {
            badge.textContent = onlineCount;
            badge.style.display = onlineCount > 0 ? 'flex' : 'none';
        }

        var stateLabels = { Online: 'Online', Idle: 'Idle', DoNotDisturb: 'Do Not Disturb', Offline: 'Offline' };
        var html = '';
        var order = ['Online', 'Idle', 'DoNotDisturb', 'Offline'];
        order.forEach(function (state) {
            var users = groups[state] || [];
            if (users.length === 0) return;

            html += '<div class="presence-group">';
            html += '<div class="presence-group-label">' + stateLabels[state] + ' \u2014 ' + users.length + '</div>';
            users.forEach(function (user) {
                var initial = (user.Username || '?')[0].toUpperCase();
                var stateClass = state.toLowerCase();
                var isSelf = myUserId && user.UserId.replace(/-/g, '') === myUserId.replace(/-/g, '');
                var imgUrl = window.location.origin + '/Users/' + user.UserId + '/Images/Primary?quality=90&height=64';
                var avatarContent = '<img src="' + imgUrl + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">'
                    + '<span class="presence-initial" style="display:none">' + initial + '</span>';
                html += '<div class="presence-user' + (isSelf ? ' is-self' : '') + '" data-userid="' + user.UserId + '">'
                    + '<div class="presence-avatar-wrap">'
                    + '<div class="presence-avatar">' + avatarContent + '</div>'
                    + '<span class="presence-dot ' + stateClass + '"></span>'
                    + '</div>'
                    + '<span class="presence-name ' + stateClass + '">' + escapeHtml(user.Username) + '</span>'
                    + '</div>';
            });
            html += '</div>';
        });

        list.innerHTML = html;

        // Click own profile to toggle DND
        list.querySelectorAll('.presence-user.is-self').forEach(function (el) {
            el.addEventListener('click', function () {
                var headers = getHeaders();
                if (!headers) return;
                // Check current state from the dot
                var dot = el.querySelector('.presence-dot');
                var isDnd = dot && dot.classList.contains('donotdisturb');
                fetch(API_BASE + '/Dnd', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ Enabled: !isDnd })
                }).catch(function () {});
            });
        });
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Playback Visibility ──

    function watchPlayback() {
        var toggle = document.getElementById('presence-toggle');
        var sidebar = document.getElementById('presence-sidebar');

        var observer = new MutationObserver(function () {
            var playing = document.querySelector('.videoPlayerContainer, video, .htmlvideoplayer');
            var isFullscreen = document.fullscreenElement || document.querySelector('.itemVideo');
            var hide = !!(playing || isFullscreen);

            if (toggle) toggle.style.display = hide ? 'none' : '';
            if (sidebar && hide) {
                sidebar.classList.remove('open');
                sidebarOpen = false;
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        document.addEventListener('fullscreenchange', function () {
            var hide = !!document.fullscreenElement;
            if (toggle) toggle.style.display = hide ? 'none' : '';
            if (sidebar && hide) {
                sidebar.classList.remove('open');
                sidebarOpen = false;
            }
        });
    }

    // ── Init ──

    function init() {
        var creds = getCredentials();
        if (!creds || !creds.token) {
            setTimeout(init, 2000);
            return;
        }

        createSidebar();
        watchPlayback();
        sendHeartbeat();
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
        // Fetch users after heartbeat has registered us
        setTimeout(fetchUsers, 1000);
        connectSSE();
    }

    if (window.__presenceInitialized) return;
    window.__presenceInitialized = true;

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('DOMContentLoaded', function () {
            setTimeout(init, 500);
        });
    }
})();
