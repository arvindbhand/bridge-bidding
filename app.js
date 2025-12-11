let hands = [];
let currentHand = null;
let selectedPartnership = null;
let player1Position = null;
let player2Position = null;
let currentAuction = [];
let currentBidder = 0;
let dealerIndex = 0;
let auctionComplete = false;
let convention = null;
let allHands = {};

const positions = ['S', 'W', 'N', 'E'];
const positionNames = { 'N': 'North', 'S': 'South', 'E': 'East', 'W': 'West' };

// ==================== MULTIPLAYER LOBBY SYSTEM ====================
let socket = null;
let currentRoomId = null;
let myPlayerNumber = null;
let myPlayerName = null;
let partnerPlayerName = null;

// Check if I am the host (Player 1)
function isHost() {
    return myPlayerNumber === 1;
}

// Initialize Socket.IO connection
function initializeSocket() {
    socket = io();

    // Room created successfully (Player 1 - HOST)
    socket.on('room-created', (data) => {
        currentRoomId = data.roomId;
        myPlayerNumber = data.playerNumber;
        myPlayerName = data.playerName;

        // Show invite link
        const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${data.roomId}`;
        document.getElementById('inviteLink').value = inviteUrl;
        document.getElementById('inviteSection').style.display = 'block';
        document.getElementById('lobbyStatus').innerHTML =
            `<span style="color: #48bb78;">Room created! You are Player 1 (Host): ${myPlayerName}</span>`;
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('playerNameInput').disabled = true;
    });

    // Successfully joined a room (Player 2 - CLIENT)
    socket.on('room-joined', (data) => {
        currentRoomId = data.roomId;
        myPlayerNumber = data.playerNumber;
        myPlayerName = data.playerName;
        partnerPlayerName = data.partner;

        document.getElementById('lobbyStatus').innerHTML =
            `<span style="color: #48bb78;">Joined! You are Player 2: ${myPlayerName}</span>`;
        document.getElementById('joinBtn').disabled = true;
        document.getElementById('playerNameInput').disabled = true;

        // Show both player names
        showPartnerInfo(partnerPlayerName, myPlayerName);
    });

    // Partner joined the room (Player 1 receives this)
    socket.on('partner-joined', (data) => {
        partnerPlayerName = data.partnerName;
        document.getElementById('inviteSection').style.display = 'none';

        // Show both player names
        showPartnerInfo(myPlayerName, partnerPlayerName);
    });

    // Error joining room
    socket.on('room-error', (message) => {
        document.getElementById('lobbyStatus').innerHTML =
            `<span style="color: #e53e3e;">${message}</span>`;
        document.getElementById('joinBtn').disabled = false;
        document.getElementById('playerNameInput').disabled = false;
    });

    // Partner disconnected
    socket.on('partner-disconnected', () => {
        alert('Your partner has disconnected.');
        window.location.href = window.location.pathname;
    });

    // Partnership was set by host
    socket.on('partnership-set', (partnership) => {
        selectedPartnership = partnership;
        if (partnership === 'NS') {
            player1Position = 'S';
            player2Position = 'N';
        } else {
            player1Position = 'W';
            player2Position = 'E';
        }
        document.querySelectorAll('.partnership-btn').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.partnership === partnership);
        });
        updateStartButton();
    });

    // ==================== STATE SYNC (Player 2 receives these) ====================

    // Receive full game state from host
    socket.on('game-state', (state) => {
        if (isHost()) return; // Host doesn't need to receive state

        // Apply the received state
        currentHand = state.currentHand;
        currentAuction = state.auction;
        currentBidder = state.currentBidder;
        dealerIndex = state.dealerIndex;
        auctionComplete = state.auctionComplete;
        selectedPartnership = state.partnership;
        player1Position = state.player1Position;
        player2Position = state.player2Position;

        // Show game screen if not visible
        document.getElementById('setupScreen').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'block';

        // Rebuild hands data
        if (currentHand && currentHand.cards) {
            const cardSets = parseCards(currentHand.cards);
            const adjustedCards = [];
            for (let i = 0; i < 4; i++) {
                adjustedCards[i] = cardSets[(i + dealerIndex) % 4];
            }
            allHands = {};
            positions.forEach((pos, idx) => {
                allHands[pos] = adjustedCards[idx];
            });
            const player1Index = positions.indexOf(player1Position);
            const player2Index = positions.indexOf(player2Position);
            window.player1HandData = formatHand(adjustedCards[player1Index]);
            window.player2HandData = formatHand(adjustedCards[player2Index]);
        }

        // Update display
        document.getElementById('player1Title').textContent = `${partnerPlayerName} - ${positionNames[player1Position]}`;
        document.getElementById('player2Title').textContent = `${myPlayerName} - ${positionNames[player2Position]}`;
        document.getElementById('partnershipDisplay').textContent =
            selectedPartnership === 'NS' ? 'North-South' : 'East-West';
        document.getElementById('dealer').textContent = positionNames[positions[dealerIndex]];
        document.getElementById('vulnerability').textContent = getVulnerabilityText(currentHand.vulnerability);
        document.getElementById('handNumber').textContent = currentHand.boardName || 'Unknown';

        setupBiddingGrid();
        updateAuction();
        updateTurnIndicatorClient();
    });

    // ==================== HOST RECEIVES BIDS FROM CLIENT ====================

    // Host receives bid from Player 2
    socket.on('client-bid', (data) => {
        if (!isHost()) return;

        const { bid } = data;
        // Verify it's actually Player 2's turn
        const currentPos = positions[currentBidder % 4];
        if (currentPos === player2Position) {
            // Apply the bid and broadcast new state
            currentAuction.push(bid);
            currentBidder++;

            if (isAuctionComplete()) {
                auctionComplete = true;
            }

            updateAuction();
            updateTurnIndicator();
            broadcastGameState();
        }
    });
}

// Host broadcasts full game state to Player 2
function broadcastGameState() {
    if (!isHost() || !socket || !currentRoomId) return;

    socket.emit('game-state', {
        roomId: currentRoomId,
        state: {
            currentHand: currentHand,
            auction: currentAuction,
            currentBidder: currentBidder,
            dealerIndex: dealerIndex,
            auctionComplete: auctionComplete,
            partnership: selectedPartnership,
            player1Position: player1Position,
            player2Position: player2Position
        }
    });
}

// Player 2's version of updateTurnIndicator (display only, no AI logic)
function updateTurnIndicatorClient() {
    const indicator = document.getElementById('turnIndicator');
    const currentPos = positions[currentBidder % 4];

    // Always show Player 2's own hand (they are player2Position)
    document.getElementById('player2Spades').textContent = window.player2HandData.S || '-';
    document.getElementById('player2Hearts').textContent = window.player2HandData.H || '-';
    document.getElementById('player2Diamonds').textContent = window.player2HandData.D || '-';
    document.getElementById('player2Clubs').textContent = window.player2HandData.C || '-';

    // Always hide partner's hand
    document.getElementById('player1Spades').textContent = '???';
    document.getElementById('player1Hearts').textContent = '???';
    document.getElementById('player1Diamonds').textContent = '???';
    document.getElementById('player1Clubs').textContent = '???';

    if (auctionComplete) {
        indicator.textContent = 'Bidding Complete';
        indicator.className = 'turn-indicator waiting-indicator';
        disableBidding();
        document.getElementById('showHandsBtn').disabled = false;
        setTimeout(() => showParContractModal(), 500);
        return;
    }

    if (currentPos === player1Position) {
        indicator.textContent = `${partnerPlayerName}'s Turn (${positionNames[currentPos]})`;
        indicator.className = 'turn-indicator';
        document.getElementById('player1Section').classList.add('active');
        document.getElementById('player2Section').classList.remove('active');
        disableBidding();
    } else if (currentPos === player2Position) {
        indicator.textContent = `Your Turn (${positionNames[currentPos]})`;
        indicator.className = 'turn-indicator';
        document.getElementById('player2Section').classList.add('active');
        document.getElementById('player1Section').classList.remove('active');
        enableBidding();
    } else {
        indicator.textContent = `${positionNames[currentPos]}'s Turn (Opponent)`;
        indicator.className = 'turn-indicator waiting-indicator';
        document.getElementById('player1Section').classList.remove('active');
        document.getElementById('player2Section').classList.remove('active');
        disableBidding();
    }
}

// Show partner info and proceed to setup
function showPartnerInfo(p1Name, p2Name) {
    document.getElementById('partnerInfo').style.display = 'block';
    document.getElementById('player1Name').textContent = p1Name;
    document.getElementById('player2Name').textContent = p2Name;

    // After a short delay, proceed to the game setup screen
    setTimeout(() => {
        document.getElementById('lobbyScreen').style.display = 'none';
        document.getElementById('setupScreen').style.display = 'block';
    }, 2000);
}

// Join game button handler
function joinGame() {
    const playerName = document.getElementById('playerNameInput').value.trim();

    if (!playerName) {
        document.getElementById('lobbyStatus').innerHTML =
            `<span style="color: #e53e3e;">Please enter your name</span>`;
        return;
    }

    // Check if there's a room ID in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');

    if (roomId) {
        // Player 2 joining existing room
        document.getElementById('lobbyTitle').textContent = 'Joining Partner\'s Game...';
        socket.emit('join-room', { roomId: roomId, playerName: playerName });
    } else {
        // Player 1 creating new room
        document.getElementById('lobbyTitle').textContent = 'Creating Game Room...';
        socket.emit('create-room', playerName);
    }
}

// Copy invite link to clipboard
function copyInviteLink() {
    const linkInput = document.getElementById('inviteLink');
    linkInput.select();
    document.execCommand('copy');

    // Show feedback
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalText; }, 2000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeSocket();

    // Check if joining via invite link
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (roomId) {
        document.getElementById('lobbyTitle').textContent = 'Join Your Partner\'s Game';
        document.getElementById('joinBtn').textContent = 'Join as Partner';
    }
});

