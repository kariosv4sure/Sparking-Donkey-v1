from flask import Flask, render_template, request, redirect, url_for, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from config import Config
import os

app = Flask(__name__)
app.config.from_object(Config)
socketio = SocketIO(app, cors_allowed_origins="*")

# ---------- Room‑based state (scalable) ----------
# Structure: { room_name: { 'movie': str, 'playing': bool, 'currentTime': float, 'users': set() } }
room_states = {}

MAX_USERS_PER_ROOM = 2

def get_room_state(room):
    if room not in room_states:
        room_states[room] = {
            'movie': None,
            'playing': False,
            'currentTime': 0.0,
            'users': set()
        }
    return room_states[room]

def broadcast_viewer_count(room):
    """Emit current viewer count to all clients in the room."""
    state = get_room_state(room)
    count = len(state['users'])
    socketio.emit('viewer_count', {'count': count}, to=room)

# ---------- Routes ----------
@app.route('/')
def index():
    if 'user' not in session:
        return redirect(url_for('login'))
    return redirect(url_for('home'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username in app.config['VALID_USERS'] and \
           app.config['VALID_USERS'][username] == password:
            session['user'] = username
            if 'prefs' not in session:
                return redirect(url_for('personalize'))
            return redirect(url_for('home'))
        else:
            return render_template('login.html', error="Invalid credentials")
    return render_template('login.html')

@app.route('/personalize', methods=['GET', 'POST'])
def personalize():
    if 'user' not in session:
        return redirect(url_for('login'))
    if request.method == 'POST':
        theme = request.form.get('theme')
        style = request.form.get('style')
        nickname = request.form.get('nickname', '').strip() or session['user']
        session['prefs'] = {
            'theme': theme,
            'style': style,
            'nickname': nickname
        }
        return redirect(url_for('home'))
    return render_template('personalize.html', user=session['user'])

@app.route('/home')
def home():
    if 'user' not in session:
        return redirect(url_for('login'))
    if 'prefs' not in session:
        return redirect(url_for('personalize'))
    
    movies = [
        {'id': 'movie1', 'title': 'Annabelle', 'thumb': 'images.webp'}
    ]
    
    return render_template('home.html', movies=movies, prefs=session['prefs'])


@app.route('/room/<movie_id>')
def room(movie_id):
    if 'user' not in session:
        return redirect(url_for('login'))
    if 'prefs' not in session:
        return redirect(url_for('personalize'))
    
    if movie_id not in ['movie1']:  # Only Annabelle for now
        return redirect(url_for('home'))
    
    # Your GitHub Release URL
    VIDEO_URL = "https://github.com/kariosv4sure/Sparking-Donkey-v1/releases/download/v1.0.0/movie1.mp4"
    
    return render_template('room.html',
                           movie_id=movie_id,
                           video_url=VIDEO_URL,  # ← Pass this!
                           prefs=session['prefs'],
                           user=session['user'])

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# ---------- Socket.IO Events ----------
@socketio.on('join')
def handle_join(data):
    username = session.get('user')
    if not username:
        return

    room = data.get('room', 'watch_room')  # dynamic room name
    movie_id = data.get('movie')

    state = get_room_state(room)

    # Enforce 2‑user limit
    if len(state['users']) >= MAX_USERS_PER_ROOM and username not in state['users']:
        emit('error', {'message': 'Room is full (max 2 users).'})
        return

    join_room(room)
    state['users'].add(username)

    # Initialize movie for the room if first user
    if state['movie'] is None:
        state['movie'] = movie_id
        state['playing'] = False
        state['currentTime'] = 0.0

    # Send current state to the joining user
    emit('sync_state', {
        'playing': state['playing'],
        'currentTime': state['currentTime']
    }, to=request.sid)

    # Notify others and update viewer count
    emit('user_joined', {'user': username}, to=room)
    broadcast_viewer_count(room)

@socketio.on('play')
def handle_play(data):
    username = session.get('user')
    room = data.get('room', 'watch_room')
    state = get_room_state(room)
    
    state['playing'] = True
    state['currentTime'] = data.get('currentTime', 0)
    
    print(f"▶️ PLAY from {username}: time={state['currentTime']:.2f}")
    
    emit('remote_play', {
        'currentTime': state['currentTime'],
        'from': username
    }, to=room, skip_sid=request.sid)

@socketio.on('pause')
def handle_pause(data):
    username = session.get('user')
    room = data.get('room', 'watch_room')
    state = get_room_state(room)
    
    state['playing'] = False
    state['currentTime'] = data.get('currentTime', 0)
    
    print(f"⏸️ PAUSE from {username}: time={state['currentTime']:.2f}")
    
    emit('remote_pause', {
        'currentTime': state['currentTime'],
        'from': username
    }, to=room, skip_sid=request.sid)

@socketio.on('seek')
def handle_seek(data):
    username = session.get('user')
    room = data.get('room', 'watch_room')
    state = get_room_state(room)
    
    state['currentTime'] = data.get('currentTime', 0)
    
    print(f"↻ SEEK from {username}: time={state['currentTime']:.2f}")
    
    emit('remote_seek', {
        'currentTime': state['currentTime'],
        'from': username
    }, to=room, skip_sid=request.sid)

# ---------- Chat & Reactions ----------
@socketio.on('send_message')
def handle_message(data):
    username = session.get('user')
    room = data.get('room', 'watch_room')
    message = data.get('message', '').strip()
    
    if not message:
        return
    
    # Get nickname from session
    prefs = session.get('prefs', {})
    nickname = prefs.get('nickname', username)
    
    print(f"💬 CHAT from {nickname}: {message}")
    
    emit('new_message', {
        'user': nickname,
        'message': message,
        'timestamp': data.get('timestamp')
    }, to=room)

@socketio.on('send_reaction')
def handle_reaction(data):
    username = session.get('user')
    room = data.get('room', 'watch_room')
    emoji = data.get('emoji', '❤️')
    
    prefs = session.get('prefs', {})
    nickname = prefs.get('nickname', username)
    
    print(f"🎭 REACTION from {nickname}: {emoji}")
    
    emit('new_reaction', {
        'user': nickname,
        'emoji': emoji
    }, to=room)

@socketio.on('typing')
def handle_typing(data):
    username = session.get('user')
    room = data.get('room', 'watch_room')
    is_typing = data.get('typing', False)
    
    prefs = session.get('prefs', {})
    nickname = prefs.get('nickname', username)
    
    emit('user_typing', {
        'user': nickname,
        'typing': is_typing
    }, to=room, skip_sid=request.sid)

@socketio.on('disconnect')
def handle_disconnect():
    username = session.get('user')
    # Find which room(s) the user was in (naive search, but fine for small scale)
    for room, state in room_states.items():
        if username in state['users']:
            state['users'].remove(username)
            leave_room(room)
            broadcast_viewer_count(room)
            # If room becomes empty, reset its state
            if len(state['users']) == 0:
                state['movie'] = None
                state['playing'] = False
                state['currentTime'] = 0.0
            break

# ---------- Main ----------
if __name__ == '__main__':
    socketio.run(app, debug=False, host='0.0.0.0', port=5000)
