// Simple Node.js + Express + Socket.IO server for Bridge Bidding Practice
// Run with: node server.js

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;

// Serve static files from current directory
app.use(express.static(__dirname));

// Health check endpoint for Render
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API endpoint to get available rooms (waiting for partner)
app.get('/api/rooms', (req, res) => {
    const availableRooms = [];
    for (const [roomId, room] of rooms.entries()) {
        if (!room.player2) {
            availableRooms.push({
                roomId: roomId,
                hostName: room.player1.name
            });
        }
    }
    res.json(availableRooms);
});

// Store active rooms
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create a new room (Player 1)
    socket.on('create-room', (playerName) => {
        const roomId = uuidv4().substring(0, 8);

        rooms.set(roomId, {
            player1: {
                id: socket.id,
                name: playerName,
                ready: false
            },
            player2: null,
            partnership: null,
            currentHand: null,
            auction: []
        });

        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerNumber = 1;

        socket.emit('room-created', {
            roomId: roomId,
            playerName: playerName,
            playerNumber: 1
        });

        console.log(`Room created: ${roomId} by ${playerName}`);
    });

    // Join an existing room (Player 2)
    socket.on('join-room', (data) => {
        const { roomId, playerName } = data;
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('room-error', 'Room not found. Please check the link or ask your partner for a new one.');
            return;
        }

        if (room.player2) {
            socket.emit('room-error', 'Room is full. This game already has two players.');
            return;
        }

        room.player2 = {
            id: socket.id,
            name: playerName,
            ready: false
        };

        socket.join(roomId);
        socket.roomId = roomId;
        socket.playerNumber = 2;

        // Notify Player 2 that they joined
        socket.emit('room-joined', {
            roomId: roomId,
            playerName: playerName,
            playerNumber: 2,
            partner: room.player1.name
        });

        // Notify Player 1 that their partner joined
        io.to(room.player1.id).emit('partner-joined', {
            partnerName: playerName,
            player1Name: room.player1.name,
            player2Name: playerName
        });

        console.log(`${playerName} joined room: ${roomId} as partner of ${room.player1.name}`);
    });

    // Player ready to start
    socket.on('player-ready', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        if (socket.id === room.player1.id) {
            room.player1.ready = true;
        } else if (room.player2 && socket.id === room.player2.id) {
            room.player2.ready = true;
        }

        // Check if both players are ready
        if (room.player1.ready && room.player2 && room.player2.ready) {
            io.to(roomId).emit('both-players-ready');
        }
    });

    // Set partnership
    socket.on('set-partnership', (data) => {
        const { roomId, partnership } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        room.partnership = partnership;
        io.to(roomId).emit('partnership-set', partnership);
    });

    // Host broadcasts full game state to client
    socket.on('game-state', (data) => {
        const { roomId, state } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        // Only host (player 1) can broadcast state
        if (socket.id !== room.player1.id) return;

        // Send state to Player 2
        if (room.player2) {
            io.to(room.player2.id).emit('game-state', state);
        }
    });

    // Client (Player 2) sends bid to host
    socket.on('client-bid', (data) => {
        const { roomId, bid } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        // Only Player 2 can send client-bid
        if (!room.player2 || socket.id !== room.player2.id) return;

        // Forward to host (Player 1)
        io.to(room.player1.id).emit('client-bid', { bid });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Find and clean up room
        for (const [roomId, room] of rooms.entries()) {
            if (room.player1.id === socket.id) {
                if (room.player2) {
                    io.to(room.player2.id).emit('partner-disconnected');
                }
                rooms.delete(roomId);
                console.log(`Room deleted: ${roomId}`);
            } else if (room.player2 && room.player2.id === socket.id) {
                io.to(room.player1.id).emit('partner-disconnected');
                room.player2 = null;
            }
        }
    });
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Bridge server running on port ${PORT}`);
});
