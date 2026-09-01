cat > backend/server.js << 'EOF'
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const path = require('path');
const twilio = require('twilio');
const axios = require('axios');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8
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

// ===================== OTP SYSTEM =====================

// Store OTPs temporarily (in production use Redis)
const otpStore = {};

// Twilio Client (for real SMS)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );
}

// Send OTP via SMS (Twilio) or Telegram or Demo
async function sendOTP(phone, otp) {
    const countryCode = phone.replace(/\s/g, '');
    
    // 1. Try Twilio (Real SMS)
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER) {
        try {
            await twilioClient.messages.create({
                body: `🇳🇵 Aafano Sanchar: Your OTP is ${otp}. Do not share this with anyone.`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: countryCode
            });
            console.log(`✅ OTP sent via Twilio to ${countryCode}`);
            return 'sms';
        } catch (error) {
            console.log('❌ Twilio failed:', error.message);
            // Fallback to Telegram
        }
    }

    // 2. Try Telegram (Free alternative)
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        try {
            await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                chat_id: process.env.TELEGRAM_CHAT_ID,
                text: `🇳🇵 Aafano Sanchar OTP for ${countryCode}: ${otp}`
            });
            console.log(`✅ OTP sent via Telegram to ${countryCode}`);
            return 'telegram';
        } catch (error) {
            console.log('❌ Telegram failed:', error.message);
        }
    }

    // 3. Fallback: Demo mode - show in console
    console.log(`📱 DEMO OTP for ${countryCode}: ${otp}`);
    return 'demo';
}

// ===================== API ROUTES =====================

// Send OTP
app.post('/api/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        
        // Validate phone
        if (!phone || phone.length < 10) {
            return res.status(400).json({ 
                success: false, 
                error: 'Please enter a valid phone number' 
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        
        // Store OTP with expiry (5 minutes)
        otpStore[phone] = {
            otp: otp,
            expires: Date.now() + 5 * 60 * 1000 // 5 minutes
        };

        // Send OTP
        const method = await sendOTP(phone, otp);
        
        res.json({
            success: true,
            method: method,
            message: method === 'demo' ? `OTP: ${otp}` : 'OTP sent successfully',
            otp: process.env.DEMO_MODE === 'true' ? otp : undefined
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;
        
        const stored = otpStore[phone];
        if (!stored) {
            return res.status(400).json({ 
                success: false, 
                error: 'OTP expired or not requested' 
            });
        }

        if (stored.expires < Date.now()) {
            delete otpStore[phone];
            return res.status(400).json({ 
                success: false, 
                error: 'OTP expired. Please request a new one.' 
            });
        }

        if (String(stored.otp) !== String(otp)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid OTP' 
            });
        }

        // OTP verified - delete it
        delete otpStore[phone];

        // Find or create user
        let user = await User.findOne({ phone });
        if (!user) {
            user = new User({ 
                phone, 
                name: req.body.name || 'Nepali User' 
            });
            await user.save();
        }

        res.json({
            success: true,
            user,
            message: '✅ Login successful!'
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ===================== MODELS =====================

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

const MessageSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: String,
    mediaUrl: String,
    mediaType: String,
    fileName: String,
    fileSize: Number,
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    delivered: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// ===================== MULTER SETUP =====================

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'demo',
    api_key: process.env.CLOUDINARY_API_KEY || 'demo',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'demo'
});

// ===================== SOCKET.IO =====================

const onlineUsers = {};

io.use((socket, next) => {
    const phone = socket.handshake.auth.phone;
    if (!phone) return next(new Error('Phone required'));
    socket.phone = phone;
    next();
});

io.on('connection', async (socket) => {
    console.log('✅ User connected:', socket.phone);
    
    let user = await User.findOne({ phone: socket.phone });
    if (!user) {
        user = new User({ phone: socket.phone, name: socket.handshake.auth.name || 'Nepali User' });
        await user.save();
    }
    
    onlineUsers[socket.phone] = socket.id;
    user.online = true;
    user.lastSeen = new Date();
    await user.save();
    
    io.emit('user_status', { phone: socket.phone, status: 'online', user });

    socket.on('join_chat', async (chatId) => {
        socket.join(chatId);
        const messages = await Message.find({ chatId })
            .sort({ timestamp: -1 })
            .limit(50)
            .populate('sender', 'name phone profilePic');
        socket.emit('load_messages', messages.reverse());
    });

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

    socket.on('typing', ({ chatId, isTyping }) => {
        socket.to(chatId).emit('user_typing', { 
            phone: socket.phone, 
            isTyping,
            name: user.name 
        });
    });

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

// ===================== UPLOAD ROUTE =====================

app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'No file' });
        
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

// ===================== START SERVER =====================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Aafano Sanchar is running!`);
    console.log(`📱 Open: http://localhost:${PORT}`);
    console.log(`🇳🇵 Nepal ko complete chat app ready cha!`);
});
EOF
