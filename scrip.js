const socket = io();

let username = localStorage.getItem('username') || 'Nepali User';
let currentRoom = 'main';

// DOM Elements
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const userCount = document.getElementById('userCount');
const typingIndicator = document.getElementById('typingIndicator');

// Set username
function setUsername() {
    username = document.getElementById('username').value || 'Guest';
    localStorage.setItem('username', username);
    socket.auth = { username };
    socket.disconnect().connect();
}

// Join room
socket.emit('join_room', currentRoom);

// Load previous messages
socket.on('load_messages', (messages) => {
    messages.forEach(msg => displayMessage(msg));
});

// Receive new message
socket.on('chat_message', (data) => {
    displayMessage(data);
});

// Display message
function displayMessage(data) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${data.sender === username ? 'sent' : 'received'}`;
    
    const senderSpan = document.createElement('div');
    senderSpan.className = 'sender';
    senderSpan.textContent = data.sender;
    
    const textSpan = document.createElement('div');
    textSpan.textContent = data.text;
    
    const timeSpan = document.createElement('div');
    timeSpan.className = 'time';
    timeSpan.textContent = new Date(data.timestamp).toLocaleTimeString('ne-NP');
    
    msgDiv.appendChild(senderSpan);
    msgDiv.appendChild(textSpan);
    msgDiv.appendChild(timeSpan);
    
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Send message
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    
    socket.emit('chat_message', { text, room: currentRoom });
    messageInput.value = '';
}

// Emoji support
function sendEmoji() {
    const emojis = ['😊', '❤️', '🇳🇵', '🙏', '🎉', '😄', '👍', '🤣'];
    const random = emojis[Math.floor(Math.random() * emojis.length)];
    messageInput.value += random;
}

// Typing indicator
messageInput.addEventListener('input', () => {
    socket.emit('typing', { room: currentRoom });
});

socket.on('user_typing', (user) => {
    typingIndicator.textContent = user ? `${user} लेख्दैछ...` : '';
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => typingIndicator.textContent = '', 3000);
});

// Update user count
socket.on('user_count', (count) => {
    userCount.textContent = count;
});

// Enter key
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Nepali date
function updateNepaliDate() {
    const now = new Date();
    document.getElementById('nepaliDate').textContent = 
        now.toLocaleDateString('ne-NP', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
}
updateNepaliDate();
