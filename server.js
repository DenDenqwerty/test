const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// Хранилище комнат и участников
const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (roomId, userId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = [];
    }

    if (rooms[roomId].length >= 4) {
      socket.emit('room-full');
      return;
    }

    rooms[roomId].push(userId);
    socket.join(roomId);

    socket.to(roomId).emit('user-connected', userId);

    socket.on('disconnect', () => {
      rooms[roomId] = rooms[roomId].filter(id => id !== userId);
      socket.to(roomId).emit('user-disconnected', userId);
    });
  });

  socket.on('signal', (data) => {
    socket.to(data.roomId).emit('signal', data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});