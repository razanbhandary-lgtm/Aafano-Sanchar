const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/aafano_sanchar', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Message Schema
const messageSchema = new mongoose.Schema({
    text: String,
    sender: String,
    room: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Online Users
let onlineUsers = {};

// Socket.io
io.on('connection', (socket) => {
    // Join room
    socket.on('join_room', (room) => {
        socket.join(room);
        onlineUsers[socket.id] = { room, username: socket.handshake.query.username || 'Guest' };
        io.to(room).emit('user_count', Object.values(onlineUsers).filter(u => u.room === room).length);
        
        // Load previous messages
        Message.find({ room }).limit(50).sort({ timestamp: -1 }).then(messages => {
            socket.emit('load_messages', messages.reverse());
        });
    });

    // Send message
    socket.on('chat_message', async (data) => {
        const { text, room } = data;
        const sender = onlineUsers[socket.id]?.username || 'Anonymous';
        
        const message = new Message({ text, sender, room });
        await message.save();
        
        io.to(room).emit('chat_message', { text, sender, timestamp: message.timestamp });
    });

    // Typing indicator
    socket.on('typing', (data) => {
        socket.to(data.room).emit('user_typing', onlineUsers[socket.id]?.username);
    });

    // Disconnect
    socket.on('disconnect', () => {
        const user = onlineUsers[socket.id];
        if (user) {
            delete onlineUsers[socket.id];
            io.to(user.room).emit('user_count', Object.values(onlineUsers).filter(u => u.room === user.room).length);
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Aafano Sanchar running at http://localhost:${PORT}`);
});
