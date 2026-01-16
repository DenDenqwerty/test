const socket = io();
const videoGrid = document.getElementById('video-grid');
const welcome = document.getElementById('welcome');
const room = document.getElementById('room');
const createRoomBtn = document.getElementById('create-room');
const joinBtn = document.getElementById('join-btn');
const roomIdInput = document.getElementById('room-id');
const toggleCameraBtn = document.getElementById('toggle-camera');
const shareScreenBtn = document.getElementById('share-screen');
const leaveRoomBtn = document.getElementById('leave-room');

let myPeerConnection;
let localStream;
let roomId;
let userId = Math.random().toString(36).substr(2, 9);
let peers = {};
let cameraEnabled = true;
let micEnabled = true;
let screenSharing = false;

createRoomBtn.addEventListener('click', () => {
  roomId = Math.random().toString(36).substr(2, 9);
  document.getElementById('room-id-display').textContent = roomId;
  document.getElementById('room-info').style.display = 'block';
  joinRoom(roomId);
});

joinBtn.addEventListener('click', () => {
  roomId = roomIdInput.value.trim();
  if (roomId) {
    joinRoom(roomId);
  }
});

toggleCameraBtn.addEventListener('click', toggleCamera);
const toggleMicBtn = document.getElementById('toggle-mic');
toggleMicBtn.addEventListener('click', toggleMic);
shareScreenBtn.addEventListener('click', shareScreen);
leaveRoomBtn.addEventListener('click', leaveRoom);

function joinRoom(id) {
  roomId = id;
  document.getElementById('room-id-room').textContent = roomId;
  welcome.style.display = 'none';
  room.style.display = 'block';
  socket.emit('join-room', roomId, userId);
  initWebRTC();
}

socket.on('all-users', (users) => {
  users.forEach(userId => {
    connectToNewUser(userId, localStream);
  });
});

function initWebRTC() {
  document.getElementById('status').textContent = '🔄 Подключение...';
  navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
      localStream = stream;
      addVideoStream(userId, stream, true);
      document.getElementById('status').textContent = '✅ Подключено';
      socket.on('user-connected', (newUserId) => {
        connectToNewUser(newUserId, stream);
        document.getElementById('status').textContent = `👥 Участников: ${Object.keys(peers).length + 1}`;
        addNotification(`👋 Пользователь ${newUserId.slice(0, 6)} присоединился`);
      });
      socket.on('user-disconnected', (disconnectedUserId) => {
        if (peers[disconnectedUserId]) {
          peers[disconnectedUserId].close();
          delete peers[disconnectedUserId];
          removeVideoStream(disconnectedUserId);
        }
        document.getElementById('status').textContent = `👥 Участников: ${Object.keys(peers).length + 1}`;
        addNotification(`👋 Пользователь ${disconnectedUserId.slice(0, 6)} вышел`);
      });
      socket.on('signal', (data) => {
        handleSignal(data);
      });
    })
    .catch(err => {
      console.error('Error accessing media devices:', err);
      document.getElementById('status').textContent = '❌ Ошибка доступа к камере';
    });
}

function addNotification(message) {
  const notifications = document.getElementById('notifications');
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  notifications.appendChild(notification);
  setTimeout(() => {
    notification.remove();
  }, 5000); // Remove after 5 seconds
}

function connectToNewUser(newUserId, stream) {
  const peerConnection = createPeerConnection(newUserId);
  stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

  peerConnection.createOffer()
    .then(offer => {
      return peerConnection.setLocalDescription(offer);
    })
    .then(() => {
      socket.emit('signal', {
        roomId,
        from: userId,
        to: newUserId,
        signal: peerConnection.localDescription
      });
    });
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        roomId,
        from: userId,
        to: peerId,
        signal: { candidate: event.candidate }
      });
    }
  };

  pc.ontrack = (event) => {
    if (!document.getElementById(peerId)) {
      addVideoStream(peerId, event.streams[0]);
    }
  };

  peers[peerId] = pc;
  return pc;
}