// ==================== END MULTIPLAYER LOBBY SYSTEM ====================

// Load bidding convention
fetch('bidding_convention.json')
    .then(response => response.json())
    .then(data => {
        convention = data;
        console.log('Loaded convention:', convention.name);
    })
    .catch(error => {
        console.error('Failed to load convention:', error);
        alert('Warning: Could not load bidding convention. Opponents will pass.');
    });

// Auto-load handsrecord1.pbn on startup
fetch('handsrecord1.pbn')
    .then(response => response.text())
    .then(content => {
        hands = parsePBNFile(content);
        document.getElementById('fileStatus').innerHTML =
            `<span style="color: #48bb78;">✓ Loaded ${hands.length} hands</span>`;
        updateStartButton();
        console.log('Auto-loaded handsrecord1.pbn:', hands.length, 'hands');
    })
    .catch(error => {
        console.error('Failed to auto-load handsrecord1.pbn:', error);
        document.getElementById('fileStatus').innerHTML =
            `<span style="color: #e53e3e;">Could not auto-load handsrecord1.pbn. Please select a file manually.</span>`;
    });

// Hand evaluation functions
function calculateHCP(handStr) {
    let hcp = 0;
    const values = { 'A': 4, 'K': 3, 'Q': 2, 'J': 1 };
    for (let char of handStr) {
        if (values[char]) {
            hcp += values[char];
        }
    }
    return hcp;
}

