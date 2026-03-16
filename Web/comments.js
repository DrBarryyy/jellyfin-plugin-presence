(function () {
    'use strict';

    var API_BASE = window.location.origin;
    var currentMediaId = null;
    var currentPositionTicks = 0;
    var playerActive = false;
    var commentsInjected = false;
    var pendingMediaId = null;

    // ── Auth ──

    function getCredentials() {
        try {
            var creds = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
            var server = (creds.Servers || [])[0];
            if (!server) return null;
            return { token: server.AccessToken, userId: server.UserId };
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

    // ── Helpers ──

    function ticksToTimestamp(ticks) {
        var totalSeconds = Math.floor(ticks / 10000000);
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        if (hours > 0) {
            return hours + ':' + pad(minutes) + ':' + pad(seconds);
        }
        return minutes + ':' + pad(seconds);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Styles ──

    function injectStyles() {
        if (document.getElementById('comments-styles')) return;
        var style = document.createElement('style');
        style.id = 'comments-styles';
        style.textContent = '\
.comments-player-layout {\
    position: fixed;\
    top: 0;\
    left: 0;\
    right: 0;\
    bottom: 0;\
    z-index: 99997;\
    background: #101010;\
    display: flex;\
    flex-direction: column;\
    overflow: hidden;\
}\
.comments-video-section {\
    width: 100%;\
    background: #000;\
    position: relative;\
    flex-shrink: 0;\
}\
.comments-video-section video {\
    width: 100%;\
    height: 100%;\
    object-fit: contain;\
}\
.comments-content-section {\
    flex: 1;\
    overflow-y: auto;\
    padding: 0;\
    background: #181818;\
}\
.comments-media-info {\
    padding: 16px;\
    border-bottom: 1px solid rgba(255,255,255,0.08);\
}\
.comments-media-title {\
    font-size: 18px;\
    font-weight: 600;\
    color: #fff;\
    margin: 0 0 4px 0;\
}\
.comments-media-subtitle {\
    font-size: 13px;\
    color: #888;\
}\
.comments-next-episode {\
    display: flex;\
    align-items: center;\
    gap: 12px;\
    padding: 12px 16px;\
    background: rgba(255,255,255,0.04);\
    border-bottom: 1px solid rgba(255,255,255,0.08);\
    cursor: pointer;\
    transition: background 0.15s;\
}\
.comments-next-episode:hover {\
    background: rgba(255,255,255,0.08);\
}\
.comments-next-thumb {\
    width: 120px;\
    height: 68px;\
    border-radius: 6px;\
    object-fit: cover;\
    background: #333;\
    flex-shrink: 0;\
}\
.comments-next-info {\
    flex: 1;\
    min-width: 0;\
}\
.comments-next-label {\
    font-size: 11px;\
    text-transform: uppercase;\
    letter-spacing: 0.5px;\
    color: #888;\
    margin-bottom: 4px;\
}\
.comments-next-title {\
    font-size: 14px;\
    color: #fff;\
    white-space: nowrap;\
    overflow: hidden;\
    text-overflow: ellipsis;\
}\
.comments-section {\
    padding: 16px;\
}\
.comments-section-header {\
    font-size: 14px;\
    font-weight: 600;\
    color: #aaa;\
    text-transform: uppercase;\
    letter-spacing: 0.5px;\
    margin-bottom: 12px;\
}\
.comments-input-row {\
    display: flex;\
    gap: 10px;\
    margin-bottom: 16px;\
    align-items: flex-start;\
}\
.comments-input-avatar {\
    width: 32px;\
    height: 32px;\
    border-radius: 50%;\
    background: #333;\
    flex-shrink: 0;\
    overflow: hidden;\
}\
.comments-input-avatar img {\
    width: 100%;\
    height: 100%;\
    object-fit: cover;\
}\
.comments-input-wrap {\
    flex: 1;\
    display: flex;\
    flex-direction: column;\
    gap: 6px;\
}\
.comments-input-pill {\
    display: flex;\
    align-items: center;\
    background: rgba(255,255,255,0.08);\
    border: 1px solid rgba(255,255,255,0.12);\
    border-radius: 20px;\
    padding: 4px 4px 4px 14px;\
    transition: border-color 0.15s;\
}\
.comments-input-pill:focus-within {\
    border-color: rgba(255,255,255,0.3);\
}\
.comments-input-field {\
    flex: 1;\
    background: none;\
    border: none;\
    color: #fff;\
    padding: 8px 0;\
    font-size: 14px;\
    resize: none;\
    font-family: inherit;\
    outline: none;\
}\
.comments-input-field::placeholder {\
    color: #666;\
}\
.comments-input-timestamp {\
    font-size: 12px;\
    color: #666;\
}\
.comments-input-submit {\
    background: #333;\
    border: none;\
    border-radius: 50%;\
    width: 32px;\
    height: 32px;\
    cursor: pointer;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    flex-shrink: 0;\
    transition: background 0.15s;\
}\
.comments-input-submit svg {\
    width: 16px;\
    height: 16px;\
    fill: #666;\
    transition: fill 0.15s;\
    display: block;\
    margin: auto;\
}\
.comments-input-submit.active {\
    background: #fff;\
}\
.comments-input-submit.active svg {\
    fill: #000;\
}\
.comments-input-submit:disabled {\
    cursor: default;\
}\
.comments-list {\
    display: flex;\
    flex-direction: column;\
    gap: 2px;\
}\
.comment-item {\
    display: flex;\
    gap: 10px;\
    padding: 10px 0;\
    align-items: flex-start;\
}\
.comment-avatar {\
    width: 28px;\
    height: 28px;\
    border-radius: 50%;\
    background: #333;\
    flex-shrink: 0;\
    overflow: hidden;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    font-size: 12px;\
    font-weight: 600;\
    color: #ccc;\
}\
.comment-avatar img {\
    width: 100%;\
    height: 100%;\
    object-fit: cover;\
}\
.comment-body {\
    flex: 1;\
    min-width: 0;\
}\
.comment-header {\
    display: flex;\
    align-items: center;\
    gap: 8px;\
    margin-bottom: 3px;\
}\
.comment-username {\
    font-size: 13px;\
    font-weight: 600;\
    color: #ccc;\
}\
.comment-timestamp {\
    font-size: 12px;\
    color: #00a4dc;\
    cursor: pointer;\
    opacity: 0.6;\
    transition: opacity 0.15s;\
}\
.comment-timestamp:hover {\
    opacity: 1;\
    text-decoration: underline;\
}\
.comment-text {\
    font-size: 14px;\
    color: #ddd;\
    line-height: 1.4;\
    word-wrap: break-word;\
}\
.comment-delete {\
    background: none;\
    border: none;\
    color: #555;\
    cursor: pointer;\
    font-size: 12px;\
    padding: 2px 6px;\
    margin-left: auto;\
    flex-shrink: 0;\
}\
.comment-delete:hover {\
    color: #e74c3c;\
}\
.comments-empty {\
    text-align: center;\
    color: #555;\
    padding: 24px 0;\
    font-size: 14px;\
}\
.comments-back-btn {\
    position: absolute;\
    top: 12px;\
    left: 12px;\
    z-index: 10;\
    background: rgba(0,0,0,0.6);\
    border: none;\
    color: #fff;\
    width: 36px;\
    height: 36px;\
    border-radius: 50%;\
    cursor: pointer;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    font-size: 18px;\
    backdrop-filter: blur(4px);\
}\
.comments-back-btn:hover {\
    background: rgba(0,0,0,0.8);\
}\
.comments-fullscreen-btn {\
    position: absolute;\
    top: 12px;\
    right: 12px;\
    z-index: 10;\
    background: rgba(0,0,0,0.6);\
    border: none;\
    color: #fff;\
    width: 36px;\
    height: 36px;\
    border-radius: 50%;\
    cursor: pointer;\
    display: flex;\
    align-items: center;\
    justify-content: center;\
    backdrop-filter: blur(4px);\
}\
.comments-fullscreen-btn:hover {\
    background: rgba(0,0,0,0.8);\
}\
.comments-fullscreen-btn svg {\
    width: 18px;\
    height: 18px;\
    fill: currentColor;\
}\
@keyframes skeleton-shimmer {\
    0% { background-position: -200% 0; }\
    100% { background-position: 200% 0; }\
}\
.skeleton-shimmer {\
    background: linear-gradient(90deg, #2a2a2a 25%, #3a3a3a 50%, #2a2a2a 75%);\
    background-size: 200% 100%;\
    animation: skeleton-shimmer 1.5s ease-in-out infinite;\
    border-radius: 4px;\
}\
.skeleton-title {\
    width: 60%;\
    height: 20px;\
    margin-bottom: 8px;\
}\
.skeleton-subtitle {\
    width: 40%;\
    height: 14px;\
}\
.skeleton-comment {\
    display: flex;\
    gap: 10px;\
    padding: 10px 0;\
    align-items: flex-start;\
}\
.skeleton-comment-avatar {\
    width: 28px;\
    height: 28px;\
    border-radius: 50%;\
    flex-shrink: 0;\
}\
.skeleton-comment-line {\
    height: 12px;\
    margin-bottom: 6px;\
}\
.skeleton-comment-line:first-child {\
    width: 30%;\
}\
.skeleton-comment-line:last-child {\
    width: 80%;\
}\
.skeleton-next-thumb {\
    width: 120px;\
    height: 68px;\
    border-radius: 6px;\
    flex-shrink: 0;\
}\
';
        document.head.appendChild(style);
    }

    // ── API ──

    function fetchComments(mediaId, callback) {
        var headers = getHeaders();
        if (!headers) return;

        fetch(API_BASE + '/api/Comments/' + mediaId, { headers: headers })
            .then(function (r) { return r.json(); })
            .then(callback)
            .catch(function () { callback([]); });
    }

    function postComment(mediaId, positionTicks, text, callback) {
        var headers = getHeaders();
        if (!headers) return;

        fetch(API_BASE + '/api/Comments/' + mediaId, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ PositionTicks: positionTicks, Text: text })
        })
            .then(function (r) { return r.json(); })
            .then(callback)
            .catch(function () { });
    }

    function deleteComment(commentId, callback) {
        var headers = getHeaders();
        if (!headers) return;

        fetch(API_BASE + '/api/Comments/' + commentId, {
            method: 'DELETE',
            headers: headers
        })
            .then(callback)
            .catch(function () { });
    }

    // ── Media Info ──

    function fetchMediaInfo(mediaId, callback) {
        var headers = getHeaders();
        if (!headers) return;
        var creds = getCredentials();

        fetch(API_BASE + '/Users/' + creds.userId + '/Items/' + mediaId, { headers: headers })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(callback)
            .catch(function () { callback(null); });
    }

    function fetchNextEpisode(mediaInfo, callback) {
        if (mediaInfo.Type !== 'Episode' || !mediaInfo.SeriesId) {
            callback(null);
            return;
        }

        var headers = getHeaders();
        var creds = getCredentials();
        if (!headers) { callback(null); return; }

        fetch(API_BASE + '/Shows/' + mediaInfo.SeriesId + '/Episodes?UserId=' + creds.userId
            + '&SeasonId=' + (mediaInfo.SeasonId || '')
            + '&StartIndex=' + (mediaInfo.IndexNumber || 0)
            + '&Limit=1'
            + '&Fields=PrimaryImageAspectRatio%2CParentIndexNumber', { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = data.Items || [];
                callback(items.length > 0 ? items[0] : null);
            })
            .catch(function () { callback(null); });
    }

    // ── Player Layout ──

    var VIDEO_HEIGHT = '45vh';

    // buildLayout replaced by showSkeletonLayout + replaceSkeletonsWithContent

    function loadComments(listEl) {
        if (!currentMediaId) return;
        var creds = getCredentials();

        fetchComments(currentMediaId, function (comments) {
            if (!comments || comments.length === 0) {
                listEl.innerHTML = '<div class="comments-empty">No comments yet. Be the first!</div>';
                return;
            }

            var html = '';
            comments.forEach(function (c) {
                var imgUrl = API_BASE + '/Users/' + c.UserId + '/Images/Primary?quality=80&height=56';
                var initial = (c.Username || '?')[0].toUpperCase();
                var isOwn = creds && c.UserId === creds.userId;

                html += '<div class="comment-item" data-id="' + c.Id + '">'
                    + '<div class="comment-avatar">'
                    + '<img src="' + imgUrl + '" onerror="this.style.display=\'none\';this.parentElement.textContent=\'' + initial + '\'">'
                    + '</div>'
                    + '<div class="comment-body">'
                    + '<div class="comment-header">'
                    + '<span class="comment-username">' + escapeHtml(c.Username) + '</span>'
                    + '<span class="comment-timestamp" data-ticks="' + c.PositionTicks + '">' + ticksToTimestamp(c.PositionTicks) + '</span>'
                    + '</div>'
                    + '<div class="comment-text">' + escapeHtml(c.Text) + '</div>'
                    + '</div>'
                    + (isOwn ? '<button class="comment-delete" data-id="' + c.Id + '" title="Delete">\u2715</button>' : '')
                    + '</div>';
            });

            listEl.innerHTML = html;

            // Timestamp click → seek
            listEl.querySelectorAll('.comment-timestamp').forEach(function (el) {
                el.addEventListener('click', function () {
                    var ticks = parseInt(el.getAttribute('data-ticks'), 10);
                    var video = document.querySelector('video');
                    if (video && !isNaN(ticks)) {
                        video.currentTime = ticks / 10000000;
                    }
                });
            });

            // Delete click
            listEl.querySelectorAll('.comment-delete').forEach(function (el) {
                el.addEventListener('click', function () {
                    var id = el.getAttribute('data-id');
                    deleteComment(id, function () {
                        loadComments(listEl);
                    });
                });
            });
        });
    }

    function exitLayout() {
        var layout = document.getElementById('comments-layout');
        if (layout) layout.remove();

        var layoutStyle = document.getElementById('comments-layout-style');
        if (layoutStyle) layoutStyle.remove();

        commentsInjected = false;
        playerActive = false;
        skeletonShown = false;
    }

    // ── Player Interception ──

    function trackPlaybackPosition() {
        setInterval(function () {
            var video = document.querySelector('video');
            if (video && !isNaN(video.currentTime)) {
                currentPositionTicks = Math.floor(video.currentTime * 10000000);
            }
        }, 500);
    }

    var skeletonShown = false;

    function showSkeletonLayout() {
        if (skeletonShown || commentsInjected) return;
        skeletonShown = true;

        injectStyles();

        // Exit browser fullscreen if active
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(function () { });
        }

        // Inject CSS to constrain Jellyfin's player to the top portion
        var layoutStyle = document.createElement('style');
        layoutStyle.id = 'comments-layout-style';
        layoutStyle.textContent = '\
.videoPlayerContainer { position:fixed!important; top:0!important; left:0!important; right:0!important; height:' + VIDEO_HEIGHT + '!important; bottom:auto!important; }\
.videoOsdBottom { bottom:auto!important; top:' + VIDEO_HEIGHT + '!important; transform:translateY(-100%)!important; }\
.osdControls { position:relative!important; }\
.btnPreviousChapter, .btnNextChapter { display:none!important; }\
';
        document.head.appendChild(layoutStyle);

        // Skeleton panel
        var layout = document.createElement('div');
        layout.id = 'comments-layout';
        layout.style.cssText = 'position:fixed;top:' + VIDEO_HEIGHT + ';left:0;right:0;bottom:0;z-index:99997;background:#181818;overflow-y:auto;display:flex;flex-direction:column;';

        var contentSection = document.createElement('div');
        contentSection.className = 'comments-content-section';
        contentSection.style.cssText = 'flex:1;overflow-y:auto;';

        // Skeleton media info
        var skeletonInfo = document.createElement('div');
        skeletonInfo.className = 'comments-media-info';
        skeletonInfo.id = 'skeleton-media-info';
        skeletonInfo.innerHTML = '<div class="skeleton-shimmer skeleton-title"></div><div class="skeleton-shimmer skeleton-subtitle"></div>';
        contentSection.appendChild(skeletonInfo);

        // Skeleton next episode
        var skeletonNext = document.createElement('div');
        skeletonNext.className = 'comments-next-episode';
        skeletonNext.id = 'skeleton-next-episode';
        skeletonNext.innerHTML = '<div class="skeleton-shimmer skeleton-next-thumb"></div>'
            + '<div class="comments-next-info">'
            + '<div class="skeleton-shimmer skeleton-subtitle" style="width:50%;margin-bottom:6px;"></div>'
            + '<div class="skeleton-shimmer skeleton-title" style="width:70%;"></div>'
            + '</div>';
        contentSection.appendChild(skeletonNext);

        // Skeleton comments
        var skeletonComments = document.createElement('div');
        skeletonComments.className = 'comments-section';
        skeletonComments.id = 'skeleton-comments';
        skeletonComments.innerHTML = '<div class="comments-section-header">Comments</div>';
        for (var i = 0; i < 3; i++) {
            skeletonComments.innerHTML += '<div class="skeleton-comment">'
                + '<div class="skeleton-shimmer skeleton-comment-avatar"></div>'
                + '<div style="flex:1;">'
                + '<div class="skeleton-shimmer skeleton-comment-line" style="width:30%;"></div>'
                + '<div class="skeleton-shimmer skeleton-comment-line" style="width:80%;"></div>'
                + '</div></div>';
        }
        contentSection.appendChild(skeletonComments);

        layout.appendChild(contentSection);
        document.body.appendChild(layout);
    }

    function loadRealContent() {
        var attempts = 0;
        var maxAttempts = 20;
        var waiting = false;

        var srcPollInterval = setInterval(function () {
            if (waiting) return;
            attempts++;

            if (attempts > maxAttempts) {
                clearInterval(srcPollInterval);
                playerActive = false;
                skeletonShown = false;
                return;
            }

            var video = document.querySelector('video');
            if (!video) return;
            var hasSrc = video.src || video.currentSrc;
            if (!hasSrc) return;

            // Use pendingMediaId if set (from next episode click), otherwise extract
            waiting = true;
            var knownId = pendingMediaId;
            if (knownId) {
                pendingMediaId = null;
                onMediaId(knownId);
            } else {
                fetchCurrentMediaId(function (mediaId) {
                    if (!mediaId) { waiting = false; return; }
                    onMediaId(mediaId);
                });
            }

            function onMediaId(mediaId) {
                clearInterval(srcPollInterval);
                playerActive = true;
                currentMediaId = mediaId;

                fetchMediaInfo(mediaId, function (mediaInfo) {
                    if (!mediaInfo) {
                        playerActive = false;
                        skeletonShown = false;
                        return;
                    }

                    fetchNextEpisode(mediaInfo, function (nextEp) {
                        replaceSkeletonsWithContent(video, mediaInfo, nextEp);
                    });
                });
            }
        }, 500);
    }

    function replaceSkeletonsWithContent(videoEl, mediaInfo, nextEpisode) {
        var layout = document.getElementById('comments-layout');
        if (!layout) return;

        var contentSection = layout.querySelector('.comments-content-section');
        if (!contentSection) return;

        // Clear skeleton content
        contentSection.innerHTML = '';

        // Media info
        if (mediaInfo) {
            var infoDiv = document.createElement('div');
            infoDiv.className = 'comments-media-info';
            var title = mediaInfo.Name || '';
            var subtitle = '';
            if (mediaInfo.SeriesName) {
                subtitle = mediaInfo.SeriesName;
                if (mediaInfo.ParentIndexNumber != null) subtitle += ' \u2022 S' + mediaInfo.ParentIndexNumber;
                if (mediaInfo.IndexNumber != null) subtitle += 'E' + mediaInfo.IndexNumber;
            } else if (mediaInfo.ProductionYear) {
                subtitle = '' + mediaInfo.ProductionYear;
            }
            infoDiv.innerHTML = '<h2 class="comments-media-title">' + escapeHtml(title) + '</h2>'
                + (subtitle ? '<div class="comments-media-subtitle">' + escapeHtml(subtitle) + '</div>' : '');
            contentSection.appendChild(infoDiv);
        }

        // Next episode card
        if (nextEpisode) {
            var nextDiv = document.createElement('div');
            nextDiv.className = 'comments-next-episode';
            var thumbUrl = API_BASE + '/Items/' + nextEpisode.Id + '/Images/Primary?maxWidth=240&quality=80';
            var nextTitle = nextEpisode.Name || 'Next Episode';
            var nextSub = '';
            if (nextEpisode.ParentIndexNumber != null && nextEpisode.IndexNumber != null) {
                nextSub = 'S' + nextEpisode.ParentIndexNumber + ' E' + nextEpisode.IndexNumber;
            } else if (nextEpisode.IndexNumber != null) {
                nextSub = 'Episode ' + nextEpisode.IndexNumber;
            }
            nextDiv.innerHTML = '<img class="comments-next-thumb" src="' + thumbUrl + '" onerror="this.style.display=\'none\'">'
                + '<div class="comments-next-info">'
                + '<div class="comments-next-label">Next Episode' + (nextSub ? ' \u2022 ' + nextSub : '') + '</div>'
                + '<div class="comments-next-title">' + escapeHtml(nextTitle) + '</div>'
                + '</div>';
            nextDiv.addEventListener('click', function () {
                var nextId = nextEpisode.Id;
                var headers = getHeaders();
                var creds = getCredentials();
                if (!headers || !creds) return;

                pendingMediaId = nextId;
                exitLayout();

                // Find THIS device's session and send play command
                var deviceId = (window.ApiClient && window.ApiClient._deviceId) || localStorage.getItem('_deviceId2') || '';
                fetch(API_BASE + '/Sessions?ControllableByUserId=' + creds.userId + '&DeviceId=' + encodeURIComponent(deviceId), { headers: headers })
                    .then(function (r) { return r.json(); })
                    .then(function (sessions) {
                        if (sessions && sessions.length > 0) {
                            fetch(API_BASE + '/Sessions/' + sessions[0].Id + '/Playing?PlayCommand=PlayNow&ItemIds=' + nextId, {
                                method: 'POST',
                                headers: headers
                            });
                        }
                    });
            });
            contentSection.appendChild(nextDiv);
        }

        // Comments section
        var commentsDiv = document.createElement('div');
        commentsDiv.className = 'comments-section';
        commentsDiv.innerHTML = '<div class="comments-section-header">Comments</div>';

        // Comment input
        var creds = getCredentials();
        var inputRow = document.createElement('div');
        inputRow.className = 'comments-input-row';
        var avatarUrl = creds ? API_BASE + '/Users/' + creds.userId + '/Images/Primary?quality=80&height=64' : '';
        inputRow.innerHTML = '<div class="comments-input-avatar"><img src="' + avatarUrl + '" onerror="this.parentElement.textContent=\'?\'"></div>';

        var inputWrap = document.createElement('div');
        inputWrap.className = 'comments-input-wrap';

        var pill = document.createElement('div');
        pill.className = 'comments-input-pill';

        var textarea = document.createElement('textarea');
        textarea.className = 'comments-input-field';
        textarea.placeholder = 'Add a comment...';
        textarea.rows = 1;
        textarea.maxLength = 500;

        var submitBtn = document.createElement('button');
        submitBtn.className = 'comments-input-submit';
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M31.083 16.589c0.105-0.167 0.167-0.371 0.167-0.589s-0.062-0.421-0.17-0.593l0.003 0.005c-0.030-0.051-0.059-0.094-0.091-0.135l0.002 0.003c-0.1-0.137-0.223-0.251-0.366-0.336l-0.006-0.003c-0.025-0.015-0.037-0.045-0.064-0.058l-28-14c-0.163-0.083-0.355-0.132-0.558-0.132-0.691 0-1.25 0.56-1.25 1.25 0 0.178 0.037 0.347 0.104 0.5l-0.003-0.008 5.789 13.508-5.789 13.508c-0.064 0.145-0.101 0.314-0.101 0.492 0 0.69 0.56 1.25 1.25 1.25h0.001c0.203 0 0.394-0.049 0.563-0.136l-0.007 0.003 28-13.999c0.027-0.013 0.038-0.043 0.064-0.058 0.148-0.088 0.272-0.202 0.369-0.336l0.002-0.004c0.030-0.038 0.060-0.082 0.086-0.127l0.003-0.006zM4.493 4.645l20.212 10.105h-15.88zM8.825 17.25h15.88l-20.212 10.105z"/></svg>';

        // Prevent Jellyfin keyboard shortcuts from firing while typing
        textarea.addEventListener('keydown', function (e) { e.stopPropagation(); });
        textarea.addEventListener('keypress', function (e) { e.stopPropagation(); });
        textarea.addEventListener('keyup', function (e) { e.stopPropagation(); });

        textarea.addEventListener('input', function () {
            var hasText = !!textarea.value.trim();
            submitBtn.disabled = !hasText;
            if (hasText) {
                submitBtn.classList.add('active');
            } else {
                submitBtn.classList.remove('active');
            }
        });

        var tsLabel = document.createElement('span');
        tsLabel.className = 'comments-input-timestamp';
        tsLabel.textContent = 'at ' + ticksToTimestamp(currentPositionTicks);

        setInterval(function () {
            tsLabel.textContent = 'at ' + ticksToTimestamp(currentPositionTicks);
        }, 1000);

        submitBtn.addEventListener('click', function () {
            var text = textarea.value.trim();
            if (!text || !currentMediaId) return;
            submitBtn.disabled = true;
            submitBtn.classList.remove('active');
            postComment(currentMediaId, currentPositionTicks, text, function (comment) {
                textarea.value = '';
                submitBtn.disabled = true;
                submitBtn.classList.remove('active');
                loadComments(commentsList);
            });
        });

        pill.appendChild(textarea);
        pill.appendChild(submitBtn);
        inputWrap.appendChild(pill);
        inputWrap.appendChild(tsLabel);
        inputRow.appendChild(inputWrap);
        commentsDiv.appendChild(inputRow);

        var commentsList = document.createElement('div');
        commentsList.className = 'comments-list';
        commentsList.innerHTML = '<div class="comments-empty">No comments yet</div>';
        commentsDiv.appendChild(commentsList);

        contentSection.appendChild(commentsDiv);
        commentsInjected = true;

        loadComments(commentsList);
    }

    function watchForPlayer() {
        var checkInterval = null;

        function tryInject() {
            if (playerActive) return;

            var playerContainer = document.querySelector('.videoPlayerContainer');
            if (!playerContainer) return;

            // Phase 1: Show skeleton layout immediately when player container appears
            if (!skeletonShown && !commentsInjected) {
                showSkeletonLayout();
                loadRealContent();
            }
        }

        // Poll for player container
        checkInterval = setInterval(tryInject, 300);

        // Also use observer as backup
        var observer = new MutationObserver(tryInject);
        observer.observe(document.body, { childList: true, subtree: true });

        // Watch for player removal (user stops playback)
        var cleanupObserver = new MutationObserver(function () {
            if (!skeletonShown && !commentsInjected) return;
            var video = document.querySelector('video');
            var playerContainer = document.querySelector('.videoPlayerContainer');
            if (!video && !playerContainer) {
                exitLayout();
            }
        });
        cleanupObserver.observe(document.body, { childList: true, subtree: true });
    }

    function extractMediaId() {
        var video = document.querySelector('video');
        var src = video ? (video.src || video.currentSrc || '') : '';
        var hash = window.location.hash || '';
        var path = window.location.pathname + hash;

        // Video stream URL — /videos/{id}/ pattern (not blob URLs)
        if (src && !src.startsWith('blob:')) {
            var match = src.match(/videos\/([a-f0-9-]{32,36})/i);
            if (match) return match[1].replace(/-/g, '');
        }

        // Try URL hash — ?id= parameter
        var match = hash.match(/[?&]id=([a-f0-9]{16,})/i);
        if (match) return match[1];

        // Try path-based URL
        match = path.match(/items\/([a-f0-9]{16,})/i);
        if (match) return match[1];

        return null;
    }

    // Async fallback: query Sessions API for currently playing item on this device
    function fetchCurrentMediaId(callback) {
        var syncId = extractMediaId();
        if (syncId) { callback(syncId); return; }

        var headers = getHeaders();
        var creds = getCredentials();
        if (!headers || !creds) { callback(null); return; }

        var deviceId = (window.ApiClient && window.ApiClient._deviceId) || localStorage.getItem('_deviceId2') || '';
        fetch(API_BASE + '/Sessions?ControllableByUserId=' + creds.userId + '&DeviceId=' + encodeURIComponent(deviceId), { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (sessions) {
                if (sessions && sessions.length > 0 && sessions[0].NowPlayingItem) {
                    callback(sessions[0].NowPlayingItem.Id);
                } else {
                    callback(null);
                }
            })
            .catch(function () { callback(null); });
    }

    // ── Fullscreen handling ──

    var origRequestFullscreen = Element.prototype.requestFullscreen;

    function hideCommentsForFullscreen() {
        var layout = document.getElementById('comments-layout');
        var layoutStyle = document.getElementById('comments-layout-style');
        if (layout) layout.style.display = 'none';
        if (layoutStyle) layoutStyle.disabled = true;
    }

    function showCommentsAfterFullscreen() {
        var layout = document.getElementById('comments-layout');
        var layoutStyle = document.getElementById('comments-layout-style');
        if (layout) layout.style.display = '';
        if (layoutStyle) layoutStyle.disabled = false;
    }

    Element.prototype.requestFullscreen = function () {
        if (commentsInjected) {
            hideCommentsForFullscreen();
        }
        return origRequestFullscreen.apply(this, arguments);
    };

    document.addEventListener('fullscreenchange', function () {
        if (!document.fullscreenElement && commentsInjected && !isLandscape) {
            showCommentsAfterFullscreen();
        }
    });

    // Also handle webkit
    if (Element.prototype.webkitRequestFullscreen) {
        var origWebkit = Element.prototype.webkitRequestFullscreen;
        Element.prototype.webkitRequestFullscreen = function () {
            if (commentsInjected) {
                hideCommentsForFullscreen();
            }
            return origWebkit.apply(this, arguments);
        };
    }

    // ── Orientation handling (mobile only) ──

    var isLandscape = false;
    var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    function checkOrientation() {
        if (!isTouchDevice) return;

        var landscape = window.matchMedia('(orientation: landscape)').matches;
        if (landscape === isLandscape) return;
        isLandscape = landscape;

        if (!commentsInjected && !skeletonShown) return;

        if (landscape) {
            hideCommentsForFullscreen();
        } else if (!document.fullscreenElement) {
            showCommentsAfterFullscreen();
        }
    }

    window.matchMedia('(orientation: landscape)').addEventListener('change', checkOrientation);
    window.addEventListener('resize', checkOrientation);

    // ── Init ──

    function init() {
        var creds = getCredentials();
        if (!creds || !creds.token) {
            setTimeout(init, 2000);
            return;
        }

        injectStyles();
        trackPlaybackPosition();
        watchForPlayer();
    }

    if (window.__commentsInitialized) return;
    window.__commentsInitialized = true;

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('DOMContentLoaded', function () {
            setTimeout(init, 500);
        });
    }
})();
