const socket = window.io ? io() : null;

const state = {
  room: null,
  isPointsOpen: false,
};

const body = document.body;
const entryPanel = document.getElementById("entryPanel");
const roomPanel = document.getElementById("roomPanel");
const messageBanner = document.getElementById("messageBanner");
const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomButton = document.getElementById("createRoomButton");
const joinRoomButton = document.getElementById("joinRoomButton");
const roomCodeBadge = document.getElementById("roomCodeBadge");
const phaseBadge = document.getElementById("phaseBadge");
const powerSuitBadge = document.getElementById("powerSuitBadge");
const openPointsButton = document.getElementById("openPointsButton");
const closePointsButton = document.getElementById("closePointsButton");
const pointsOverlay = document.getElementById("pointsOverlay");
const pointsOverlayBackdrop = document.getElementById("pointsOverlayBackdrop");
const statusCopy = document.getElementById("statusCopy");
const playersGrid = document.getElementById("playersGrid");
const controlsArea = document.getElementById("controlsArea");
const pointsArea = document.getElementById("pointsArea");
const tableArea = document.getElementById("tableArea");
const tableSubpanel = document.querySelector(".table-subpanel");
const handArea = document.getElementById("handArea");
const logArea = document.getElementById("logArea");

const suitLabels = {
  spades: "Spades \u2660",
  hearts: "Hearts \u2665",
  diamonds: "Diamonds \u2666",
  clubs: "Clubs \u2663",
};

function showMessage(message) {
  if (!message) {
    messageBanner.classList.add("hidden");
    messageBanner.textContent = "";
    return;
  }

  messageBanner.textContent = message;
  messageBanner.classList.remove("hidden");
}

function requireName() {
  const name = nameInput.value.trim();

  if (!name) {
    showMessage("Enter your player name first.");
    nameInput.focus();
    return null;
  }

  return name;
}

function phaseLabel(phase) {
  switch (phase) {
    case "lobby":
      return "Lobby";
    case "bidding":
      return "Bidding";
    case "playing":
      return "Playing";
    case "finished":
      return "Finished";
    default:
      return phase;
  }
}

function setPointsOpen(nextValue) {
  state.isPointsOpen = Boolean(nextValue) && Boolean(state.room);

  pointsOverlay.classList.toggle("hidden", !state.isPointsOpen);
  pointsOverlayBackdrop.classList.toggle("hidden", !state.isPointsOpen);
  pointsOverlay.setAttribute("aria-hidden", state.isPointsOpen ? "false" : "true");
  body.classList.toggle("points-open", state.isPointsOpen);
}

function statusText(room) {
  if (room.state === "lobby") {
    if (room.players.length < 4) {
      return `Waiting for ${4 - room.players.length} more player${room.players.length === 3 ? "" : "s"} to join the room.`;
    }

    if (!room.powerSuitLabel) {
      return "All four players are seated. The host still needs to choose the power suit.";
    }

    if (!room.firstBidderId) {
      return "Power suit is set. The host now chooses who will bid first.";
    }

    const firstBidder = room.players.find((player) => player.id === room.firstBidderId);
    return `Power suit is set and ${firstBidder?.name || "a player"} will bid first. The host can start the game now.`;
  }

  if (room.state === "bidding") {
    const currentBidder = room.players.find((player) => player.id === room.currentBidderId);
    const forbiddenText =
      room.forbiddenBid !== null && room.forbiddenBid >= 0 && room.forbiddenBid <= room.totalHands
        ? ` The last bidder cannot choose ${room.forbiddenBid} because bids may not total ${room.totalHands}.`
        : "";

    return `Bidding order: ${room.bidOrderNames.join(" -> ")}. ${currentBidder?.name || "A player"} is bidding now.${forbiddenText}`;
  }

  if (room.state === "playing") {
    const currentPlayer = room.players.find((player) => player.id === room.currentTurnId);
    const leadText = room.leadSuitLabel ? ` Lead suit: ${room.leadSuitLabel}.` : "";

    return `Hand ${room.handNumber} is live. ${currentPlayer?.name || "A player"} is on turn.${leadText}`;
  }

  const winners = room.finalResults?.winnerNames?.filter(Boolean) || [];
  const winnerLine = winners.length ? `Winner${winners.length > 1 ? "s" : ""}: ${winners.join(", ")}.` : "No exact-bid winner this game.";
  return room.finalReason ? `${room.finalReason} ${winnerLine}` : winnerLine;
}