function getSuitLength(handStr, suit) {
    const suitMap = { 'S': 0, 'H': 1, 'D': 2, 'C': 3 };
    const parts = handStr.split('S').join('|S').split('H').join('|H')
        .split('D').join('|D').split('C').join('|C').split('|').filter(p => p);

    for (let part of parts) {
        if (part[0] === suit) {
            return part.length - 1;
        }
    }
    return 0;
}

function isBalanced(handStr) {
    const lengths = ['S', 'H', 'D', 'C'].map(s => getSuitLength(handStr, s)).sort((a, b) => b - a);
    const pattern = lengths.join('');

    const balancedPatterns = ['4432', '4333', '5332'];
    return balancedPatterns.includes(pattern);
}

function getLongestSuit(handStr) {
    let longest = { suit: 'C', length: 0 };
    const suits = ['S', 'H', 'D', 'C'];

    for (let suit of suits) {
        const len = getSuitLength(handStr, suit);
        if (len > longest.length) {
            longest = { suit: suit, length: len };
        }
    }
    return longest;
}

function checkConditions(conditions, handStr, partnerBid = null) {
    const hcp = calculateHCP(handStr);

    if (conditions.hcp_min && hcp < conditions.hcp_min) return false;
    if (conditions.hcp_max && hcp > conditions.hcp_max) return false;

    if (conditions.balanced && !isBalanced(handStr)) return false;

    if (conditions.suit) {
        const suitLength = getSuitLength(handStr, conditions.suit);
        if (conditions.suit_length_min && suitLength < conditions.suit_length_min) {
            return false;
        }
    }

    return true;
}

function getAIBid(position) {
    if (!convention) return 'P';

    const handStr = allHands[position];
    if (!handStr) return 'P';

    const partnerPos = getPartner(position);
    const partnerBid = getLastBidByPosition(partnerPos);
    const myLastBid = getLastBidByPosition(position);
    const lastBid = getLastContract();

    let availableBids = [];

    // Determine which set of bids to use
    if (!myLastBid || myLastBid === 'P') {
        // First bid for this position or previously passed
        if (partnerBid && partnerBid !== 'P') {
            // Partner has made a contract bid - respond to partner
            const responses = convention.responses[partnerBid];
            if (responses) {
                availableBids = responses;
            } else {
                availableBids = convention.opening_bids || [];
            }
        } else {
            // No partner bid yet, or partner passed - can make opening bid
            availableBids = convention.opening_bids || [];
        }
    } else {
        // This position has already made a bid - look for rebids
        if (convention.rebids && convention.rebids.default) {
            availableBids = convention.rebids.default;
        } else {
            // If no rebids defined, can make any valid bid
            availableBids = convention.opening_bids || [];
        }
    }

    // Filter bids based on conditions and validity
    availableBids = availableBids.filter(b => {
        if (!checkConditions(b.conditions, handStr, partnerBid)) return false;
        if (b.bid === 'P') return true;
        return isValidBid(b.bid, lastBid);
    });

    availableBids.sort((a, b) => b.priority - a.priority);

    if (availableBids.length > 0) {
        return availableBids[0].bid;
    }

    return 'P';
}

function getPartner(position) {
    const idx = positions.indexOf(position);
    return positions[(idx + 2) % 4];
}

function getLastBidByPosition(position) {
    const posIdx = positions.indexOf(position);
    for (let i = currentAuction.length - 1; i >= 0; i--) {
        const bidderIdx = (dealerIndex + i) % 4;
        if (bidderIdx === posIdx) {
            return currentAuction[i];
        }
    }
    return null;
}

// Load and parse PBN file
document.getElementById('linFile').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const content = event.target.result;
            hands = parsePBNFile(content);
            document.getElementById('fileStatus').innerHTML =
                `<span style="color: #48bb78;">✓ Loaded ${hands.length} hands from ${file.name}</span>`;
            updateStartButton();
        };
        reader.readAsText(file);
    }
});

