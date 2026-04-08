(function () {
    'use strict';

    // ── Auth ──
    function getAuth() {
        try {
            var raw = localStorage.getItem('jellyfin_credentials');
            if (!raw) return null;
            var creds = JSON.parse(raw);
            var server = creds.Servers && creds.Servers[0];
            if (!server || !server.AccessToken) return null;
            return {
                token: server.AccessToken,
                userId: server.UserId,
                serverId: server.Id,
                headers: {
                    'Authorization': 'MediaBrowser Token="' + server.AccessToken + '", Client="Jellyfin Web", Device="Browser", DeviceId="presence-requests", Version="1.0.0"',
                    'Content-Type': 'application/json'
                }
            };
        } catch (e) {
            return null;
        }
    }

    // ── State ──
    var overlayEl = null;
    var searchTimeout = null;
    var currentRequests = [];

    // ── API ──
    function apiGet(path, cb) {
        var auth = getAuth();
        if (!auth) return;
        fetch(path, { headers: auth.headers, cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(cb)
            .catch(function (e) { console.error('[Requests]', e); });
    }

    function apiPost(path, body, cb) {
        var auth = getAuth();
        if (!auth) return;
        fetch(path, { method: 'POST', headers: auth.headers, body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .then(cb)
            .catch(function (e) { console.error('[Requests]', e); });
    }

    function apiDelete(path, cb) {
        var auth = getAuth();
        if (!auth) return;
        fetch(path, { method: 'DELETE', headers: auth.headers })
            .then(function () { cb && cb(); })
            .catch(function (e) { console.error('[Requests]', e); });
    }

    function searchTmdb(query, type, cb) {
        var auth = getAuth();
        if (!auth) return;
        fetch('/api/Requests/Search?query=' + encodeURIComponent(query) + '&type=' + encodeURIComponent(type), { headers: auth.headers })
            .then(function (r) { return r.json(); })
            .then(cb)
            .catch(function (e) { console.error('[Requests]', e); });
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getPosterUrl(path, jellyfinItemId) {
        // Use Jellyfin's local image for items already in the library
        if (jellyfinItemId) {
            return '/Items/' + encodeURIComponent(jellyfinItemId) + '/Images/Primary?maxWidth=200';
        }
        if (!path) return '';
        // Proxy through plugin backend to cache and avoid TMDB rate limits
        return '/api/Requests/Poster?url=' + encodeURIComponent(path);
    }

    // Fetch poster via authenticated request and set as blob URL
    function loadAuthPoster(img) {
        var src = img.getAttribute('data-poster-url');
        if (!src) return;
        var auth = getAuth();
        if (!auth) return;
        fetch(src, { headers: auth.headers })
            .then(function (r) {
                if (!r.ok) throw new Error(r.status);
                return r.blob();
            })
            .then(function (blob) {
                img.src = URL.createObjectURL(blob);
            })
            .catch(function () {
                img.style.display = 'none';
            });
    }

    function loadAllAuthPosters(container) {
        if (!container) return;
        container.querySelectorAll('img[data-poster-url]').forEach(loadAuthPoster);
    }

    // ── Styles ──
    function injectStyles() {
        if (document.getElementById('presence-requests-styles')) return;
        var style = document.createElement('style');
        style.id = 'presence-requests-styles';
        style.textContent = '\
.req-nav-btn {\
    background: none;\
    border: none;\
    color: rgba(255,255,255,0.8);\
    cursor: pointer;\
    font-size: 14px;\
    padding: 8px 12px;\
    font-weight: 500;\
    transition: color 0.2s;\
    font-family: inherit;\
}\
.req-nav-btn:hover { color: #fff; }\
.req-overlay {\
    position: fixed;\
    top: 0; left: 0; right: 0; bottom: 0;\
    background: #101010;\
    z-index: 99999;\
    display: flex;\
    flex-direction: column;\
    overflow: hidden;\
}\
.req-header {\
    display: flex;\
    align-items: center;\
    justify-content: space-between;\
    padding: 16px 24px;\
    border-bottom: 1px solid #333;\
    flex-shrink: 0;\
}\
.req-header h2 {\
    margin: 0;\
    color: #fff;\
    font-size: 22px;\
    font-weight: 600;\
}\
.req-close-btn {\
    background: none;\
    border: none;\
    color: #aaa;\
    font-size: 28px;\
    cursor: pointer;\
    padding: 4px 8px;\
    line-height: 1;\
}\
.req-close-btn:hover { color: #fff; }\
.req-body {\
    flex: 1;\
    overflow-y: auto;\
    padding: 24px;\
}\
.req-search-bar {\
    display: flex;\
    gap: 10px;\
    margin-bottom: 24px;\
    align-items: center;\
}\
.req-search-input {\
    flex: 1;\
    background: #1a1a1a;\
    border: 1px solid #444;\
    color: #fff;\
    padding: 10px 14px;\
    border-radius: 6px;\
    font-size: 15px;\
    outline: none;\
    font-family: inherit;\
}\
.req-search-input:focus { border-color: #00a4dc; }\
.req-search-input::placeholder { color: #777; }\
.req-type-select {\
    background: #1a1a1a;\
    border: 1px solid #444;\
    color: #fff;\
    padding: 10px 12px;\
    border-radius: 6px;\
    font-size: 14px;\
    outline: none;\
    cursor: pointer;\
    font-family: inherit;\
}\
.req-section-title {\
    color: #aaa;\
    font-size: 13px;\
    text-transform: uppercase;\
    letter-spacing: 1px;\
    margin: 24px 0 12px;\
    font-weight: 600;\
}\
.req-grid {\
    display: grid;\
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));\
    gap: 16px;\
}\
.req-card {\
    background: #1a1a1a;\
    border-radius: 8px;\
    overflow: hidden;\
    display: flex;\
    border: 1px solid #2a2a2a;\
    transition: border-color 0.2s;\
}\
.req-card:hover { border-color: #444; }\
.req-card-poster {\
    width: 100px;\
    min-height: 150px;\
    background: #252525;\
    flex-shrink: 0;\
    object-fit: cover;\
}\
.req-card-poster-placeholder {\
    width: 100px;\
    min-height: 150px;\
    background: #252525;\
    flex-shrink: 0;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    color: #555;\
    font-size: 32px;\
}\
.req-card-info {\
    padding: 12px;\
    flex: 1;\
    display: flex;\
    flex-direction: column;\
    min-width: 0;\
}\
.req-card-title {\
    color: #fff;\
    font-size: 15px;\
    font-weight: 600;\
    margin: 0 0 4px;\
    overflow: hidden;\
    text-overflow: ellipsis;\
    white-space: nowrap;\
}\
.req-card-year {\
    color: #888;\
    font-size: 13px;\
    margin: 0 0 6px;\
}\
.req-card-overview {\
    color: #999;\
    font-size: 12px;\
    line-height: 1.4;\
    margin: 0 0 10px;\
    overflow: hidden;\
    display: -webkit-box;\
    -webkit-line-clamp: 3;\
    -webkit-box-orient: vertical;\
    flex: 1;\
}\
.req-card-actions {\
    display: flex;\
    gap: 8px;\
    align-items: center;\
    flex-wrap: wrap;\
}\
.req-btn {\
    padding: 6px 14px;\
    border: none;\
    border-radius: 4px;\
    cursor: pointer;\
    font-size: 13px;\
    font-weight: 500;\
    transition: opacity 0.2s;\
    font-family: inherit;\
}\
.req-btn:hover { opacity: 0.85; }\
.req-btn:disabled { opacity: 0.5; cursor: default; }\
.req-btn-primary { background: #00a4dc; color: #fff; }\
.req-btn-danger { background: #cf3030; color: #fff; }\
.req-btn-link { background: #2a6e2a; color: #fff; }\
.req-badge {\
    display: inline-block;\
    padding: 3px 8px;\
    border-radius: 3px;\
    font-size: 11px;\
    font-weight: 600;\
    text-transform: uppercase;\
}\
.req-badge-pending { background: #8a6d1b; color: #ffd666; }\
.req-badge-available { background: #1b6b3a; color: #52c41a; }\
.req-card-user {\
    color: #777;\
    font-size: 12px;\
    margin-bottom: 6px;\
    display: flex;\
    align-items: center;\
    gap: 6px;\
}\
.req-card-user-avatar {\
    width: 18px;\
    height: 18px;\
    border-radius: 50%;\
    object-fit: cover;\
    flex-shrink: 0;\
    background: #333;\
}\
.req-empty {\
    color: #666;\
    text-align: center;\
    padding: 40px 20px;\
    font-size: 15px;\
}\
.req-search-results-title {\
    color: #ccc;\
    font-size: 14px;\
    margin: 0 0 12px;\
    font-weight: 500;\
}\
.req-loading {\
    color: #888;\
    text-align: center;\
    padding: 20px;\
}\
.req-error {\
    color: #cf3030;\
    margin: 8px 0;\
    font-size: 13px;\
}\
';
        document.head.appendChild(style);
    }

    // ── Nav Button ──
    function injectNavButton() {
        // Already injected — nothing to do
        if (document.querySelector('.req-nav-btn')) return;

        var headerRight = document.querySelector('.headerRight');
        if (!headerRight) return;

        var btn = document.createElement('button');
        btn.className = 'req-nav-btn';
        btn.textContent = 'Requests';
        btn.title = 'Media Requests';
        btn.addEventListener('click', function () {
            openOverlay();
        });

        headerRight.insertBefore(btn, headerRight.firstChild);
    }

    // ── Overlay ──
    function openOverlay() {
        if (overlayEl) return;
        injectStyles();

        overlayEl = document.createElement('div');
        overlayEl.className = 'req-overlay';
        overlayEl.innerHTML = '\
<div class="req-header">\
    <h2>Media Requests</h2>\
    <button class="req-close-btn">&times;</button>\
</div>\
<div class="req-body">\
    <div class="req-search-bar">\
        <input class="req-search-input" type="text" placeholder="Search TMDB for movies or shows..." />\
        <select class="req-type-select">\
            <option value="movie">Movie</option>\
            <option value="tv">TV Show</option>\
        </select>\
    </div>\
    <div id="req-search-results"></div>\
    <div id="req-list"></div>\
</div>';

        document.body.appendChild(overlayEl);

        // Close button
        overlayEl.querySelector('.req-close-btn').addEventListener('click', closeOverlay);

        // Search
        var searchInput = overlayEl.querySelector('.req-search-input');
        var typeSelect = overlayEl.querySelector('.req-type-select');

        function doSearch() {
            var q = searchInput.value.trim();
            if (q.length < 2) {
                document.getElementById('req-search-results').innerHTML = '';
                return;
            }
            document.getElementById('req-search-results').innerHTML = '<div class="req-loading">Searching...</div>';
            searchTmdb(q, typeSelect.value, function (results) {
                if (!results || results.length === 0) {
                    renderSearchResults(results, {});
                    return;
                }
                var checkItems = results.map(function (r) { return { tmdbId: r.tmdbId, mediaType: r.mediaType }; });
                apiPost('/api/Requests/CheckLibrary', checkItems, function (libraryMap) {
                    renderSearchResults(results, libraryMap || {});
                });
            });
        }

        searchInput.addEventListener('input', function () {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(doSearch, 400);
        });
        typeSelect.addEventListener('change', function () {
            if (searchInput.value.trim().length >= 2) doSearch();
        });

        // Escape key
        overlayEl._keyHandler = function (e) {
            if (e.key === 'Escape') closeOverlay();
        };
        document.addEventListener('keydown', overlayEl._keyHandler);

        // Load requests
        loadRequests();
    }

    function closeOverlay() {
        if (!overlayEl) return;
        document.removeEventListener('keydown', overlayEl._keyHandler);
        overlayEl.remove();
        overlayEl = null;
    }

    // ── Search Results ──
    function renderSearchResults(results, libraryMap) {
        var container = document.getElementById('req-search-results');
        if (!container) return;

        if (!results || results.length === 0) {
            container.innerHTML = '<div class="req-empty">No results found</div>';
            return;
        }

        var html = '<div class="req-search-results-title">Search Results</div><div class="req-grid">';
        for (var i = 0; i < results.length && i < 12; i++) {
            var r = results[i];
            var inLibrary = libraryMap && libraryMap[r.tmdbId];
            var posterUrl = inLibrary ? getPosterUrl(r.posterPath, libraryMap[r.tmdbId]) : getPosterUrl(r.posterPath);
            var alreadyRequested = currentRequests.some(function (req) { return req.tmdbId === r.tmdbId; });

            html += '<div class="req-card">';
            if (posterUrl) {
                if (inLibrary) {
                    html += '<img class="req-card-poster" src="' + escapeHtml(posterUrl) + '" alt="" loading="lazy" />';
                } else {
                    html += '<img class="req-card-poster" data-poster-url="' + escapeHtml(posterUrl) + '" alt="" />';
                }
            } else {
                html += '<div class="req-card-poster-placeholder">?</div>';
            }
            html += '<div class="req-card-info">';
            html += '<p class="req-card-title" title="' + escapeHtml(r.title) + '">' + escapeHtml(r.title) + '</p>';
            if (r.year) html += '<p class="req-card-year">' + escapeHtml(r.year) + ' &middot; ' + escapeHtml(r.mediaType) + '</p>';
            if (r.overview) html += '<p class="req-card-overview">' + escapeHtml(r.overview) + '</p>';
            html += '<div class="req-card-actions">';
            if (inLibrary) {
                html += '<span class="req-badge req-badge-available">Already Available</span>';
                html += ' <a class="req-btn req-btn-link req-view-link" href="/web/#/details?id=' + escapeHtml(libraryMap[r.tmdbId]) + '">View in Jellyfin</a>';
            } else if (alreadyRequested) {
                html += '<span class="req-badge req-badge-pending">Already Requested</span>';
            } else {
                html += '<button class="req-btn req-btn-primary" data-tmdb="' + escapeHtml(btoa(unescape(encodeURIComponent(JSON.stringify(r))))) + '">Request</button>';
            }
            html += '</div></div></div>';
        }
        html += '</div>';
        container.innerHTML = html;
        loadAllAuthPosters(container);

        // Close overlay when navigating to Jellyfin item
        container.querySelectorAll('.req-view-link').forEach(function (link) {
            link.addEventListener('click', function () { closeOverlay(); });
        });

        // Bind request buttons
        container.querySelectorAll('.req-btn-primary[data-tmdb]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var data = JSON.parse(decodeURIComponent(escape(atob(btn.getAttribute('data-tmdb')))));
                btn.disabled = true;
                btn.textContent = 'Requesting...';
                apiPost('/api/Requests', data, function (result) {
                    if (result && result.message) {
                        // Conflict/error
                        btn.textContent = result.message;
                        btn.disabled = true;
                    } else {
                        btn.textContent = 'Requested!';
                        btn.disabled = true;
                        loadRequests();
                    }
                });
            });
        });
    }

    // ── Request List ──
    function normalizeKeys(obj) {
        if (Array.isArray(obj)) return obj.map(normalizeKeys);
        if (obj && typeof obj === 'object') {
            var out = {};
            for (var k in obj) {
                if (obj.hasOwnProperty(k)) {
                    out[k.charAt(0).toLowerCase() + k.slice(1)] = obj[k];
                }
            }
            return out;
        }
        return obj;
    }

    function loadRequests() {
        apiGet('/api/Requests', function (requests) {
            currentRequests = normalizeKeys(requests || []);
            renderRequests();
        });
    }

    function renderRequests() {
        var container = document.getElementById('req-list');
        if (!container) return;

        var auth = getAuth();
        var myUserId = auth ? auth.userId : null;

        var pending = currentRequests.filter(function (r) { return r.status === 'pending'; });
        var available = currentRequests.filter(function (r) { return r.status === 'available'; });

        var html = '';

        if (pending.length === 0 && available.length === 0) {
            html = '<div class="req-empty">No requests yet. Search for something above!</div>';
            container.innerHTML = html;
            return;
        }

        if (pending.length > 0) {
            html += '<div class="req-section-title">Pending (' + pending.length + ')</div>';
            html += '<div class="req-grid">';
            pending.forEach(function (r) { html += renderRequestCard(r, myUserId); });
            html += '</div>';
        }

        if (available.length > 0) {
            html += '<div class="req-section-title">Available (' + available.length + ')</div>';
            html += '<div class="req-grid">';
            available.forEach(function (r) { html += renderRequestCard(r, myUserId); });
            html += '</div>';
        }

        container.innerHTML = html;
        loadAllAuthPosters(container);

        // Close overlay when navigating to Jellyfin item
        container.querySelectorAll('.req-view-link').forEach(function (link) {
            link.addEventListener('click', function () { closeOverlay(); });
        });

        // Bind delete buttons
        container.querySelectorAll('.req-delete-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                btn.disabled = true;
                btn.textContent = 'Deleting...';
                apiDelete('/api/Requests/' + id, function () {
                    loadRequests();
                });
            });
        });
    }

    function renderRequestCard(r, myUserId) {
        var posterUrl = getPosterUrl(r.posterPath, r.jellyfinItemId);
        var isLocal = !!r.jellyfinItemId;

        var html = '<div class="req-card">';
        if (posterUrl) {
            if (isLocal) {
                html += '<img class="req-card-poster" src="' + escapeHtml(posterUrl) + '" alt="" loading="lazy" />';
            } else {
                html += '<img class="req-card-poster" data-poster-url="' + escapeHtml(posterUrl) + '" alt="" />';
            }
        } else {
            html += '<div class="req-card-poster-placeholder">?</div>';
        }
        html += '<div class="req-card-info">';
        html += '<p class="req-card-title" title="' + escapeHtml(r.title) + '">' + escapeHtml(r.title) + '</p>';
        if (r.year) html += '<p class="req-card-year">' + escapeHtml(r.year) + (r.mediaType ? ' &middot; ' + escapeHtml(r.mediaType) : '') + '</p>';
        var avatarUrl = '/Users/' + encodeURIComponent(r.userId) + '/Images/Primary?maxWidth=36';
        html += '<p class="req-card-user"><img class="req-card-user-avatar" src="' + escapeHtml(avatarUrl) + '" alt="" onerror="this.style.display=\'none\'" />Requested by ' + escapeHtml(r.username) + '</p>';
        if (r.overview) html += '<p class="req-card-overview">' + escapeHtml(r.overview) + '</p>';
        html += '<div class="req-card-actions">';

        if (r.status === 'available') {
            html += '<span class="req-badge req-badge-available">Available</span>';
            if (r.jellyfinItemId) {
                html += ' <a class="req-btn req-btn-link req-view-link" href="/web/#/details?id=' + escapeHtml(r.jellyfinItemId) + '">View in Jellyfin</a>';
            }
        } else {
            html += '<span class="req-badge req-badge-pending">Pending</span>';
        }

        if (r.userId && myUserId && r.userId.replace(/-/g, '') === myUserId.replace(/-/g, '')) {
            html += ' <button class="req-btn req-btn-danger req-delete-btn" data-id="' + escapeHtml(r.id) + '">Delete</button>';
        }

        html += '</div></div></div>';
        return html;
    }

    // ── Init ──
    function init() {
        injectStyles();
        injectNavButton();

        // Re-inject nav button on SPA navigation
        var navObserver = new MutationObserver(function () {
            if (!document.querySelector('.req-nav-btn')) {
                injectNavButton();
            }
        });
        navObserver.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
