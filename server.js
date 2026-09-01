const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Static files serve karo (frontend ke liye)
app.use(express.static('public'));

// Jab koi user connect kare
io.on('connection', (socket) => {
    console.log('✅ Naya user connected:', socket.id);

    // Jab user message bheje
    socket.on('chat_message', (msg) => {
        console.log('📩 Message aaya:', msg);
        // Sabhi connected users ko message bhejo
        io.emit('chat_message', msg);
    });

    // Jab user disconnect kare
    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`✅ Aafano Sanchar server chalu: http://localhost:${PORT}`);
});