// Partnership selection
document.querySelectorAll('.partnership-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.partnership-btn').forEach(b => b.classList.remove('selected'));
        this.classList.add('selected');
        selectedPartnership = this.dataset.partnership;

        if (selectedPartnership === 'NS') {
            player1Position = 'S';
            player2Position = 'N';
        } else {
            player1Position = 'W';
            player2Position = 'E';
        }

        // Notify partner of partnership selection
        if (socket && currentRoomId) {
            socket.emit('set-partnership', {
                roomId: currentRoomId,
                partnership: selectedPartnership
            });
        }

        updateStartButton();
    });
});

function updateStartButton() {
    document.getElementById('startBtn').disabled = !(hands.length > 0 && selectedPartnership);
}

document.getElementById('startBtn').addEventListener('click', function() {
    document.getElementById('setupScreen').style.display = 'none';
    document.getElementById('gameScreen').style.display = 'block';
    loadNewHandAndSync();
});

// Load a new hand and sync with partner (Host only initiates new hands)
function loadNewHandAndSync() {
    if (hands.length === 0) return;

    // Only host can start new hands
    if (!isHost() && currentRoomId) {
        // Player 2 waits for host to broadcast new hand state
        return;
    }

    currentHand = hands[Math.floor(Math.random() * hands.length)];

    // Load it locally first
    startHandLocally();

    // Then broadcast full state to Player 2
    broadcastGameState();
}

// Start the hand locally (called by both initiator and receiver)
function startHandLocally() {
    currentAuction = [];
    auctionComplete = false;
    aiBidScheduled = false;  // Reset AI bid flag for new hand

    document.getElementById('showHandsBtn').disabled = true;

    const cardSets = parseCards(currentHand.cards);
    dealerIndex = currentHand.dealer - 1;

    const adjustedCards = [];
    for (let i = 0; i < 4; i++) {
        adjustedCards[i] = cardSets[(i + dealerIndex) % 4];
    }

    // Store all hands for AI bidding
    allHands = {};
    positions.forEach((pos, idx) => {
        allHands[pos] = adjustedCards[idx];
    });

    const player1Index = positions.indexOf(player1Position);
    const player2Index = positions.indexOf(player2Position);

    window.player1HandData = formatHand(adjustedCards[player1Index]);
    window.player2HandData = formatHand(adjustedCards[player2Index]);

    // Hide hands initially
    document.getElementById('player1Spades').textContent = '???';
    document.getElementById('player1Hearts').textContent = '???';
    document.getElementById('player1Diamonds').textContent = '???';
    document.getElementById('player1Clubs').textContent = '???';

    document.getElementById('player2Spades').textContent = '???';
    document.getElementById('player2Hearts').textContent = '???';
    document.getElementById('player2Diamonds').textContent = '???';
    document.getElementById('player2Clubs').textContent = '???';

    // Show player names with positions
    document.getElementById('player1Title').textContent = `${myPlayerNumber === 1 ? myPlayerName : partnerPlayerName} - ${positionNames[player1Position]}`;
    document.getElementById('player2Title').textContent = `${myPlayerNumber === 2 ? myPlayerName : partnerPlayerName} - ${positionNames[player2Position]}`;

    document.getElementById('partnershipDisplay').textContent =
        selectedPartnership === 'NS' ? 'North-South' : 'East-West';
    document.getElementById('dealer').textContent = positionNames[positions[dealerIndex]];
    document.getElementById('vulnerability').textContent = getVulnerabilityText(currentHand.vulnerability);
    document.getElementById('handNumber').textContent = currentHand.boardName || 'Unknown';

    currentBidder = dealerIndex;

    setupBiddingGrid();
    updateAuction();
    updateTurnIndicator();
}

function parsePBNFile(content) {
    const hands = [];
    const lines = content.split('\n');
    let currentHand = {};
    let inOptimumTable = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        if (line.startsWith('[Board "')) {
            if (currentHand.cards) {
                hands.push(currentHand);
            }
            currentHand = {};
            inOptimumTable = false;
            const boardNum = line.match(/\[Board "(\d+)"\]/);
            if (boardNum) {
                currentHand.boardName = 'Board ' + boardNum[1];
            }
        } else if (line.startsWith('[Dealer "')) {
            const dealer = line.match(/\[Dealer "([NESW])"\]/);
            if (dealer) {
                const dealerMap = { 'N': 1, 'E': 2, 'S': 3, 'W': 4 };
                currentHand.dealer = dealerMap[dealer[1]];
            }
        } else if (line.startsWith('[Vulnerable "')) {
            const vuln = line.match(/\[Vulnerable "(.+)"\]/);
            if (vuln) {
                const vulnMap = {
                    'None': 'o',
                    'NS': 'n',
                    'EW': 'e',
                    'All': 'b',
                    'Both': 'b'
                };
                currentHand.vulnerability = vulnMap[vuln[1]] || 'o';
            }
        } else if (line.startsWith('[Deal "')) {
            const dealMatch = line.match(/\[Deal "([NESW]):(.+)"\]/);
            if (dealMatch) {
                const firstSeat = dealMatch[1];
                const deal = dealMatch[2];
                currentHand.cards = convertPBNDealToLIN(deal, firstSeat);
            }
        } else if (line.startsWith('[ParContract "')) {
            const parMatch = line.match(/\[ParContract "(.+)"\]/);
            if (parMatch) {
                currentHand.parContract = parMatch[1];
            }
        } else if (line.startsWith('[OptimumScore "')) {
            const scoreMatch = line.match(/\[OptimumScore "(.+)"\]/);
            if (scoreMatch) {
                currentHand.parScore = scoreMatch[1];
            }
        } else if (line.startsWith('[OptimumResultTable')) {
            inOptimumTable = true;
            currentHand.doubleDummy = {};
        } else if (inOptimumTable && line.match(/^[NESW]\s+(NT|[SHDC])\s+(\d+)/)) {
            const match = line.match(/^([NESW])\s+(NT|[SHDC])\s+(\d+)/);
            if (match) {
                const declarer = match[1];
                const strain = match[2];
                const tricks = parseInt(match[3]);

                if (!currentHand.doubleDummy[declarer]) {
                    currentHand.doubleDummy[declarer] = {};
                }
                currentHand.doubleDummy[declarer][strain] = tricks;
            }
        } else if (inOptimumTable && line.startsWith('[')) {
            inOptimumTable = false;
        }
    }

    if (currentHand.cards) {
        hands.push(currentHand);
    }

    return hands;
}

