const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8 // 100MB for file transfers
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));
app.use('/uploads', express.static('uploads'));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/aafano_sanchar', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Cloudinary Config (for media uploads)
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'demo',
    api_key: process.env.CLOUDINARY_API_KEY || 'demo',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'demo'
});

// ===================== MODELS =====================

// User Schema
const UserSchema = new mongoose.Schema({
    phone: { type: String, unique: true, required: true },
    name: { type: String, default: 'Nepali User' },
    profilePic: { type: String, default: 'https://via.placeholder.com/50' },
    status: { type: String, default: '🇳🇵 Nepal ma baschu' },
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    contacts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});
const User = mongoose.model('User', UserSchema);

// Message Schema
const MessageSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    mediaUrl: String,
    mediaType: String, // 'image', 'video', 'audio', 'document'
    fileName: String,
    fileSize: Number,
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    delivered: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// ===================== MULTER SETUP (File Upload) =====================

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// ===================== SOCKET.IO =====================

const onlineUsers = {};
const typingUsers = {};

io.use((socket, next) => {
    const phone = socket.handshake.auth.phone;
    if (!phone) return next(new Error('Phone required'));
    socket.phone = phone;
    next();
});

io.on('connection', async (socket) => {
    console.log('✅ User connected:', socket.phone);
    
    // Get user from DB
    let user = await User.findOne({ phone: socket.phone });
    if (!user) {
        user = new User({ phone: socket.phone, name: socket.handshake.auth.name || 'Nepali User' });
        await user.save();
    }
    
    // Update online status
    onlineUsers[socket.phone] = socket.id;
    user.online = true;
    user.lastSeen = new Date();
    await user.save();
    
    // Broadcast online status
    io.emit('user_status', { phone: socket.phone, status: 'online', user: user });

    // ===== JOIN CHAT ROOM =====
    socket.on('join_chat', async (chatId) => {
        socket.join(chatId);
        // Load last 50 messages
        const messages = await Message.find({ chatId })
            .sort({ timestamp: -1 })
            .limit(50)
            .populate('sender', 'name phone profilePic');
        socket.emit('load_messages', messages.reverse());
    });

    // ===== SEND MESSAGE =====
    socket.on('send_message', async (data) => {
        const { chatId, text, mediaUrl, mediaType, fileName, fileSize } = data;
        
        const message = new Message({
            chatId,
            sender: user._id,
            text,
            mediaUrl,
            mediaType,
            fileName,
            fileSize,
            readBy: [user._id]
        });
        await message.save();
        
        const populatedMessage = await Message.findById(message._id)
            .populate('sender', 'name phone profilePic');
        
        io.to(chatId).emit('receive_message', populatedMessage);
    });

    // ===== TYPING INDICATOR =====
    socket.on('typing', ({ chatId, isTyping }) => {
        if (isTyping) {
            typingUsers[chatId] = socket.phone;
        } else {
            delete typingUsers[chatId];
        }
        socket.to(chatId).emit('user_typing', { 
            phone: socket.phone, 
            isTyping: isTyping,
            name: user.name 
        });
    });

    // ===== READ RECEIPT =====
    socket.on('mark_read', async ({ chatId, messageId }) => {
        await Message.findByIdAndUpdate(messageId, {
            $addToSet: { readBy: user._id }
        });
        io.to(chatId).emit('message_read', { messageId, phone: socket.phone });
    });

    // ===== VOICE CALL =====
    socket.on('voice_call', ({ targetPhone, chatId }) => {
        const targetSocketId = onlineUsers[targetPhone];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_voice_call', {
                from: socket.phone,
                name: user.name,
                chatId
            });
        }
    });

    // ===== VIDEO CALL =====
    socket.on('video_call', ({ targetPhone, chatId }) => {
        const targetSocketId = onlineUsers[targetPhone];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_video_call', {
                from: socket.phone,
                name: user.name,
                chatId
            });
        }
    });

    // ===== WEBRTC SIGNALING =====
    socket.on('webrtc_signal', ({ targetPhone, signal, chatId }) => {
        const targetSocketId = onlineUsers[targetPhone];
        if (targetSocketId) {
            io.to(targetSocketId).emit('webrtc_signal', {
                from: socket.phone,
                signal,
                chatId
            });
        }
    });

    // ===== DISCONNECT =====
    socket.on('disconnect', async () => {
        console.log('❌ User disconnected:', socket.phone);
        delete onlineUsers[socket.phone];
        await User.findOneAndUpdate(
            { phone: socket.phone },
            { online: false, lastSeen: new Date() }
        );
        io.emit('user_status', { phone: socket.phone, status: 'offline' });
    });
});

// ===================== API ROUTES =====================

// Send OTP (simplified - in production use Twilio)
app.post('/api/send-otp', async (req, res) => {
    const { phone } = req.body;
    const otp = Math.floor(1000 + Math.random() * 9000);
    // In production: Send SMS via Twilio
    // For demo: Return OTP
    res.json({ success: true, otp });
});

// Verify OTP and Login
app.post('/api/login', async (req, res) => {
    const { phone, name } = req.body;
    let user = await User.findOne({ phone });
    if (!user) {
        user = new User({ phone, name: name || 'Nepali User' });
        await user.save();
    }
    res.json({ success: true, user });
});

// Upload File
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file' });
        
        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(file.path, {
            resource_type: 'auto',
            folder: 'aafano_sanchar'
        });
        
        res.json({
            success: true,
            url: result.secure_url,
            type: result.resource_type,
            name: file.originalname,
            size: file.size
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get User Profile
app.get('/api/user/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone });
    res.json(user);
});

// Update Profile
app.put('/api/user/:phone', async (req, res) => {
    const user = await User.findOneAndUpdate(
        { phone: req.params.phone },
        req.body,
        { new: true }
    );
    res.json(user);
});

// Get Contacts
app.get('/api/contacts/:phone', async (req, res) => {
    const user = await User.findOne({ phone: req.params.phone })
        .populate('contacts', 'name phone profilePic online status');
    res.json(user?.contacts || []);
});

// Add Contact
app.post('/api/contacts', async (req, res) => {
    const { phone, contactPhone } = req.body;
    const user = await User.findOne({ phone });
    const contact = await User.findOne({ phone: contactPhone });
    if (contact && !user.contacts.includes(contact._id)) {
        user.contacts.push(contact._id);
        await user.save();
    }
    res.json({ success: true });
});

// ===================== START SERVER =====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Aafano Sanchar is running!`);
    console.log(`📱 Open: http://localhost:${PORT}`);
    console.log(`🇳🇵 Nepal ko complete chat app ready cha!`);
});
