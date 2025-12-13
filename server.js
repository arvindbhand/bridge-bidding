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

// API endpoint to get available rooms
app.get('/api/rooms', (req, res) => {
    const availableRooms = [];
    for (const [roomId, room] of rooms.entries()) {
        const occupiedSeats = [];
        if (room.north) occupiedSeats.push('N');
        if (room.south) occupiedSeats.push('S');
        if (room.east) occupiedSeats.push('E');
        if (room.west) occupiedSeats.push('W');

        if (occupiedSeats.length < 4) {
            availableRooms.push({
                roomId: roomId,
                hostName: room.host.name,
                hostPosition: room.host.position,
                occupiedSeats: occupiedSeats,
                availableSeats: ['N', 'S', 'E', 'W'].filter(s => !occupiedSeats.includes(s))
            });
        }
    }
    res.json(availableRooms);
});

// Store active rooms
const rooms = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Create a new room
    socket.on('create-room', (data) => {
        const { playerName, position } = data;

        // Limit to maximum 1 room at a time
        if (rooms.size >= 1) {
            socket.emit('room-error', 'A room already exists. Please join the existing room instead.');
            return;
        }

        const roomId = uuidv4().substring(0, 8);

        const room = {
            host: {
                id: socket.id,
                name: playerName,
                position: position
            },
            north: null,
            south: null,
            east: null,
            west: null,
            currentHand: null,
            auction: []
        };

        // Set the host's position
        room[position.toLowerCase()] = {
            id: socket.id,
            name: playerName,
            ready: false
        };

        rooms.set(roomId, room);

        socket.join(roomId);
        socket.roomId = roomId;
        socket.position = position;

        socket.emit('room-created', {
            roomId: roomId,
            playerName: playerName,
            position: position
        });

        console.log(`Room created: ${roomId} by ${playerName} at ${position}`);
    });

    // Join an existing room with seat selection
    socket.on('join-room', (data) => {
        const { roomId, playerName, position, joinAs } = data;
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('room-error', 'Room not found. Please check the link or ask for a new one.');
            return;
        }

        if (socket.id === room.host.id) {
            socket.emit('room-error', 'You cannot join your own room. Share the invite link with others.');
            return;
        }

        // Check if requested position is available
        if (room[position.toLowerCase()]) {
            socket.emit('room-error', `The ${position} seat is already taken. Please choose another seat.`);
            return;
        }

        // Add player to the room
        room[position.toLowerCase()] = {
            id: socket.id,
            name: playerName,
            ready: false
        };

        socket.join(roomId);
        socket.roomId = roomId;
        socket.position = position;

        // Determine partner and opponents
        const partnerPosition = getPartnerPosition(position);
        const opponentPositions = getOpponentPositions(position);

        const partner = room[partnerPosition.toLowerCase()];
        const isPartner = joinAs === 'partner';

        // Gather all current players in the room to send to the joining player
        const currentPlayers = {};
        ['N', 'S', 'E', 'W'].forEach(pos => {
            const player = room[pos.toLowerCase()];
            if (player) {
                currentPlayers[pos] = { name: player.name };
            }
        });

        // Notify the joining player
        socket.emit('room-joined', {
            roomId: roomId,
            playerName: playerName,
            position: position,
            joinAs: joinAs,
            partnerName: partner ? partner.name : null,
            hostName: room.host.name,
            hostPosition: room.host.position,
            currentPlayers: currentPlayers
        });

        // Notify all other players in the room
        socket.to(roomId).emit('player-joined', {
            playerName: playerName,
            position: position,
            joinAs: joinAs
        });

        console.log(`${playerName} joined room: ${roomId} at ${position} as ${joinAs}`);
    });

    // Get available seats for a room
    socket.on('get-available-seats', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) {
            socket.emit('available-seats', { error: 'Room not found' });
            return;
        }

        const availableSeats = [];
        ['N', 'S', 'E', 'W'].forEach(pos => {
            if (!room[pos.toLowerCase()]) {
                availableSeats.push(pos);
            }
        });

        const hostPosition = room.host.position;
        const partnerPosition = getPartnerPosition(hostPosition);
        const opponentPositions = getOpponentPositions(hostPosition);

        socket.emit('available-seats', {
            availableSeats: availableSeats,
            hostPosition: hostPosition,
            partnerPosition: partnerPosition,
            opponentPositions: opponentPositions,
            occupiedSeats: {
                N: room.north ? room.north.name : null,
                S: room.south ? room.south.name : null,
                E: room.east ? room.east.name : null,
                W: room.west ? room.west.name : null
            }
        });
    });

    // Helper function to get partner position
    function getPartnerPosition(position) {
        const partners = { 'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E' };
        return partners[position];
    }

    // Helper function to get opponent positions
    function getOpponentPositions(position) {
        const opponents = {
            'N': ['E', 'W'],
            'S': ['E', 'W'],
            'E': ['N', 'S'],
            'W': ['N', 'S']
        };
        return opponents[position];
    }

    // Player ready to start
    socket.on('player-ready', (roomId) => {
        const room = rooms.get(roomId);
        if (!room) return;

        // Find the player and mark them ready
        ['north', 'south', 'east', 'west'].forEach(pos => {
            if (room[pos] && socket.id === room[pos].id) {
                room[pos].ready = true;
            }
        });

        // Check if all present players are ready
        const presentPlayers = [];
        ['north', 'south', 'east', 'west'].forEach(pos => {
            if (room[pos]) {
                presentPlayers.push(room[pos]);
            }
        });

        const allReady = presentPlayers.length >= 2 && presentPlayers.every(p => p.ready);
        if (allReady) {
            io.to(roomId).emit('all-players-ready');
        }
    });

    // Host broadcasts full game state to all clients
    socket.on('game-state', (data) => {
        const { roomId, state } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        // Only host can broadcast state
        if (socket.id !== room.host.id) return;

        // Send state to all other players
        socket.to(roomId).emit('game-state', state);
    });

    // Client sends bid to host
    socket.on('client-bid', (data) => {
        const { roomId, bid, position } = data;
        const room = rooms.get(roomId);
        if (!room) return;

        // Verify the player is in the room and it's their bid
        const player = room[position.toLowerCase()];
        if (!player || socket.id !== player.id) return;

        // Forward to host
        io.to(room.host.id).emit('client-bid', { bid, position });
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        // Find and clean up room
        for (const [roomId, room] of rooms.entries()) {
            let playerDisconnected = false;
            let disconnectedPosition = null;

            // Check each position
            ['north', 'south', 'east', 'west'].forEach(pos => {
                if (room[pos] && room[pos].id === socket.id) {
                    playerDisconnected = true;
                    disconnectedPosition = pos.toUpperCase();
                    room[pos] = null;
                }
            });

            if (playerDisconnected) {
                // Check if any human players remain in the room
                const remainingPlayers = ['north', 'south', 'east', 'west'].filter(pos => room[pos] !== null);

                if (remainingPlayers.length === 0) {
                    // No players left, delete the room
                    rooms.delete(roomId);
                    console.log(`Room deleted: ${roomId} (all players disconnected)`);
                } else if (socket.id === room.host.id) {
                    // Host disconnected but others remain - notify and close room
                    io.to(roomId).emit('host-disconnected');
                    rooms.delete(roomId);
                    console.log(`Room deleted: ${roomId} (host disconnected)`);
                } else {
                    // Non-host player disconnected, notify others
                    io.to(roomId).emit('player-disconnected', {
                        position: disconnectedPosition
                    });
                }
            }
        }
    });
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`Bridge server running on port ${PORT}`);
});