function convertPBNDealToLIN(deal, firstSeat) {
    // PBN format: "N:KQ3.A42.K98.Q76 ..." (four hands separated by space)
    // LIN format: "SAK3HK42DK98CQ76,..." (suits indicated by letters, comma separated)
    const positions = ['N', 'E', 'S', 'W'];
    const startIdx = positions.indexOf(firstSeat);
    const handStrings = deal.split(' ');

    // Reorder to match dealer position
    const reordered = [];
    for (let i = 0; i < 4; i++) {
        reordered.push(handStrings[i]);
    }

    // Convert each hand from PBN format (spades.hearts.diamonds.clubs) to LIN format
    const linHands = reordered.map(hand => {
        const suits = hand.split('.');
        if (suits.length !== 4) return '';

        let linHand = '';
        linHand += 'S' + suits[0];
        linHand += 'H' + suits[1];
        linHand += 'D' + suits[2];
        linHand += 'C' + suits[3];

        return linHand;
    });

    return linHands.join(',');
}


function parseCards(cardsStr) {
    const hands = ['', '', '', ''];
    const suits = cardsStr.split(',');

    for (let i = 0; i < suits.length; i++) {
        hands[i] = suits[i];
    }

    return hands;
}

function formatHand(handStr) {
    const result = { S: '', H: '', D: '', C: '' };
    let currentSuit = '';

    for (let char of handStr) {
        if (char === 'S' || char === 'H' || char === 'D' || char === 'C') {
            currentSuit = char;
        } else {
            result[currentSuit] += char + ' ';
        }
    }

    return result;
}

// This is the main function called by the "New Hand" button
function loadNewHand() {
    // Use the synchronized version for multiplayer
    loadNewHandAndSync();
}

function getVulnerabilityText(vuln) {
    const vulnMap = {
        'o': 'None',
        'n': 'N/S',
        'e': 'E/W',
        'b': 'Both'
    };
    return vulnMap[vuln] || 'Unknown';
}

function setupBiddingGrid() {
    const grid = document.getElementById('bidGrid');
    grid.innerHTML = '';

    const levels = ['1', '2', '3', '4', '5', '6', '7'];
    const suits = ['C', 'D', 'H', 'S', 'N'];
    const suitSymbols = { 'C': '♣', 'D': '♦', 'H': '♥', 'S': '♠', 'N': 'NT' };

    levels.forEach(level => {
        suits.forEach(suit => {
            const btn = document.createElement('button');
            btn.className = 'bid-btn';
            btn.id = `bid_${level}${suit}`;
            btn.textContent = level + suitSymbols[suit];
            btn.onclick = () => makeBid(level + suit);
            grid.appendChild(btn);
        });
    });
}

function isPlayerTurn() {
    const currentPos = positions[currentBidder % 4];
    return currentPos === player1Position || currentPos === player2Position;
}

// Check if it's specifically MY turn (the current client's turn)
function isMyTurn() {
    const currentPos = positions[currentBidder % 4];
    if (myPlayerNumber === 1) {
        return currentPos === player1Position;
    } else if (myPlayerNumber === 2) {
        return currentPos === player2Position;
    }
    // Fallback for single-player mode (no multiplayer)
    return isPlayerTurn();
}

// Flag to prevent multiple AI bid timers from being scheduled
let aiBidScheduled = false;

