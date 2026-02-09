const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static('public'));

// Store room and user information
const rooms = new Map();
const users = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // User joins a room
    socket.on('join-room', ({ roomId, username }) => {
        console.log(`${username} (${socket.id}) joining room: ${roomId}`);
        
        // Leave previous room if any
        const previousRoom = users.get(socket.id)?.roomId;
        if (previousRoom) {
            socket.leave(previousRoom);
            removeUserFromRoom(previousRoom, socket.id);
            socket.to(previousRoom).emit('user-left', { userId: socket.id });
        }

        // Join new room
        socket.join(roomId);
        
        // Store user info
        users.set(socket.id, { username, roomId, isSpeaking: false });

        // Add to room
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
        }
        rooms.get(roomId).add(socket.id);

        // Get all users in room
        const usersInRoom = Array.from(rooms.get(roomId) || [])
            .map(userId => ({
                userId,
                username: users.get(userId)?.username || 'Unknown',
                isSpeaking: users.get(userId)?.isSpeaking || false
            }));

        // Send existing users to the new user
        socket.emit('room-users', usersInRoom.filter(u => u.userId !== socket.id));

        // Notify others in room about new user
        socket.to(roomId).emit('user-joined', {
            userId: socket.id,
            username,
            isSpeaking: false
        });

        // Send room member counts to everyone
        broadcastRoomCounts();
    });

    // WebRTC signaling
    socket.on('offer', ({ offer, targetUserId }) => {
        console.log(`Offer from ${socket.id} to ${targetUserId}`);
        io.to(targetUserId).emit('offer', {
            offer,
            fromUserId: socket.id,
            username: users.get(socket.id)?.username
        });
    });

    socket.on('answer', ({ answer, targetUserId }) => {
        console.log(`Answer from ${socket.id} to ${targetUserId}`);
        io.to(targetUserId).emit('answer', {
            answer,
            fromUserId: socket.id
        });
    });

    socket.on('ice-candidate', ({ candidate, targetUserId }) => {
        io.to(targetUserId).emit('ice-candidate', {
            candidate,
            fromUserId: socket.id
        });
    });

    // Voice activity
    socket.on('speaking-status', ({ isSpeaking }) => {
        const user = users.get(socket.id);
        if (user) {
            user.isSpeaking = isSpeaking;
            const roomId = user.roomId;
            
            // Broadcast to others in room
            socket.to(roomId).emit('user-speaking', {
                userId: socket.id,
                isSpeaking
            });
        }
    });

    // Leave room
    socket.on('leave-room', () => {
        handleUserLeave(socket);
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        handleUserLeave(socket);
    });
});

function handleUserLeave(socket) {
    const user = users.get(socket.id);
    if (user && user.roomId) {
        const roomId = user.roomId;
        
        // Remove from room
        removeUserFromRoom(roomId, socket.id);
        
        // Notify others
        socket.to(roomId).emit('user-left', { userId: socket.id });
        
        // Leave socket room
        socket.leave(roomId);
    }
    
    // Remove user
    users.delete(socket.id);
    
    // Broadcast updated counts
    broadcastRoomCounts();
}

function removeUserFromRoom(roomId, userId) {
    const room = rooms.get(roomId);
    if (room) {
        room.delete(userId);
        if (room.size === 0) {
            rooms.delete(roomId);
        }
    }
}

function broadcastRoomCounts() {
    const counts = {
        raid: rooms.get('raid')?.size || 0,
        dungeon: rooms.get('dungeon')?.size || 0,
        pvp: rooms.get('pvp')?.size || 0,
        social: rooms.get('social')?.size || 0
    };
    
    io.emit('room-counts', counts);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎮 Guild Voice server running on port ${PORT}`);
    console.log(`📡 Ready for voice connections!`);
});
