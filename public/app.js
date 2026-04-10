const socket = window.io ? io() : null;

const state = {
  room: null,
  isPointsOpen: false,
  pendingSeatClaim: null,
  autoJoinAttempted: false,
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
const handSubpanel = document.querySelector(".hand-subpanel");
const playersGrid = document.getElementById("playersGrid");
const controlsArea = document.getElementById("controlsArea");
const pointsArea = document.getElementById("pointsArea");
const tableArea = document.getElementById("tableArea");
const tableSubpanel = document.querySelector(".table-subpanel");
const handArea = document.getElementById("handArea");
const logArea = document.getElementById("logArea");
const pauseOverlay = document.getElementById("pauseOverlay");
const pauseDialogMessage = document.getElementById("pauseDialogMessage");
const seatClaimPanel = document.getElementById("seatClaimPanel");
const seatClaimMessage = document.getElementById("seatClaimMessage");
const seatClaimList = document.getElementById("seatClaimList");
const dismissSeatClaimButton = document.getElementById("dismissSeatClaimButton");

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 5;

const suitLabels = {
  spades: "Spades \u2660",
  hearts: "Hearts \u2665",
  diamonds: "Diamonds \u2666",
  clubs: "Clubs \u2663",
};

const suitGlyphs = {
  spades: "\u2660",
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
};

const pipLayouts = {
  A: [1],
  "2": [1, 1],
  "3": [1, 1, 1],
  "4": [2, 2],
  "5": [2, 1, 2],
  "6": [2, 2, 2],
  "7": [2, 1, 2, 2],
  "8": [2, 2, 2, 2],
  "9": [2, 2, 1, 2, 2],
  "10": [2, 2, 2, 2, 2],
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

function formatNames(names) {
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

function getRouteContext() {
  const match = window.location.pathname.match(/^\/party\/([A-Z0-9]{1,12})$/i);
  const params = new URLSearchParams(window.location.search);

  return {
    roomCode: match ? match[1].toUpperCase() : "",
    name: String(params.get("name") || "").trim(),
  };
}

function prefillFromRoute() {
  const route = getRouteContext();

  if (route.name && !nameInput.value.trim()) {
    nameInput.value = route.name;
  }

  if (route.roomCode && !roomCodeInput.value.trim()) {
    roomCodeInput.value = route.roomCode;
  }
}

function syncPartyUrl(room) {
  const viewer = room.players.find((player) => player.id === room.yourPlayerId);

  if (!viewer) {
    return;
  }

  const nextPath = `/party/${encodeURIComponent(room.roomCode)}`;
  const nextSearch = `?name=${encodeURIComponent(viewer.name)}`;

  if (window.location.pathname !== nextPath || window.location.search !== nextSearch) {
    window.history.replaceState({}, "", `${nextPath}${nextSearch}`);
  }
}

function attemptRouteJoin() {
  if (!socket || state.autoJoinAttempted || state.room) {
    return;
  }

  const route = getRouteContext();

  if (!route.roomCode || !route.name) {
    return;
  }

  state.autoJoinAttempted = true;
  socket.emit("joinRoom", route);
}

function setPointsOpen(nextValue) {
  state.isPointsOpen = Boolean(nextValue) && Boolean(state.room);

  pointsOverlay.classList.toggle("hidden", !state.isPointsOpen);
  pointsOverlayBackdrop.classList.toggle("hidden", !state.isPointsOpen);
  pointsOverlay.setAttribute("aria-hidden", state.isPointsOpen ? "false" : "true");
  body.classList.toggle("points-open", state.isPointsOpen);
}

function statusText(room) {
  const minPlayers = room.minPlayers ?? MIN_PLAYERS;
  const maxPlayers = room.maxPlayers ?? MAX_PLAYERS;
  const connectedPlayers = room.players.filter((player) => player.isConnected);
  const disconnectedPlayers = room.players.filter((player) => !player.isConnected);
  const openSeats = maxPlayers - room.players.length;

  if (room.isPaused && room.pauseReason) {
    return room.pauseReason;
  }

  if (room.state === "lobby") {
    if (connectedPlayers.length < minPlayers) {
      const statusParts = [];

      if (disconnectedPlayers.length) {
        statusParts.push(`waiting for ${formatNames(disconnectedPlayers.map((player) => player.name))} to reconnect or have that seat claimed`);
      }

      const requiredPlayers = minPlayers - connectedPlayers.length;

      if (requiredPlayers > 0) {
        statusParts.push(`waiting for ${requiredPlayers} more player${requiredPlayers === 1 ? "" : "s"} to join`);
      }

      return `${statusParts[0].charAt(0).toUpperCase()}${statusParts[0].slice(1)}${statusParts.length > 1 ? ` and ${statusParts[1]}` : ""}.`;
    }

    if (!room.powerSuitLabel) {
      return `${connectedPlayers.length} players are seated. The host still needs to choose the power suit.${openSeats > 0 ? ` You can also wait for ${openSeats} more player${openSeats === 1 ? "" : "s"}.` : ""}`;
    }

    if (!room.firstBidderId) {
      return `Power suit is set for a ${connectedPlayers.length}-player game. The host now chooses who will bid first.`;
    }

    const firstBidder = room.players.find((player) => player.id === room.firstBidderId);
    return `Power suit is set and ${firstBidder?.name || "a player"} will bid first. The host can start the ${connectedPlayers.length}-player game now${openSeats > 0 ? ` or wait for ${openSeats} more player${openSeats === 1 ? "" : "s"}` : ""}.`;
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

function pauseDialogText(room) {
  const offlinePlayers = room.players.filter((player) => !player.isConnected).map((player) => player.name);

  if (!offlinePlayers.length) {
    return "";
  }

  if (offlinePlayers.length === 1) {
    return `${offlinePlayers[0]} is offline. We are waiting for ${offlinePlayers[0]} to rejoin.`;
  }

  return `${formatNames(offlinePlayers)} are offline. We are waiting for them to rejoin.`;
}

function renderPowerSuitBadge(room) {
  if (!room.powerSuit) {
    powerSuitBadge.textContent = "Power suit not chosen";
    return;
  }

  powerSuitBadge.innerHTML = `
    <span class="power-suit-badge__label">Power</span>
    <span class="power-suit-badge__icon">${suitGlyphs[room.powerSuit]}</span>
    <span class="power-suit-badge__name">${room.powerSuitLabel}</span>
  `;
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
          <div class="player-card__headline">
            <div class="player-name">${player.name}</div>
            <div class="player-card__tags">${tags || '<span class="player-tag">Ready</span>'}</div>
          </div>
          <div class="player-stats-row">
            <span class="player-stat"><strong>${player.bid ?? "..."}</strong> Bid</span>
            <span class="player-stat"><strong>${player.tricksWon}</strong> Hands</span>
            <span class="player-stat"><strong>${player.cardCount}</strong> Cards</span>
            <span class="player-stat"><strong>${player.points}</strong> Pts</span>
          </div>
          ${
            room.state === "finished" && player.metBid
              ? '<p class="eyebrow player-card__result">Exact bid hit</p>'
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderLobbyControls(room) {
  const minPlayers = room.minPlayers ?? MIN_PLAYERS;
  const maxPlayers = room.maxPlayers ?? MAX_PLAYERS;
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
    room.players.length >= minPlayers
      ? "The host also chooses who will make the first bid. Bidding then continues in seat order from that player."
      : `The first bidder can be chosen once at least ${minPlayers} players have joined.`;
  const readinessText =
    room.players.length >= minPlayers
      ? `This room can start with ${room.players.length} players.${room.players.length < maxPlayers ? ` One more player can still join before the deal.` : ""}`
      : `A game can start with ${minPlayers} or ${maxPlayers} players.`;

  return `
    <div class="controls-stack">
      <div class="callout">${helperText}</div>
      <div class="suit-grid">${suitButtons}</div>
      <div class="callout">${bidderText}</div>
      <div class="callout">${readinessText}</div>
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

  if (room.isPaused) {
    return `
      <div class="controls-stack">
        <div class="callout">${room.pauseReason}</div>
        <ul class="info-list">
          <li>Bidding order: ${room.bidOrderNames.join(" -> ")}</li>
          <li>Current bid total: ${room.bidTotal}</li>
          <li>${restrictionLine}</li>
        </ul>
      </div>
    `;
  }

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

function renderPipRows(card) {
  const rows = pipLayouts[card.rank] || [1];
  const flipFromIndex = Math.ceil(rows.length / 2);

  return rows
    .map((count, index) => {
      const rowClasses = [
        "playing-card__pip-row",
        count === 1 ? "playing-card__pip-row--solo" : "",
        index >= flipFromIndex ? "playing-card__pip-row--flipped" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `
        <div class="${rowClasses}">
          ${Array.from(
            { length: count },
            () => `<span class="playing-card__pip">${suitGlyphs[card.suit]}</span>`,
          ).join("")}
        </div>
      `;
    })
    .join("");
}

function renderCardCenter(card) {
  if (card.rank === "A") {
    return `
      <div class="playing-card__ace">
        <span class="playing-card__ace-rank">A</span>
        <span class="playing-card__ace-suit">${suitGlyphs[card.suit]}</span>
      </div>
    `;
  }

  if (["K", "Q", "J"].includes(card.rank)) {
    return `
      <div class="playing-card__court">
        <span class="playing-card__court-rank">${card.rank}</span>
        <span class="playing-card__court-suit">${suitGlyphs[card.suit]}</span>
        <span class="playing-card__court-rank playing-card__court-rank--mirror">${card.rank}</span>
      </div>
    `;
  }

  return `<div class="playing-card__pips">${renderPipRows(card)}</div>`;
}

function renderCardFace(card, { playerName = "" } = {}) {
  const colorClass = ["hearts", "diamonds"].includes(card.suit) ? "playing-card--red" : "playing-card--black";

  return `
    <div class="playing-card ${colorClass}">
      ${playerName ? `<span class="playing-card__owner">${playerName}</span>` : ""}
      <div class="playing-card__face">
        <span class="playing-card__corner playing-card__corner--top">
          <span class="playing-card__corner-rank">${card.rank}</span>
          <span class="playing-card__corner-suit">${suitGlyphs[card.suit]}</span>
        </span>
        <div class="playing-card__center">
          ${renderCardCenter(card)}
        </div>
        <span class="playing-card__corner playing-card__corner--bottom">
          <span class="playing-card__corner-rank">${card.rank}</span>
          <span class="playing-card__corner-suit">${suitGlyphs[card.suit]}</span>
        </span>
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
            <article class="table-card">
              ${renderCardFace(card, { playerName })}
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
        ${
          room.isPaused
            ? room.pauseReason
            : isMyTurn
              ? "It is your turn. Play one legal card from your hand."
              : `${activePlayer?.name || "A player"} is taking the turn now.`
        }
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

  if (!socket) {
    return;
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
      const disabled = room.state !== "playing" || room.isPaused || !playable;

      return `
        <button class="card-button" data-card-id="${card.id}" ${disabled ? "disabled" : ""}>
          ${renderCardFace(card)}
        </button>
      `;
    })
    .join("");

  if (!socket) {
    return;
  }

  handArea.querySelectorAll("[data-card-id]").forEach((button) => {
    button.addEventListener("click", () => {
      socket.emit("playCard", { cardId: button.dataset.cardId });
    });
  });
}

function renderLog(room) {
  logArea.innerHTML = room.messages.map((message) => `<li>${message}</li>`).join("");
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
        status: !player.isConnected ? "Offline" : player.bid === null ? "Waiting" : "In progress",
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

function renderSeatClaimPanel() {
  const pendingSeatClaim = state.pendingSeatClaim;

  seatClaimPanel.classList.toggle("hidden", !pendingSeatClaim);

  if (!pendingSeatClaim) {
    seatClaimMessage.textContent = "";
    seatClaimList.innerHTML = "";
    return;
  }

  const requestedName = nameInput.value.trim() || pendingSeatClaim.requestedName;
  seatClaimMessage.textContent = pendingSeatClaim.gameInProgress
    ? `The game is paused right now. Choose which reserved seat ${requestedName} should take.`
    : `These reserved seats are available. Choose where ${requestedName} should join.`;

  seatClaimList.innerHTML = pendingSeatClaim.seats
    .map(
      (seat) => `
        <button class="secondary-button selection-button" data-claim-player-id="${seat.playerId}">
          <strong>Seat ${seat.seat}</strong>
          <span>${seat.name}'s reserved seat</span>
        </button>
      `,
    )
    .join("");

  if (!socket) {
    return;
  }

  seatClaimList.querySelectorAll("[data-claim-player-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = requireName();

      if (!name) {
        return;
      }

      socket.emit("claimSeat", {
        roomCode: pendingSeatClaim.roomCode,
        playerId: button.dataset.claimPlayerId,
        name,
      });
    });
  });
}

function renderPauseDialog(room) {
  const shouldShow = Boolean(room?.isPaused);

  pauseOverlay.classList.toggle("hidden", !shouldShow);
  pauseOverlay.setAttribute("aria-hidden", shouldShow ? "false" : "true");

  if (!shouldShow) {
    pauseDialogMessage.textContent = "";
    body.classList.remove("room-paused");
    return;
  }

  pauseDialogMessage.textContent = pauseDialogText(room);
  body.classList.add("room-paused");
}

function renderRoom() {
  const room = state.room;

  renderSeatClaimPanel();

  if (!room) {
    body.classList.remove("in-room");
    body.classList.remove("room-paused");
    setPointsOpen(false);
    renderPauseDialog(null);
    entryPanel.classList.remove("hidden");
    roomPanel.classList.add("hidden");
    return;
  }

  body.classList.add("in-room");
  entryPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
  roomPanel.classList.toggle("room-panel--cards-live", room.state !== "lobby");
  handSubpanel.classList.toggle("hidden", room.state === "lobby" && room.yourHand.length === 0);

  roomCodeBadge.textContent = room.roomCode;
  phaseBadge.textContent = phaseLabel(room.state);
  renderPowerSuitBadge(room);
  statusCopy.textContent = statusText(room);

  renderPlayers(room);
  renderControls(room);
  renderPointsTable(room);
  renderTablePanel(room);
  renderHand(room);
  renderLog(room);
  renderPauseDialog(room);
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

dismissSeatClaimButton.addEventListener("click", () => {
  state.pendingSeatClaim = null;
  renderRoom();
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

  if (!socket.connected) {
    showMessage("Waiting for the live server connection. Open the app from `http://localhost:3000` after `npm start`.");
    return;
  }

  const name = requireName();

  if (!name) {
    return;
  }

  state.pendingSeatClaim = null;
  socket.emit("createRoom", { name });
});

joinRoomButton.addEventListener("click", () => {
  if (!socket) {
    showMessage("Start the Node server with `npm start` to create and join live rooms.");
    return;
  }

  if (!socket.connected) {
    showMessage("Waiting for the live server connection. Open the app from `http://localhost:3000` after `npm start`.");
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

  state.pendingSeatClaim = null;
  socket.emit("joinRoom", { name, roomCode });
});

nameInput.addEventListener("input", () => {
  if (state.pendingSeatClaim) {
    renderSeatClaimPanel();
  }
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

prefillFromRoute();

if (socket) {
  socket.on("connect", () => {
    showMessage("");
    attemptRouteJoin();
  });

  socket.on("connect_error", () => {
    showMessage("Could not connect to the live game server. Run `npm start` and open `http://localhost:3000`.");
  });

  socket.on("roomState", (roomState) => {
    state.room = roomState;
    state.pendingSeatClaim = null;
    syncPartyUrl(roomState);
    showMessage("");
    renderRoom();
  });

  socket.on("seatSelectionRequired", (payload) => {
    state.pendingSeatClaim = payload;
    state.room = null;
    nameInput.value = payload.requestedName || nameInput.value.trim();
    roomCodeInput.value = payload.roomCode;
    showMessage("Choose which reserved seat you want to take.");
    renderRoom();
  });

  socket.on("serverError", (message) => {
    showMessage(message);
  });

  attemptRouteJoin();
} else {
  showMessage("Styles can load in preview mode, but live multiplayer needs the app running at `http://localhost:3000`.");
}

renderRoom();