// Main turn indicator function - used by Host (Player 1)
// Player 2 uses updateTurnIndicatorClient() instead
function updateTurnIndicator() {
    // Player 2 should use updateTurnIndicatorClient() instead
    if (!isHost() && currentRoomId) {
        updateTurnIndicatorClient();
        return;
    }

    const indicator = document.getElementById('turnIndicator');
    const currentPos = positions[currentBidder % 4];

    if (auctionComplete) {
        indicator.textContent = 'Bidding Complete';
        indicator.className = 'turn-indicator waiting-indicator';
        disableBidding();

        // Enable "Show Hands" button when bidding is complete
        document.getElementById('showHandsBtn').disabled = false;

        // Automatically show par contract and double dummy results
        setTimeout(() => {
            showParContractModal();
        }, 500);
        return;
    }

    // Always show Player 1's own hand (they are player1Position)
    document.getElementById('player1Spades').textContent = window.player1HandData.S || '-';
    document.getElementById('player1Hearts').textContent = window.player1HandData.H || '-';
    document.getElementById('player1Diamonds').textContent = window.player1HandData.D || '-';
    document.getElementById('player1Clubs').textContent = window.player1HandData.C || '-';

    // Always hide partner's hand
    document.getElementById('player2Spades').textContent = '???';
    document.getElementById('player2Hearts').textContent = '???';
    document.getElementById('player2Diamonds').textContent = '???';
    document.getElementById('player2Clubs').textContent = '???';

    if (currentPos === player1Position) {
        indicator.textContent = `Your Turn (${positionNames[currentPos]})`;
        indicator.className = 'turn-indicator';
        document.getElementById('player1Section').classList.add('active');
        document.getElementById('player2Section').classList.remove('active');
        enableBidding();
    } else if (currentPos === player2Position) {
        indicator.textContent = `${partnerPlayerName}'s Turn (${positionNames[currentPos]})`;
        indicator.className = 'turn-indicator';
        document.getElementById('player2Section').classList.add('active');
        document.getElementById('player1Section').classList.remove('active');
        disableBidding();
        // Wait for Player 2's bid to come via client-bid socket event
    } else {
        indicator.textContent = `${positionNames[currentPos]}'s Turn (Opponent - Thinking...)`;
        indicator.className = 'turn-indicator waiting-indicator';
        document.getElementById('player1Section').classList.remove('active');
        document.getElementById('player2Section').classList.remove('active');
        disableBidding();

        // Host generates AI bids
        if (!aiBidScheduled) {
            aiBidScheduled = true;
            setTimeout(() => {
                aiBidScheduled = false;
                if (!auctionComplete) {
                    const currentPosNow = positions[currentBidder % 4];
                    // Double-check it's still an opponent's turn
                    if (currentPosNow !== player1Position && currentPosNow !== player2Position) {
                        const aiBid = getAIBid(currentPosNow);
                        makeAIBid(aiBid);
                    }
                }
            }, 1500);
        }
    }
}

// Make an AI bid (only called by Host/Player 1) and broadcast state to partner
function makeAIBid(bid) {
    if (auctionComplete) return;
    if (!isHost() && currentRoomId) return; // Only host makes AI bids in multiplayer

    // Check that it's still an opponent's turn (not a human player's turn)
    const currentPos = positions[currentBidder % 4];
    if (currentPos === player1Position || currentPos === player2Position) {
        // It's a human player's turn now, don't make AI bid
        return;
    }

    currentAuction.push(bid);
    currentBidder++;

    if (isAuctionComplete()) {
        auctionComplete = true;
    }

    updateAuction();
    updateTurnIndicator();

    // Host broadcasts updated state to Player 2
    broadcastGameState();
}

function makeBid(bid, autoPass = false) {
    if (!autoPass && !isMyTurn()) return;
    if (auctionComplete) return;

    // If I'm Player 2 (client), send bid to host for processing
    if (!isHost() && socket && currentRoomId) {
        socket.emit('client-bid', {
            roomId: currentRoomId,
            bid: bid
        });
        // Don't update local state - wait for host to broadcast back
        return;
    }

    // Host (Player 1) applies bid locally
    currentAuction.push(bid);
    currentBidder++;

    if (isAuctionComplete()) {
        auctionComplete = true;
    }

    updateAuction();
    updateTurnIndicator();

    // Host broadcasts updated state to Player 2
    broadcastGameState();
}

function isAuctionComplete() {
    if (currentAuction.length < 4) return false;

    const lastThree = currentAuction.slice(-3);
    return lastThree.every(bid => bid === 'P');
}

function getLastContract() {
    for (let i = currentAuction.length - 1; i >= 0; i--) {
        const bid = currentAuction[i];
        if (bid !== 'P' && bid !== 'D' && bid !== 'R') {
            return bid;
        }
    }
    return null;
}

function getContractDeclarer(contract) {
    if (!contract) return null;

    // Get the strain from the contract (e.g., "3N" -> "N", "4S" -> "S")
    const strain = contract.substring(1);

    // Find who made the final contract bid
    let contractBidderIdx = -1;
    for (let i = currentAuction.length - 1; i >= 0; i--) {
        const bid = currentAuction[i];
        if (bid === contract) {
            contractBidderIdx = (dealerIndex + i) % 4;
            break;
        }
    }

    if (contractBidderIdx === -1) return null;

    const contractPosition = positions[contractBidderIdx];
    const partnerPosition = getPartner(contractPosition);

    // Find who first bid this strain in the partnership
    for (let i = 0; i < currentAuction.length; i++) {
        const bid = currentAuction[i];
        const bidderIdx = (dealerIndex + i) % 4;
        const bidderPosition = positions[bidderIdx];

        // Check if this bidder is in the contract partnership and bid the strain
        if ((bidderPosition === contractPosition || bidderPosition === partnerPosition) &&
            bid !== 'P' && bid !== 'D' && bid !== 'R' && bid.substring(1) === strain) {
            return bidderPosition;
        }
    }

    return contractPosition; // Fallback to contract bidder
}