function renderPlayers(room) {
  playersGrid.innerHTML = room.players
    .map((player) => {
      const tags = [
        player.isHost ? '<span class="player-tag">Host</span>' : "",
        player.isFirstBidder ? '<span class="player-tag">Bids first</span>' : "",
        player.isCurrentBidder ? '<span class="player-tag">Bidding</span>' : "",
        player.isTurn ? '<span class="player-tag">Turn</span>' : "",
        player.isLeader ? '<span class="player-tag">Lead</span>' : "",
        !player.isConnected ? '<span class="player-tag">Offline</span>' : "",
      ]
        .filter(Boolean)
        .join("");

      return `
        <article class="player-card ${player.isTurn || player.isCurrentBidder ? "player-card--active" : ""}">
          <div class="player-card__top">
            <div>
              <div class="player-card__headline">
                <div class="player-name">Seat ${player.seat}: ${player.name}</div>
                <div class="player-card__tags">${tags || '<span class="player-tag">Ready</span>'}</div>
              </div>
            </div>
          </div>
          <div class="player-meta">
            <div class="metric">
              <span class="metric-label">Bid</span>
              <span class="metric-value">${player.bid ?? "..."}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Hands</span>
              <span class="metric-value">${player.tricksWon}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Cards</span>
              <span class="metric-value">${player.cardCount}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Points</span>
              <span class="metric-value">${player.points}</span>
            </div>
          </div>
          ${
            room.state === "finished" && player.metBid
              ? '<p class="eyebrow" style="margin-top:0.8rem;">Exact bid hit</p>'
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderLobbyControls(room) {
  const suitButtons = Object.entries(suitLabels)
    .map(
      ([suit, label]) => `
        <button class="suit-button ${room.powerSuit === suit ? "active" : ""}" data-suit="${suit}" ${
          room.canPickPowerSuit ? "" : "disabled"
        }>
          ${label}
        </button>
      `,
    )
    .join("");
  const bidderButtons = room.players
    .map(
      (player) => `
        <button
          class="secondary-button selection-button ${room.firstBidderId === player.id ? "active" : ""}"
          data-first-bidder-id="${player.id}"
          ${room.canPickFirstBidder ? "" : "disabled"}
        >
          <strong>${player.name}</strong>
          <span>Seat ${player.seat}</span>
        </button>
      `,
    )
    .join("");

  const helperText = room.canPickPowerSuit
    ? "Choose the power suit before the cards are shuffled and dealt."
    : "The host chooses the power suit in the lobby.";
  const bidderText =
    room.players.length === 4
      ? "The host also chooses who will make the first bid. Bidding then continues in seat order from that player."
      : "The first bidder can be chosen once all 4 players are seated.";

  return `
    <div class="controls-stack">
      <div class="callout">${helperText}</div>
      <div class="suit-grid">${suitButtons}</div>
      <div class="callout">${bidderText}</div>
      <div class="selection-grid">${bidderButtons}</div>
      <button class="primary-button" id="startGameButton" ${room.canStartGame ? "" : "disabled"}>
        Deal cards and start bidding
      </button>
    </div>
  `;
}

function renderBiddingControls(room) {
  const currentBidder = room.players.find((player) => player.id === room.currentBidderId);
  const restrictionLine =
    room.forbiddenBid !== null && room.forbiddenBid >= 0 && room.forbiddenBid <= room.totalHands
      ? `As the last bidder, ${currentBidder?.name || "this player"} cannot choose ${room.forbiddenBid}.`
      : "No last-bid restriction is active yet.";

  if (!room.canSubmitBid) {
    return `
      <div class="controls-stack">
        <div class="callout">${
          currentBidder ? `${currentBidder.name} is making the current bid.` : "Waiting for the bidding cycle to continue."
        }</div>
        <ul class="info-list">
          <li>Bidding order: ${room.bidOrderNames.join(" -> ")}</li>
          <li>Current bid total: ${room.bidTotal}</li>
          <li>${restrictionLine}</li>
        </ul>
      </div>
    `;
  }

  const suggestedMax =
    room.forbiddenBid !== null && room.forbiddenBid >= 0 && room.forbiddenBid <= room.totalHands
      ? room.forbiddenBid === room.totalHands
        ? room.totalHands - 1
        : room.totalHands
      : room.totalHands;
  const defaultBidValue = room.forbiddenBid === 0 ? 1 : 0;

  return `
    <div class="controls-stack">
      <div class="callout">Declare how many hands you think you will win. Your bid is taken in turn order.</div>
      <ul class="info-list">
        <li>Bidding order: ${room.bidOrderNames.join(" -> ")}</li>
        <li>Current bid total: ${room.bidTotal}</li>
        <li>${restrictionLine}</li>
      </ul>
      <div class="bid-row">
        <input id="bidInput" type="number" min="0" max="${suggestedMax}" value="${defaultBidValue}" />
        <button class="primary-button" id="submitBidButton">Lock bid</button>
      </div>
    </div>
  `;
}

function buildCurrentTrickMarkup(room, compact = false) {
  if (!room.currentTrick.length) {
    return `
      <div class="placeholder">
        ${room.state === "playing" ? "No cards are on the table yet for this hand." : "The next hand will appear here."}
      </div>
    `;
  }

  return `
    <div class="table-card-grid ${compact ? "table-card-grid--compact" : ""}">
      ${room.currentTrick
        .map(
          ({ playerName, card }) => `
            <article class="table-card table-card--${card.suit}">
              <span class="table-card__player">${playerName}</span>
              <span class="table-card__value">${card.label}</span>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function buildLastTrickMarkup(room) {
  if (!room.lastTrick) {
    return "";
  }

  return `
    <div class="summary-box">
      Hand ${room.lastTrick.number} went to <strong>${room.lastTrick.winnerName}</strong> with ${room.lastTrick.winningCard.label}.
    </div>
  `;
}

function buildTableMarkup(room, { compact = false } = {}) {
  return `
    <div class="table-stack">
      ${compact ? '<h4 class="table-section-title">Table</h4>' : ""}
      ${buildCurrentTrickMarkup(room, compact)}
      ${buildLastTrickMarkup(room)}
    </div>
  `;
}

function renderPlayingControls(room) {
  const activePlayer = room.players.find((player) => player.id === room.currentTurnId);
  const isMyTurn = room.canPlay;

  return `
    <div class="controls-stack">
      <div class="callout">
        ${isMyTurn ? "It is your turn. Play one legal card from your hand." : `${activePlayer?.name || "A player"} is taking the turn now.`}
      </div>
      <button class="ghost-button" disabled>
        ${room.leadSuitLabel ? `Follow ${room.leadSuitLabel} if you can` : "Any card can lead the hand"}
      </button>
      ${buildTableMarkup(room, { compact: true })}
    </div>
  `;
}

function renderFinishedControls(room) {
  const winners = room.finalResults?.winnerNames?.filter(Boolean) || [];
  const winningLine = winners.length
    ? `${winners.join(", ")} matched ${winners.length === 1 ? "the" : "their"} bid exactly.`
    : "No player matched the bid exactly in this round.";

  return `
    <div class="controls-stack">
      <div class="summary-box">
        <strong>Round result:</strong> ${winningLine}
        Scores have already been added into each player's running total.
      </div>
      ${buildTableMarkup(room, { compact: true })}
      <button class="primary-button" id="prepareNextRoundButton" ${room.canPrepareNextRound ? "" : "disabled"}>
        Reset room for the next game
      </button>
    </div>
  `;
}

function renderControls(room) {
  if (room.state === "lobby") {
    controlsArea.innerHTML = renderLobbyControls(room);
  } else if (room.state === "bidding") {
    controlsArea.innerHTML = renderBiddingControls(room);
  } else if (room.state === "playing") {
    controlsArea.innerHTML = renderPlayingControls(room);
  } else {
    controlsArea.innerHTML = renderFinishedControls(room);
  }

  controlsArea.querySelectorAll("[data-suit]").forEach((button) => {
    button.addEventListener("click", () => {
      socket.emit("setPowerSuit", { suit: button.dataset.suit });
    });
  });

  controlsArea.querySelectorAll("[data-first-bidder-id]").forEach((button) => {
    button.addEventListener("click", () => {
      socket.emit("setFirstBidder", { playerId: button.dataset.firstBidderId });
    });
  });

  document.getElementById("startGameButton")?.addEventListener("click", () => {
    socket.emit("startGame");
  });

  document.getElementById("submitBidButton")?.addEventListener("click", () => {
    const bidInput = document.getElementById("bidInput");
    const bidValue = Number(bidInput.value);

    if (room.forbiddenBid !== null && bidValue === room.forbiddenBid) {
      showMessage(`You cannot bid ${room.forbiddenBid} here because the total bids cannot equal ${room.totalHands}.`);
      return;
    }

    socket.emit("submitBid", { bid: bidValue });
  });

  document.getElementById("prepareNextRoundButton")?.addEventListener("click", () => {
    socket.emit("prepareNextRound");
  });
}

function renderTablePanel(room) {
  const tableMovesIntoControls = room.state === "playing" || room.state === "finished";

  tableSubpanel.classList.toggle("hidden", tableMovesIntoControls);

  if (tableMovesIntoControls) {
    tableArea.innerHTML = "";
    return;
  }

  tableArea.innerHTML = buildTableMarkup(room);
}

function renderHand(room) {
  if (!room.yourHand.length) {
    handArea.innerHTML = '<div class="placeholder">Your hand is empty.</div>';
    return;
  }

  handArea.innerHTML = room.yourHand
    .map((card) => {
      const playable = room.playableCardIds.includes(card.id);
      const disabled = room.state !== "playing" || !playable;

      return `
        <button class="card-button card-button--${card.suit}" data-card-id="${card.id}" ${disabled ? "disabled" : ""}>
          <span class="card-rank">${card.rank}</span>
          <span class="card-suit">${suitLabels[card.suit]}</span>
        </button>
      `;
    })
    .join("");

  handArea.querySelectorAll("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      socket.emit("playCard", { cardId: button.dataset.cardId });
    });
  });
}

function renderLog(room) {
  logArea.innerHTML = room.messages
    .map((message) => `<li>${message}</li>`)
    .join("");
}

function renderPointsTable(room) {
  const rows = room.finalResults?.scoreRows?.length
    ? room.finalResults.scoreRows.map((row) => ({
        playerName: row.playerName,
        bid: row.bid,
        tricksWon: row.tricksWon,
        roundPoints: row.roundPoints,
        totalPoints: row.totalPoints,
        status: row.matchedBid ? "Exact bid" : "Missed",
      }))
    : room.players.map((player) => ({
        playerName: player.name,
        bid: player.bid ?? "-",
        tricksWon: player.tricksWon,
        roundPoints: player.lastRoundPoints ?? "-",
        totalPoints: player.points,
        status: player.bid === null ? "Waiting" : "In progress",
      }));

  pointsArea.innerHTML = `
    <div class="points-table-wrap">
      <table class="points-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>Bid</th>
            <th>Hands</th>
            <th>Round</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.playerName}</td>
                  <td>${row.bid}</td>
                  <td>${row.tricksWon}</td>
                  <td class="${row.roundPoints === "-" || row.roundPoints === 0 ? "points-muted" : "points-positive"}">${row.roundPoints}</td>
                  <td>${row.totalPoints}</td>
                  <td>${row.status}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRoom() {
  const room = state.room;

  if (!room) {
    body.classList.remove("in-room");
    setPointsOpen(false);
    entryPanel.classList.remove("hidden");
    roomPanel.classList.add("hidden");
    return;
  }

  body.classList.add("in-room");
  entryPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
  roomPanel.classList.toggle("room-panel--cards-live", room.state !== "lobby");

  roomCodeBadge.textContent = room.roomCode;
  phaseBadge.textContent = phaseLabel(room.state);
  powerSuitBadge.textContent = room.powerSuitLabel ? `Power suit: ${room.powerSuitLabel}` : "Power suit not chosen";
  statusCopy.textContent = statusText(room);

  renderPlayers(room);
  renderControls(room);
  renderPointsTable(room);
  renderTablePanel(room);
  renderHand(room);
  renderLog(room);
}

openPointsButton.addEventListener("click", () => {
  setPointsOpen(true);
});

closePointsButton.addEventListener("click", () => {
  setPointsOpen(false);
});

pointsOverlayBackdrop.addEventListener("click", () => {
  setPointsOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.isPointsOpen) {
    setPointsOpen(false);
  }
});

createRoomButton.addEventListener("click", () => {
  if (!socket) {
    showMessage("Start the Node server with `npm start` to create and join live rooms.");
    return;
  }

  const name = requireName();

  if (!name) {
    return;
  }

  socket.emit("createRoom", { name });
});

joinRoomButton.addEventListener("click", () => {
  if (!socket) {
    showMessage("Start the Node server with `npm start` to create and join live rooms.");
    return;
  }

  const name = requireName();

  if (!name) {
    return;
  }

  const roomCode = roomCodeInput.value.trim().toUpperCase();

  if (!roomCode) {
    showMessage("Enter the room code you want to join.");
    roomCodeInput.focus();
    return;
  }

  socket.emit("joinRoom", { name, roomCode });
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

if (socket) {
  socket.on("roomState", (roomState) => {
    state.room = roomState;
    showMessage("");
    renderRoom();
  });

  socket.on("serverError", (message) => {
    showMessage(message);
  });
} else {
  showMessage("Styles can load in preview mode, but live multiplayer needs the app running at `http://localhost:3000`.");
}

renderRoom();
