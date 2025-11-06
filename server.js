// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  // if you want to restrict origins in production, set cors.origin appropriately
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static client files from "public" (you can put index.html here)
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store (simple). Replace with DB in production.
const MAX_HISTORY = 500;
const rooms = {
  general: {
    name: 'General',
    desc: 'A friendly demo room',
    messages: []
  },
  dev: {
    name: 'Dev Talk',
    desc: 'Share code & tips',
    messages: []
  },
  random: {
    name: 'Random',
    desc: 'Memes, ideas & more',
    messages: []
  }
};

// utility
const now = () => Date.now();
const uid = (n=6) => Math.random().toString(36).slice(2, 2 + n);

// Socket.IO events
io.on('connection', (socket) => {
  // client should send: {room, name}
  socket.on('join', ({ room = 'general', name = 'Anon' }) => {
    socket.join(room);
    socket.data.name = name || 'Anon';
    socket.data.room = room;
    socket.data.id = socket.id;

    // send room list and metadata
    socket.emit('rooms:list', Object.keys(rooms).map(id => ({ id, ...rooms[id], messages: undefined })));

    // send recent history for room
    const history = (rooms[room] && rooms[room].messages) ? rooms[room].messages.slice(-200) : [];
    socket.emit('history', history);

    // notify others
    socket.to(room).emit('system', {
      type: 'join',
      userId: socket.id,
      name: socket.data.name,
      ts: now()
    });

    // optional: broadcast user list for simple presence
    const clients = Array.from(io.sockets.adapter.rooms.get(room) || []).map(sid => {
      const s = io.sockets.sockets.get(sid);
      return { id: sid, name: s?.data?.name || 'Anon' };
    });
    io.to(room).emit('presence', clients);
  });

  socket.on('message', ({ text }) => {
    const room = socket.data.room || 'general';
    const msg = {
      id: 'm_' + uid(8),
      room,
      userId: socket.id,
      name: socket.data.name || 'Anon',
      text: String(text || ''),
      ts: now()
    };
    // store
    if (!rooms[room]) rooms[room] = { name: room, desc: '', messages: [] };
    rooms[room].messages.push(msg);
    if (rooms[room].messages.length > MAX_HISTORY) rooms[room].messages.shift();

    // broadcast to room
    io.to(room).emit('message', msg);
  });

  socket.on('createRoom', ({ id, name, desc }) => {
    if (!id) id = (name || 'room').toLowerCase().replace(/\s+/g, '-');
    if (!rooms[id]) rooms[id] = { name: name || id, desc: desc || '', messages: [] };
    io.emit('rooms:list', Object.keys(rooms).map(id => ({ id, ...rooms[id], messages: undefined })));
  });

  socket.on('disconnecting', () => {
    const room = socket.data.room;
    if (room) {
      socket.to(room).emit('system', {
        type: 'leave',
        userId: socket.id,
        name: socket.data.name || 'Anon',
        ts: now()
      });

      const clients = Array.from(io.sockets.adapter.rooms.get(room) || []).map(sid => {
        const s = io.sockets.sockets.get(sid);
        return { id: sid, name: s?.data?.name || 'Anon' };
      });
      io.to(room).emit('presence', clients);
    }
  });

  socket.on('disconnect', () => {});
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