function enableBidding() {
    const lastBid = getLastContract();

    document.querySelectorAll('.bid-btn').forEach(btn => {
        const bidId = btn.id.replace('bid_', '');
        btn.disabled = !isValidBid(bidId, lastBid);
    });

    document.getElementById('passBtn').disabled = false;

    const hasOpponentBid = hasOpponentContractBid();
    document.getElementById('doubleBtn').disabled = !canDouble();
    document.getElementById('redoubleBtn').disabled = !canRedouble();
}

function disableBidding() {
    document.querySelectorAll('.bid-btn, .special-bid').forEach(btn => {
        btn.disabled = true;
    });
}

function isValidBid(bid, lastBid) {
    if (!lastBid) return true;

    const level1 = parseInt(bid[0]);
    const suit1 = bid.substring(1);
    const level2 = parseInt(lastBid[0]);
    const suit2 = lastBid.substring(1);

    const suitOrder = { 'C': 0, 'D': 1, 'H': 2, 'S': 3, 'N': 4 };

    if (level1 > level2) return true;
    if (level1 === level2 && suitOrder[suit1] > suitOrder[suit2]) return true;

    return false;
}

function hasOpponentContractBid() {
    for (let i = currentAuction.length - 1; i >= 0; i--) {
        const bid = currentAuction[i];
        if (bid !== 'P' && bid !== 'D' && bid !== 'R') {
            const bidderPos = positions[(dealerIndex + i) % 4];
            return bidderPos !== player1Position && bidderPos !== player2Position;
        }
    }
    return false;
}

function canDouble() {
    if (currentAuction.length === 0) return false;

    const lastBid = currentAuction[currentAuction.length - 1];
    if (lastBid === 'P' || lastBid === 'D' || lastBid === 'R') return false;

    return hasOpponentContractBid();
}

function canRedouble() {
    if (currentAuction.length === 0) return false;

    const lastBid = currentAuction[currentAuction.length - 1];
    return lastBid === 'D' && !hasOpponentContractBid();
}

function updateAuction() {
    const table = document.getElementById('auctionTable');
    table.innerHTML = '';

    positions.forEach(pos => {
        const header = document.createElement('div');
        header.className = 'auction-cell auction-header';
        header.textContent = positionNames[pos];
        table.appendChild(header);
    });

    for (let i = 0; i < dealerIndex; i++) {
        const cell = document.createElement('div');
        cell.className = 'auction-cell';
        cell.textContent = '-';
        table.appendChild(cell);
    }

    currentAuction.forEach((bid, index) => {
        const cell = document.createElement('div');
        cell.className = 'auction-cell';
        cell.textContent = formatBid(bid);

        const bidderPos = positions[(dealerIndex + index) % 4];
        if (bidderPos === player1Position || bidderPos === player2Position) {
            cell.classList.add('user-bid');
        } else {
            cell.classList.add('opponent-bid');
        }

        table.appendChild(cell);
    });
}

function formatBid(bid) {
    if (bid === 'P') return 'Pass';
    if (bid === 'D') return 'Dbl';
    if (bid === 'R') return 'Rdbl';

    const suitMap = { 'C': '♣', 'D': '♦', 'H': '♥', 'S': '♠', 'N': 'NT' };
    const level = bid[0];
    const suit = bid.substring(1);
    return level + suitMap[suit];
}


