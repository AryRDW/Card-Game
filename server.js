const path = require("node:path");
const http = require("node:http");
const { randomUUID } = require("node:crypto");

const express = require("express");
const { Server } = require("socket.io");

const {
  MAX_PLAYERS,
  MIN_PLAYERS,
  SUITS,
  SUIT_NAMES,
  buildBidCycle,
  calculateRoundPoints,
  createGameDeck,
  dealEqually,
  getBidTotal,
  getForbiddenLastBid,
  getTotalHandsForPlayerCount,
  isLegalPlay,
  pickTrickWinner,
  shuffleDeck,
  sortHand,
} = require("./lib/game");

const PORT = Number(process.env.PORT) || 3000;
const ROOM_CODE_LENGTH = 5;
const RECENT_MESSAGES_LIMIT = 10;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/party/:roomCode", (_request, response) => {
  response.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

function sanitizeName(rawName) {
  return String(rawName || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

function normalizeName(rawName) {
  return sanitizeName(rawName).toLowerCase();
}

function createPlayer(socketId, name, seat) {
  return {
    id: randomUUID(),
    socketId,
    name,
    seat,
    hand: [],
    bid: null,
    tricksWon: 0,
    points: 0,
    lastRoundPoints: null,
    connected: true,
  };
}

function createRoom(code, hostPlayer) {
  return {
    code,
    hostId: hostPlayer.id,
    players: [hostPlayer],
    lastScoredPlayerCount: null,
    state: "lobby",
    powerSuit: null,
    firstBidderId: null,
    currentBidderId: null,
    bidOrder: [],
    currentTrick: [],
    lastTrick: null,
    leaderId: null,
    turnId: null,
    completedHands: 0,
    finalResults: null,
    finalReason: null,
    messages: [],
  };
}

function addMessage(room, text) {
  room.messages = [text, ...room.messages].slice(0, RECENT_MESSAGES_LIMIT);
}

function reseatPlayers(room) {
  room.players.forEach((player, index) => {
    player.seat = index;
  });
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  while (true) {
    const code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
      alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join("");

    if (!rooms.has(code)) {
      return code;
    }
  }
}

function getRoomForSocket(socket) {
  return rooms.get(socket.data.roomCode);
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function getPlayerForSocket(room, socket) {
  const player = getPlayer(room, socket.data.playerId);

  if (!player || player.socketId !== socket.id || !player.connected) {
    return null;
  }

  return player;
}

function findPlayerByName(room, rawName, { connected } = {}) {
  const normalizedName = normalizeName(rawName);

  return room.players.find((player) => {
    if (connected === true && !player.connected) {
      return false;
    }

    if (connected === false && player.connected) {
      return false;
    }

    return normalizeName(player.name) === normalizedName;
  });
}

function getDisconnectedPlayers(room) {
  return room.players.filter((player) => !player.connected);
}

function isRoomPaused(room) {
  return ["bidding", "playing"].includes(room.state) && getDisconnectedPlayers(room).length > 0;
}

function formatNameList(names) {
  if (!names.length) {
    return "";
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function getPauseReason(room) {
  const disconnectedNames = getDisconnectedPlayers(room).map((player) => player.name);

  if (!disconnectedNames.length) {
    return null;
  }

  return `Game is on hold while waiting for ${formatNameList(disconnectedNames)} to return or for that seat to be claimed.`;
}

function getBidOrderNames(room) {
  return room.bidOrder.map((playerId) => getPlayer(room, playerId)?.name).filter(Boolean);
}

function getRoundHandCount(room) {
  if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
    return null;
  }

  return getTotalHandsForPlayerCount(room.players.length);
}

function clearBidConfiguration(room) {
  room.firstBidderId = null;
  room.currentBidderId = null;
  room.bidOrder = [];
}

function resetRoundState(room) {
  room.state = "lobby";
  room.powerSuit = null;
  clearBidConfiguration(room);
  room.currentTrick = [];
  room.lastTrick = null;
  room.leaderId = null;
  room.turnId = null;
  room.completedHands = 0;
  room.finalResults = null;
  room.finalReason = null;

  room.players.forEach((player) => {
    player.hand = [];
    player.bid = null;
    player.tricksWon = 0;
    player.lastRoundPoints = null;
  });
}

function resetScoreboard(room) {
  room.players.forEach((player) => {
    player.points = 0;
    player.lastRoundPoints = null;
  });
  room.lastScoredPlayerCount = null;
}

function handleScoreResetForPlayerCountChange(room) {
  if (room.lastScoredPlayerCount === null || room.players.length === room.lastScoredPlayerCount) {
    return;
  }

  resetRoundState(room);
  resetScoreboard(room);
  addMessage(room, "Player count changed after the last game, so all scores were reset to zero.");
}

function removePlayerFromRoom(room, playerId) {
  const departingIndex = room.players.findIndex((player) => player.id === playerId);

  if (departingIndex === -1) {
    return null;
  }

  const [departingPlayer] = room.players.splice(departingIndex, 1);

  if (!room.players.length) {
    return departingPlayer;
  }

  reseatPlayers(room);

  if (room.hostId === departingPlayer.id) {
    room.hostId = room.players[0].id;
    addMessage(room, `${room.players[0].name} is now the host.`);
  }

  if (room.firstBidderId === departingPlayer.id) {
    room.firstBidderId = null;
    addMessage(room, "The chosen first bidder left, so the host needs to choose a new first bidder.");
  }

  handleScoreResetForPlayerCountChange(room);
  return departingPlayer;
}

function buildFinalResults(room) {
  const scoreRows = room.players.map((player) => {
    const matchedBid = player.bid === player.tricksWon;
    const roundPoints = calculateRoundPoints(player.bid, player.tricksWon);

    return {
      playerId: player.id,
      bid: player.bid,
      tricksWon: player.tricksWon,
      matchedBid,
      roundPoints,
      totalPoints: player.points + roundPoints,
    };
  });

  return {
    winnerIds: scoreRows.filter((row) => row.matchedBid).map((row) => row.playerId),
    scoreRows,
  };
}

function buildRoomState(room, viewerId) {
  const viewer = getPlayer(room, viewerId);
  const leadSuit = room.currentTrick[0]?.card.suit ?? null;
  const bidTotal = getBidTotal(room.players);
  const totalHands = getRoundHandCount(room);
  const forbiddenBid = room.state === "bidding" ? getForbiddenLastBid(room.players, totalHands) : null;
  const paused = isRoomPaused(room);
  const pauseReason = paused ? getPauseReason(room) : null;
  const playableCardIds =
    room.state === "playing" && !paused && room.turnId === viewerId && viewer
      ? viewer.hand
          .filter((card) => isLegalPlay(viewer.hand, card, leadSuit))
          .map((card) => card.id)
      : [];
  const finalResults = room.finalResults
    ? {
        winnerIds: room.finalResults.winnerIds,
        winnerNames: room.finalResults.winnerIds.map((playerId) => getPlayer(room, playerId)?.name),
        scoreRows: room.finalResults.scoreRows.map((row) => ({
          ...row,
          playerName: getPlayer(room, row.playerId)?.name ?? "Unknown player",
        })),
      }
    : null;

  return {
    roomCode: room.code,
    state: room.state,
    powerSuit: room.powerSuit,
    powerSuitLabel: room.powerSuit ? SUIT_NAMES[room.powerSuit] : null,
    leadSuit,
    leadSuitLabel: leadSuit ? SUIT_NAMES[leadSuit] : null,
    currentTurnId: room.turnId,
    currentBidderId: room.currentBidderId,
    leaderId: room.leaderId,
    firstBidderId: room.firstBidderId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    bidOrderNames: getBidOrderNames(room),
    bidTotal,
    totalHands,
    forbiddenBid,
    handNumber: room.state === "finished" ? room.completedHands : room.completedHands + 1,
    finalReason: room.finalReason,
    isPaused: paused,
    pauseReason,
    canPickPowerSuit: room.state === "lobby" && room.hostId === viewerId,
    canPickFirstBidder: room.state === "lobby" && room.hostId === viewerId && room.players.length >= MIN_PLAYERS,
    canStartGame:
      room.state === "lobby" &&
      room.hostId === viewerId &&
      room.players.length >= MIN_PLAYERS &&
      room.players.length <= MAX_PLAYERS &&
      room.players.every((player) => player.connected) &&
      room.powerSuit &&
      room.firstBidderId,
    canSubmitBid:
      room.state === "bidding" && !paused && room.currentBidderId === viewerId && viewer?.bid === null,
    canPlay: room.state === "playing" && !paused && room.turnId === viewerId,
    canPrepareNextRound: room.state === "finished" && room.hostId === viewerId,
    playableCardIds,
    yourPlayerId: viewerId,
    yourBid: viewer?.bid ?? null,
    yourHand: viewer ? sortHand(viewer.hand, room.powerSuit) : [],
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat + 1,
      bid: player.bid,
      tricksWon: player.tricksWon,
      points: player.points,
      lastRoundPoints: player.lastRoundPoints,
      cardCount: player.hand.length,
      isHost: player.id === room.hostId,
      isConnected: player.connected,
      isCurrentBidder: player.id === room.currentBidderId,
      isFirstBidder: player.id === room.firstBidderId,
      isLeader: player.id === room.leaderId,
      isTurn: player.id === room.turnId,
      metBid: room.state === "finished" ? player.bid === player.tricksWon : null,
    })),
    currentTrick: room.currentTrick.map((play) => ({
      playerId: play.playerId,
      playerName: play.playerName ?? getPlayer(room, play.playerId)?.name ?? "Unknown player",
      card: play.card,
    })),
    lastTrick: room.lastTrick,
    finalResults,
    messages: room.messages,
  };
}

function emitRoomState(room) {
  room.players
    .filter((player) => player.connected && player.socketId)
    .forEach((player) => {
      io.to(player.socketId).emit("roomState", buildRoomState(room, player.id));
    });
}

function fail(socket, message) {
  socket.emit("serverError", message);
}

function moveSocketIntoRoom(socket, room, player) {
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  player.socketId = socket.id;
  player.connected = true;
}

function clearSocketRoomState(socket) {
  socket.data.roomCode = null;
  socket.data.playerId = null;
}

function announceSeatReturn(room, player, previousName) {
  if (normalizeName(previousName) === normalizeName(player.name)) {
    addMessage(room, `${player.name} rejoined Seat ${player.seat + 1}.`);
  } else {
    addMessage(room, `${player.name} claimed Seat ${player.seat + 1}, which had been reserved for ${previousName}.`);
  }

  if (["bidding", "playing"].includes(room.state) && !isRoomPaused(room)) {
    addMessage(room, "All disconnected seats are back. The game resumed.");
  }
}

function getDisconnectedSeatOptions(room) {
  return getDisconnectedPlayers(room).map((player) => ({
    playerId: player.id,
    seat: player.seat + 1,
    name: player.name,
  }));
}

function beginGame(room) {
  const shuffledDeck = shuffleDeck(createGameDeck(room.players.length));
  const hands = dealEqually(shuffledDeck, room.players.length);
  const bidOrder = buildBidCycle(room.players, room.firstBidderId);

  room.players.forEach((player, index) => {
    player.hand = sortHand(hands[index], room.powerSuit);
    player.bid = null;
    player.tricksWon = 0;
    player.lastRoundPoints = null;
  });

  room.state = "bidding";
  room.bidOrder = bidOrder;
  room.currentBidderId = bidOrder[0];
  room.currentTrick = [];
  room.lastTrick = null;
  room.completedHands = 0;
  room.finalResults = null;
  room.finalReason = null;
  room.leaderId = room.players[0].id;
  room.turnId = null;
  addMessage(
    room,
    `Cards are dealt. Bidding starts with ${getPlayer(room, room.currentBidderId)?.name} and continues in cycle.`,
  );
}

function finishGame(room) {
  room.state = "finished";
  room.currentBidderId = null;
  room.turnId = null;
  room.finalResults = buildFinalResults(room);
  room.lastScoredPlayerCount = room.players.length;

  room.finalResults.scoreRows.forEach((row) => {
    const player = getPlayer(room, row.playerId);
    player.points = row.totalPoints;
    player.lastRoundPoints = row.roundPoints;
  });

  const winnerNames = room.finalResults.winnerIds.map((playerId) => getPlayer(room, playerId)?.name).filter(Boolean);

  if (winnerNames.length) {
    room.finalReason =
      winnerNames.length === 1
        ? `${winnerNames[0]} matched the bid exactly and won this game.`
        : `${winnerNames.join(", ")} matched their bids exactly and won this game.`;
  } else {
    room.finalReason = "No player matched the bid exactly, so this game had no winner.";
  }

  addMessage(room, `Game complete. ${room.finalReason}`);
}

io.on("connection", (socket) => {
  clearSocketRoomState(socket);

  socket.on("createRoom", ({ name }) => {
    if (socket.data.roomCode) {
      fail(socket, "You are already inside a room.");
      return;
    }

    const cleanName = sanitizeName(name);

    if (!cleanName) {
      fail(socket, "Enter your name before creating a room.");
      return;
    }

    const roomCode = generateRoomCode();
    const hostPlayer = createPlayer(socket.id, cleanName, 0);
    const room = createRoom(roomCode, hostPlayer);

    rooms.set(roomCode, room);
    moveSocketIntoRoom(socket, room, hostPlayer);
    addMessage(room, `Room ${roomCode} created. Choose the power suit, then start once 4 or 5 players have joined.`);
    emitRoomState(room);
  });

  socket.on("joinRoom", ({ name, roomCode }) => {
    if (socket.data.roomCode) {
      fail(socket, "You are already inside a room.");
      return;
    }

    const cleanName = sanitizeName(name);
    const cleanCode = String(roomCode || "")
      .trim()
      .toUpperCase();
    const room = rooms.get(cleanCode);

    if (!cleanName) {
      fail(socket, "Enter your name before joining a room.");
      return;
    }

    if (!room) {
      fail(socket, "That room code was not found.");
      return;
    }

    if (findPlayerByName(room, cleanName, { connected: true })) {
      fail(socket, "That name is already being used in this room.");
      return;
    }

    const returningPlayer = findPlayerByName(room, cleanName, { connected: false });

    if (returningPlayer) {
      const previousName = returningPlayer.name;
      returningPlayer.name = cleanName;
      moveSocketIntoRoom(socket, room, returningPlayer);
      announceSeatReturn(room, returningPlayer, previousName);
      emitRoomState(room);
      return;
    }

    if (["lobby", "finished"].includes(room.state) && room.players.length < MAX_PLAYERS) {
      const player = createPlayer(socket.id, cleanName, room.players.length);
      room.players.push(player);
      moveSocketIntoRoom(socket, room, player);
      handleScoreResetForPlayerCountChange(room);
      addMessage(room, `${cleanName} joined the room. ${room.players.length} of ${MAX_PLAYERS} seats are filled.`);
      emitRoomState(room);
      return;
    }

    const disconnectedSeats = getDisconnectedSeatOptions(room);

    if (disconnectedSeats.length) {
      socket.emit("seatSelectionRequired", {
        roomCode: room.code,
        requestedName: cleanName,
        seats: disconnectedSeats,
        gameInProgress: ["bidding", "playing"].includes(room.state),
      });
      return;
    }

    if (["bidding", "playing"].includes(room.state)) {
      fail(socket, "That game is already in progress, so the player count cannot change right now.");
      return;
    }

    fail(socket, `That room already has ${MAX_PLAYERS} active players.`);
  });

  socket.on("claimSeat", ({ roomCode, playerId, name }) => {
    if (socket.data.roomCode) {
      fail(socket, "You are already inside a room.");
      return;
    }

    const cleanName = sanitizeName(name);
    const cleanCode = String(roomCode || "")
      .trim()
      .toUpperCase();
    const room = rooms.get(cleanCode);

    if (!cleanName) {
      fail(socket, "Enter your name before claiming a seat.");
      return;
    }

    if (!room) {
      fail(socket, "That room code was not found.");
      return;
    }

    if (findPlayerByName(room, cleanName, { connected: true })) {
      fail(socket, "That name is already being used in this room.");
      return;
    }

    const targetSeat = getPlayer(room, playerId);

    if (!targetSeat || targetSeat.connected) {
      fail(socket, "That reserved seat is no longer available.");
      return;
    }

    const previousName = targetSeat.name;
    targetSeat.name = cleanName;
    moveSocketIntoRoom(socket, room, targetSeat);
    announceSeatReturn(room, targetSeat, previousName);
    emitRoomState(room);
  });

  socket.on("setPowerSuit", ({ suit }) => {
    const room = getRoomForSocket(socket);
    const player = room ? getPlayerForSocket(room, socket) : null;

    if (!room || !player) {
      fail(socket, "Join a room before setting the power suit.");
      return;
    }

    if (room.hostId !== player.id) {
      fail(socket, "Only the host can choose the power suit.");
      return;
    }

    if (room.state !== "lobby") {
      fail(socket, "The power suit can only be changed in the lobby.");
      return;
    }

    if (!SUITS.includes(suit)) {
      fail(socket, "Choose a valid suit.");
      return;
    }

    room.powerSuit = suit;
    addMessage(room, `${player.name} chose ${SUIT_NAMES[suit]} as the power suit.`);
    emitRoomState(room);
  });

  socket.on("setFirstBidder", ({ playerId }) => {
    const room = getRoomForSocket(socket);
    const player = room ? getPlayerForSocket(room, socket) : null;

    if (!room || !player) {
      fail(socket, "Join a room before choosing the first bidder.");
      return;
    }

    if (room.hostId !== player.id) {
      fail(socket, "Only the host can choose who bids first.");
      return;
    }

    if (room.state !== "lobby") {
      fail(socket, "The first bidder can only be chosen in the lobby.");
      return;
    }

    if (room.players.length < MIN_PLAYERS) {
      fail(socket, `Choose the first bidder once at least ${MIN_PLAYERS} players are seated.`);
      return;
    }

    const chosenPlayer = getPlayer(room, playerId);

    if (!chosenPlayer) {
      fail(socket, "Choose a valid player to start the bidding.");
      return;
    }

    room.firstBidderId = chosenPlayer.id;
    addMessage(room, `${chosenPlayer.name} was chosen to bid first.`);
    emitRoomState(room);
  });

  socket.on("startGame", () => {
    const room = getRoomForSocket(socket);
    const player = room ? getPlayerForSocket(room, socket) : null;

    if (!room || !player) {
      fail(socket, "Join a room before starting a game.");
      return;
    }

    if (room.hostId !== player.id) {
      fail(socket, "Only the host can start the game.");
      return;
    }

    if (room.state !== "lobby") {
      fail(socket, "This room is already in a game.");
      return;
    }

    if (
      room.players.length < MIN_PLAYERS ||
      room.players.length > MAX_PLAYERS ||
      room.players.some((roomPlayer) => !roomPlayer.connected)
    ) {
      fail(socket, "A game starts only when 4 or 5 connected players are in the room.");
      return;
    }

    if (!room.powerSuit) {
      fail(socket, "Choose the power suit before dealing.");
      return;
    }

    if (!room.firstBidderId) {
      fail(socket, "Choose who will bid first before starting.");
      return;
    }

    beginGame(room);
    emitRoomState(room);
  });

  socket.on("submitBid", ({ bid }) => {
    const room = getRoomForSocket(socket);
    const player = room ? getPlayerForSocket(room, socket) : null;

    if (!room || !player) {
      fail(socket, "Join a room before bidding.");
      return;
    }

    if (room.state !== "bidding") {
      fail(socket, "Bids are only accepted during the bidding phase.");
      return;
    }

    if (isRoomPaused(room)) {
      fail(socket, getPauseReason(room));
      return;
    }

    const numericBid = Number(bid);
    const totalHands = getRoundHandCount(room);
    const forbiddenBid = getForbiddenLastBid(room.players, totalHands);

    if (room.currentBidderId !== player.id) {
      fail(socket, "Wait for your turn in the bidding cycle.");
      return;
    }

    if (!Number.isInteger(numericBid) || numericBid < 0 || numericBid > totalHands) {
      fail(socket, `Bid a whole number from 0 to ${totalHands}.`);
      return;
    }

    if (player.bid !== null) {
      fail(socket, "Your bid is already locked.");
      return;
    }

    if (forbiddenBid !== null && forbiddenBid >= 0 && forbiddenBid <= totalHands && numericBid === forbiddenBid) {
      fail(
        socket,
        `As the last bidder, you cannot choose ${forbiddenBid} because total bids cannot equal ${totalHands}.`,
      );
      return;
    }

    player.bid = numericBid;
    addMessage(room, `${player.name} bid ${numericBid} hand${numericBid === 1 ? "" : "s"}.`);

    const nextBidderId = room.bidOrder.find((bidPlayerId) => getPlayer(room, bidPlayerId)?.bid === null);

    if (!nextBidderId) {
      room.state = "playing";
      room.currentBidderId = null;
      room.leaderId = room.players[0].id;
      room.turnId = room.leaderId;
      addMessage(room, `${getPlayer(room, room.turnId)?.name} leads hand 1.`);
    } else {
      room.currentBidderId = nextBidderId;
    }

    emitRoomState(room);
  });

  socket.on("playCard", ({ cardId }) => {
    const room = getRoomForSocket(socket);
    const player = room ? getPlayerForSocket(room, socket) : null;

    if (!room || !player) {
      fail(socket, "Join a room before playing cards.");
      return;
    }

    if (room.state !== "playing") {
      fail(socket, "Cards can only be played during the game.");
      return;
    }

    if (isRoomPaused(room)) {
      fail(socket, getPauseReason(room));
      return;
    }

    if (room.turnId !== player.id) {
      fail(socket, "Wait for your turn.");
      return;
    }

    const card = player.hand.find((candidate) => candidate.id === cardId);

    if (!card) {
      fail(socket, "That card is not in your hand.");
      return;
    }

    const leadSuit = room.currentTrick[0]?.card.suit ?? null;

    if (!isLegalPlay(player.hand, card, leadSuit)) {
      fail(socket, `You must follow ${SUIT_NAMES[leadSuit]}.`);
      return;
    }

    player.hand = player.hand.filter((candidate) => candidate.id !== cardId);
    room.currentTrick.push({
      playerId: player.id,
      playerName: player.name,
      card,
    });

    if (room.currentTrick.length < room.players.length) {
      const currentIndex = room.players.findIndex((candidate) => candidate.id === player.id);
      const nextPlayer = room.players[(currentIndex + 1) % room.players.length];
      room.turnId = nextPlayer.id;
      emitRoomState(room);
      return;
    }

    const winningPlay = pickTrickWinner(room.currentTrick, room.powerSuit, leadSuit);
    const winner = getPlayer(room, winningPlay.playerId);

    winner.tricksWon += 1;
    room.completedHands += 1;
    room.lastTrick = {
      number: room.completedHands,
      leadSuit,
      winnerId: winner.id,
      winnerName: winner.name,
      winningCard: winningPlay.card,
      cards: room.currentTrick.map((play) => ({
        playerId: play.playerId,
        playerName: play.playerName ?? getPlayer(room, play.playerId)?.name ?? "Unknown player",
        card: play.card,
      })),
    };
    room.currentTrick = [];

    if (room.players.every((currentPlayer) => currentPlayer.hand.length === 0)) {
      room.leaderId = winner.id;
      addMessage(room, `${winner.name} won hand ${room.completedHands} with ${winningPlay.card.label}.`);
      finishGame(room);
      emitRoomState(room);
      return;
    }

    room.leaderId = winner.id;
    room.turnId = winner.id;
    addMessage(room, `${winner.name} won hand ${room.completedHands} with ${winningPlay.card.label} and leads next.`);
    emitRoomState(room);
  });

  socket.on("prepareNextRound", () => {
    const room = getRoomForSocket(socket);
    const player = room ? getPlayerForSocket(room, socket) : null;

    if (!room || !player) {
      fail(socket, "Join a room before resetting it.");
      return;
    }

    if (room.hostId !== player.id) {
      fail(socket, "Only the host can reset the room.");
      return;
    }

    if (room.state !== "finished") {
      fail(socket, "You can reset the room only after a game finishes.");
      return;
    }

    resetRoundState(room);
    addMessage(room, "Room reset. Choose a new power suit and start the next game when 4 or 5 players are ready.");
    emitRoomState(room);
  });

  socket.on("disconnect", () => {
    const room = getRoomForSocket(socket);

    if (!room) {
      return;
    }

    const departingPlayer = getPlayer(room, socket.data.playerId);

    if (!departingPlayer || departingPlayer.socketId !== socket.id) {
      return;
    }

    departingPlayer.connected = false;
    departingPlayer.socketId = null;
    clearSocketRoomState(socket);

    if (["bidding", "playing"].includes(room.state)) {
      addMessage(room, `${departingPlayer.name} disconnected. ${getPauseReason(room)}`);
      emitRoomState(room);
      return;
    }

    const removedPlayer = removePlayerFromRoom(room, departingPlayer.id);

    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }

    if (removedPlayer) {
      addMessage(room, `${removedPlayer.name} left the room.`);
    } else {
      addMessage(room, `${departingPlayer.name} left the room.`);
    }

    emitRoomState(room);
  });
});

server.listen(PORT, () => {
  console.log(`Card game server is running at http://localhost:${PORT}`);
});