function handleSignal(data) {
  const { from, signal } = data;
  let pc = peers[from];

  if (!pc) {
    pc = createPeerConnection(from);
    if (localStream) {
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
  }

  if (signal.type === 'offer') {
    pc.setRemoteDescription(new RTCSessionDescription(signal))
      .then(() => pc.createAnswer())
      .then(answer => pc.setLocalDescription(answer))
      .then(() => {
        socket.emit('signal', {
          roomId,
          from: userId,
          to: from,
          signal: pc.localDescription
        });
      });
  } else if (signal.type === 'answer') {
    pc.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
  }
}

function addVideoStream(id, stream, muted = false) {
  const videoContainer = document.createElement('div');
  videoContainer.className = 'video-container';
  videoContainer.id = `container-${id}`;

  const video = document.createElement('video');
  video.id = id;
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = muted;

  const speakingIndicator = document.createElement('div');
  speakingIndicator.className = 'speaking-indicator';
  speakingIndicator.id = `speaking-${id}`;

  videoContainer.appendChild(video);
  videoContainer.appendChild(speakingIndicator);
  videoGrid.appendChild(videoContainer);

  if (!muted) {
    monitorAudioLevel(stream, id);
  }
}

function monitorAudioLevel(stream, id) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const analyser = audioContext.createAnalyser();
  const microphone = audioContext.createMediaStreamSource(stream);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  analyser.fftSize = 256;
  microphone.connect(analyser);

  const checkAudioLevel = () => {
    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    const indicator = document.getElementById(`speaking-${id}`);

    if (average > 30) { // Threshold for speaking
      indicator.classList.add('speaking');
    } else {
      indicator.classList.remove('speaking');
    }

    requestAnimationFrame(checkAudioLevel);
  };

  checkAudioLevel();
}

function removeVideoStream(id) {
  const container = document.getElementById(`container-${id}`);
  if (container) {
    container.remove();
  }
}

function toggleCamera() {
  cameraEnabled = !cameraEnabled;
  localStream.getVideoTracks()[0].enabled = cameraEnabled;
  toggleCameraBtn.textContent = cameraEnabled ? '📹 Выключить камеру' : '📷 Включить камеру';
}

function toggleMic() {
  micEnabled = !micEnabled;
  localStream.getAudioTracks()[0].enabled = micEnabled;
  toggleMicBtn.textContent = micEnabled ? '🎤 Выключить микрофон' : '🔇 Включить микрофон';
}

function shareScreen() {
  if (screenSharing) {
    // Stop sharing
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        replaceStream(stream);
        screenSharing = false;
        shareScreenBtn.textContent = 'Демонстрация экрана';
      });
  } else {
    navigator.mediaDevices.getDisplayMedia({ video: true })
      .then(stream => {
        replaceStream(stream);
        screenSharing = true;
        shareScreenBtn.textContent = 'Остановить демонстрацию';
        stream.getVideoTracks()[0].onended = () => {
          shareScreen();
        };
      })
      .catch(err => console.error('Error sharing screen:', err));
  }
}

function replaceStream(newStream) {
  localStream = newStream;
  addVideoStream(userId, newStream, true);
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track.kind === 'video');
    if (sender) {
      sender.replaceTrack(newStream.getVideoTracks()[0]);
    }
  });
}

function leaveRoom() {
  Object.values(peers).forEach(pc => pc.close());
  peers = {};
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  videoGrid.innerHTML = '';
  room.style.display = 'none';
  welcome.style.display = 'block';
  socket.disconnect();
  // Reset variables
  roomId = null;
  cameraEnabled = true;
  micEnabled = true;
  screenSharing = false;
  // Reconnect socket for new session
  socket = io();
}

socket.on('room-full', () => {
  alert('Комната полна (максимум 4 участника)');
});