function showParContractModal() {
    if (!currentHand.parContract || !currentHand.doubleDummy) {
        return; // No par data available
    }

    const modal = document.getElementById('answerModal');
    const content = document.getElementById('fullAuction');
    const resultDiv = document.getElementById('contractResult');

    const yourContract = getLastContract();
    const yourDeclarer = getContractDeclarer(yourContract);

    let resultHTML = '<div style="text-align: center; margin-bottom: 20px;">';
    resultHTML += '<h3 style="color: #2d3748; margin-bottom: 10px;">Bidding Complete</h3>';
    resultHTML += '</div>';

    // Your contract
    resultHTML += '<div style="padding: 15px; background: #c6f6d5; border: 2px solid #48bb78; border-radius: 8px; text-align: center; margin-bottom: 20px;">';
    resultHTML += '<h4 style="margin-bottom: 10px; color: #22543d;">Your Partnership Contract</h4>';
    if (yourContract && yourDeclarer) {
        resultHTML += `<div style="font-size: 24px; font-weight: bold; color: #22543d;">${formatBid(yourContract)} by ${yourDeclarer}</div>`;
    } else {
        resultHTML += `<div style="font-size: 24px; font-weight: bold; color: #22543d;">Passed Out</div>`;
    }
    resultHTML += '</div>';

    // Par contract
    resultHTML += '<div style="padding: 15px; background: #e6fffa; border: 2px solid #319795; border-radius: 8px; text-align: center; margin-bottom: 20px;">';
    resultHTML += '<h4 style="margin-bottom: 10px; color: #234e52;">Par Contract (Double Dummy)</h4>';
    resultHTML += `<div style="font-size: 24px; font-weight: bold; color: #234e52;">${currentHand.parContract}</div>`;
    resultHTML += `<div style="margin-top: 5px; color: #2c7a7b; font-size: 16px;">Optimum Score: ${currentHand.parScore}</div>`;
    resultHTML += '</div>';

    // Display all four hands around a table
    resultHTML += '<div style="margin: 20px 0;">';
    resultHTML += '<h4 style="margin-bottom: 15px; color: #2d3748; text-align: center;">All Four Hands</h4>';

    const displayHand = (position) => {
        const hand = formatHand(allHands[position]);
        const isPartnership = (position === player1Position || position === player2Position);
        const bgColor = isPartnership ? '#e6f7ff' : '#ffe6e6';
        const borderColor = isPartnership ? '#4299e1' : '#f56565';

        let html = `<div style="padding: 10px; background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 8px;">`;
        html += `<div style="font-weight: bold; text-align: center; margin-bottom: 6px; color: #2d3748;">${positionNames[position]}</div>`;
        html += '<div style="font-family: monospace; font-size: 12px;">';
        html += `<div style="padding: 3px; background: white; margin: 2px 0; border-radius: 3px;"><span style="color: #000;">♠</span> ${hand.S || '-'}</div>`;
        html += `<div style="padding: 3px; background: white; margin: 2px 0; border-radius: 3px;"><span style="color: #ff0000;">♥</span> ${hand.H || '-'}</div>`;
        html += `<div style="padding: 3px; background: white; margin: 2px 0; border-radius: 3px;"><span style="color: #ff8800;">♦</span> ${hand.D || '-'}</div>`;
        html += `<div style="padding: 3px; background: white; margin: 2px 0; border-radius: 3px;"><span style="color: #008800;">♣</span> ${hand.C || '-'}</div>`;
        html += '</div></div>';
        return html;
    };

    // Table layout: North at top, South at bottom, West left, East right
    resultHTML += '<div style="display: grid; grid-template-columns: 1fr 2fr 1fr; grid-template-rows: auto auto auto; gap: 10px; max-width: 500px; margin: 0 auto;">';

    // Row 1: North (center)
    resultHTML += '<div></div>'; // empty left
    resultHTML += displayHand('N'); // North top center
    resultHTML += '<div></div>'; // empty right

    // Row 2: West, Table, East
    resultHTML += displayHand('W'); // West left
    resultHTML += '<div style="background: #2f855a; border-radius: 8px; display: flex; align-items: center; justify-content: center; min-height: 80px; color: white; font-weight: bold; font-size: 14px;">TABLE</div>'; // Table center
    resultHTML += displayHand('E'); // East right

    // Row 3: South (center)
    resultHTML += '<div></div>'; // empty left
    resultHTML += displayHand('S'); // South bottom center
    resultHTML += '<div></div>'; // empty right

    resultHTML += '</div></div>';

    // Double Dummy Makes Table
    resultHTML += '<div style="margin-top: 20px;">';
    resultHTML += '<h4 style="margin-bottom: 10px; color: #2d3748; text-align: center;">Double Dummy Tricks</h4>';
    resultHTML += '<table style="width: 100%; border-collapse: collapse; font-size: 14px;">';
    resultHTML += '<thead><tr style="background: #2d3748; color: white;">';
    resultHTML += '<th style="padding: 8px; border: 1px solid #cbd5e0;">Declarer</th>';
    resultHTML += '<th style="padding: 8px; border: 1px solid #cbd5e0;">♣ Clubs</th>';
    resultHTML += '<th style="padding: 8px; border: 1px solid #cbd5e0;">♦ Diamonds</th>';
    resultHTML += '<th style="padding: 8px; border: 1px solid #cbd5e0;">♥ Hearts</th>';
    resultHTML += '<th style="padding: 8px; border: 1px solid #cbd5e0;">♠ Spades</th>';
    resultHTML += '<th style="padding: 8px; border: 1px solid #cbd5e0;">NT</th>';
    resultHTML += '</tr></thead><tbody>';

    const declarers = ['N', 'S', 'E', 'W'];
    const strains = ['C', 'D', 'H', 'S', 'NT'];

    declarers.forEach(declarer => {
        const bgColor = (declarer === 'N' || declarer === 'S') ? '#e6f7ff' : '#ffe6e6';
        resultHTML += `<tr style="background: ${bgColor};">`;
        resultHTML += `<td style="padding: 8px; border: 1px solid #cbd5e0; font-weight: bold; text-align: center;">${positionNames[declarer]}</td>`;

        strains.forEach(strain => {
            const tricks = currentHand.doubleDummy[declarer]?.[strain] || '-';
            resultHTML += `<td style="padding: 8px; border: 1px solid #cbd5e0; text-align: center;">${tricks}</td>`;
        });

        resultHTML += '</tr>';
    });

    resultHTML += '</tbody></table>';
    resultHTML += '</div>';

    resultDiv.innerHTML = resultHTML;
    content.innerHTML = '';

    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('answerModal').style.display = 'none';
}
