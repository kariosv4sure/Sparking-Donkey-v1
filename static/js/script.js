(function() {
    console.log('✨ Sparkling Donkey JS loaded');

    // ---------- Theme Application ----------
    function applyTheme(prefs) {
        if (!prefs) return;
        document.body.classList.add(`theme-${prefs.theme}`);
        document.body.classList.add(`style-${prefs.style}`);
        console.log('🎨 Theme applied:', prefs.theme, prefs.style);
    }

    if (window.userPrefs) {
        applyTheme(window.userPrefs);
    }

    // ---------- Utility: HTML Escape ----------
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ---------- Room Mode (Video Sync + Chat + Reactions) ----------
    if (window.roomData) {
        console.log('🎬 Room mode activated');
        const room = window.roomData;
        const ROOM_NAME = 'watch_room';

        // DOM Elements - Video
        const video = document.getElementById('moviePlayer');
        const syncStatus = document.getElementById('syncStatus');
        const viewerSpan = document.getElementById('viewerCount');

        // DOM Elements - Chat
        const chatMessages = document.getElementById('chatMessages');
        const chatInput = document.getElementById('chatInput');
        const sendBtn = document.getElementById('sendMessageBtn');
        const typingIndicator = document.getElementById('typingIndicator');
        const reactionContainer = document.getElementById('reactionContainer');
        const chatSidebar = document.getElementById('chatSidebar');
        const chatToggle = document.getElementById('chatToggle');
        const chatMobileToggle = document.getElementById('chatMobileToggle');

        // Validate required elements
        if (!video || !syncStatus || !viewerSpan) {
            console.error('❌ Missing video sync elements');
            return;
        }

        // ---------- Socket.IO Connection ----------
        const socket = io();
        console.log('🔌 Socket.IO initializing');

        // ---------- Video Sync State ----------
        let isRemoteUpdate = false;
        let remoteUpdateTimer = null;

        function setVideoTimeSafely(time) {
            if (typeof time !== 'number' || isNaN(time)) return;
            const currentTime = video.currentTime;
            if (Math.abs(currentTime - time) > 0.3) {
                console.log(`⏱️ Syncing time: ${currentTime.toFixed(2)} → ${time.toFixed(2)}`);
                isRemoteUpdate = true;
                video.currentTime = time;
                clearTimeout(remoteUpdateTimer);
                remoteUpdateTimer = setTimeout(() => { isRemoteUpdate = false; }, 300);
            }
        }

        // ---------- Video Event Listeners ----------
        video.addEventListener('play', () => {
            console.log('▶️ Play - remote?', isRemoteUpdate);
            if (isRemoteUpdate) return;
            socket.emit('play', { room: ROOM_NAME, currentTime: video.currentTime });
        });

        video.addEventListener('pause', () => {
            console.log('⏸️ Pause - remote?', isRemoteUpdate);
            if (isRemoteUpdate) return;
            socket.emit('pause', { room: ROOM_NAME, currentTime: video.currentTime });
        });

        video.addEventListener('seeked', () => {
            console.log('↻ Seeked - remote?', isRemoteUpdate);
            if (isRemoteUpdate) return;
            socket.emit('seek', { room: ROOM_NAME, currentTime: video.currentTime });
        });

        video.addEventListener('seeking', () => {
            console.log('🔍 Seeking - remote?', isRemoteUpdate);
            if (isRemoteUpdate) return;
            socket.emit('seek', { room: ROOM_NAME, currentTime: video.currentTime });
        });

        // ---------- Socket Event Handlers (Video Sync) ----------
        socket.on('connect', () => {
            console.log('🟢 Socket connected');
            socket.emit('join', { room: ROOM_NAME, movie: room.movieId });
            syncStatus.textContent = '⚡ Connected';
        });

        socket.on('disconnect', () => {
            console.log('🔴 Socket disconnected');
            syncStatus.textContent = '⚠️ Offline';
        });

        socket.on('sync_state', (data) => {
            console.log('📥 Sync state:', data);
            isRemoteUpdate = true;
            data.playing ? video.play().catch(e => {}) : video.pause();
            setVideoTimeSafely(data.currentTime);
            syncStatus.textContent = '⚡ Synced';
            setTimeout(() => { isRemoteUpdate = false; }, 300);
        });

        socket.on('remote_play', (data) => {
            console.log('📥 Remote play:', data.from);
            isRemoteUpdate = true;
            setVideoTimeSafely(data.currentTime);
            video.play().catch(e => {});
            syncStatus.textContent = `▶ ${data.from}`;
            setTimeout(() => { isRemoteUpdate = false; syncStatus.textContent = '⚡ Live'; }, 500);
        });

        socket.on('remote_pause', (data) => {
            console.log('📥 Remote pause:', data.from);
            isRemoteUpdate = true;
            setVideoTimeSafely(data.currentTime);
            video.pause();
            syncStatus.textContent = `⏸ ${data.from}`;
            setTimeout(() => { isRemoteUpdate = false; syncStatus.textContent = '⚡ Live'; }, 500);
        });

        socket.on('remote_seek', (data) => {
            console.log('📥 Remote seek:', data.from);
            isRemoteUpdate = true;
            setVideoTimeSafely(data.currentTime);
            syncStatus.textContent = `↻ ${data.from}`;
            setTimeout(() => { isRemoteUpdate = false; syncStatus.textContent = '⚡ Live'; }, 500);
        });

        socket.on('viewer_count', (data) => {
            console.log('👥 Viewers:', data.count);
            viewerSpan.textContent = data.count;
        });

        socket.on('user_joined', (data) => {
            console.log('👤 User joined:', data.user);
        });

        socket.on('error', (data) => {
            console.error('❌ Socket error:', data.message);
            alert(data.message);
        });

        // ---------- Chat Functions ----------
        function addMessage(user, message, timestamp, isOwn = false) {
            if (!chatMessages) return;
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${isOwn ? 'own' : ''}`;
            messageDiv.innerHTML = `
                <span class="message-user">${escapeHtml(user)}</span>
                <div class="message-bubble">${escapeHtml(message)}</div>
                <span class="message-time">${timestamp}</span>
            `;
            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function sendMessage() {
            if (!chatInput) return;
            const message = chatInput.value.trim();
            if (!message) return;
            
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            socket.emit('send_message', { room: ROOM_NAME, message, timestamp });
            addMessage(room.prefs.nickname, message, timestamp, true);
            chatInput.value = '';
            
            if (typingTimeout) {
                clearTimeout(typingTimeout);
                typingTimeout = null;
            }
            socket.emit('typing', { room: ROOM_NAME, typing: false });
        }

        // ---------- Floating Emoji Reaction ----------
        function showFloatingEmoji(user, emoji) {
            if (!reactionContainer) return;
            const float = document.createElement('div');
            float.className = 'floating-emoji';
            float.textContent = emoji;
            float.style.left = Math.random() * 80 + 10 + '%';
            float.style.top = Math.random() * 60 + 20 + '%';
            reactionContainer.appendChild(float);
            setTimeout(() => float.remove(), 3000);
        }

        // ---------- Chat Event Listeners ----------
        if (sendBtn) {
            sendBtn.addEventListener('click', sendMessage);
        }

        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendMessage();
            });

            let typingTimeout = null;
            chatInput.addEventListener('input', () => {
                if (!typingTimeout) {
                    socket.emit('typing', { room: ROOM_NAME, typing: true });
                }
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    socket.emit('typing', { room: ROOM_NAME, typing: false });
                    typingTimeout = null;
                }, 1000);
            });
        }

        // ---------- Chat Toggle (Desktop/Mobile) ----------
        if (chatToggle) {
            chatToggle.addEventListener('click', () => {
                chatSidebar.classList.toggle('collapsed');
            });
        }

        if (chatMobileToggle) {
            chatMobileToggle.addEventListener('click', () => {
                chatSidebar.classList.toggle('mobile-visible');
            });
        }

        // ---------- Emoji Reaction Buttons ----------
        document.querySelectorAll('.emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const emoji = btn.dataset.emoji;
                socket.emit('send_reaction', { room: ROOM_NAME, emoji });
                showFloatingEmoji(room.prefs.nickname, emoji);
            });
        });

        // ---------- Socket Event Handlers (Chat) ----------
        socket.on('new_message', (data) => {
            addMessage(data.user, data.message, data.timestamp, false);
        });

        socket.on('user_typing', (data) => {
            if (typingIndicator) {
                typingIndicator.textContent = data.typing ? `${data.user} is typing...` : '';
            }
        });

        socket.on('new_reaction', (data) => {
            showFloatingEmoji(data.user, data.emoji);
        });

        // ---------- Cleanup ----------
        window.addEventListener('beforeunload', () => {
            console.log('👋 Disconnecting socket');
            socket.disconnect();
        });

        console.log('✅ Room setup complete (Sync + Chat + Reactions)');
    }

    console.log('✅ Sparkling Donkey JS fully loaded');
})();
