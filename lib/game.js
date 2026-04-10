const SUITS = ["spades", "hearts", "diamonds", "clubs"];

const SUIT_NAMES = {
  spades: "Spades",
  hearts: "Hearts",
  diamonds: "Diamonds",
  clubs: "Clubs",
};

const SUIT_SYMBOLS = {
  spades: "\u2660",
  hearts: "\u2665",
  diamonds: "\u2666",
  clubs: "\u2663",
};

const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const TOTAL_HANDS = 13;
const DISPLAY_SUIT_ORDER = ["spades", "hearts", "clubs", "diamonds"];
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 5;
const FIVE_PLAYER_REMOVED_CARD_IDS = new Set(["diamonds-2", "clubs-2"]);

const RANK_VALUE = Object.fromEntries(
  RANKS.map((rank, index) => [rank, RANKS.length - index]),
);

function createDeck() {
  return SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      id: `${suit}-${rank}`,
      suit,
      rank,
      label: `${rank}${SUIT_SYMBOLS[suit]}`,
    })),
  );
}

function createGameDeck(playerCount) {
  if (playerCount === 5) {
    return createDeck().filter((card) => !FIVE_PLAYER_REMOVED_CARD_IDS.has(card.id));
  }

  return createDeck();
}

function getTotalHandsForPlayerCount(playerCount) {
  if (![MIN_PLAYERS, MAX_PLAYERS].includes(playerCount)) {
    throw new Error("Only 4-player and 5-player games are supported.");
  }

  return createGameDeck(playerCount).length / playerCount;
}

function shuffleDeck(deck) {
  const cards = [...deck];

  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }

  return cards;
}

function dealEqually(deck, playerCount) {
  if (deck.length % playerCount !== 0) {
    throw new Error("Deck cannot be dealt equally to every player.");
  }

  const handSize = deck.length / playerCount;
  const hands = Array.from({ length: playerCount }, () => []);

  deck.forEach((card, index) => {
    hands[index % playerCount].push(card);
  });

  return hands.map((hand) => {
    if (hand.length !== handSize) {
      throw new Error("A player received an uneven hand size.");
    }

    return hand;
  });
}

function sortHand(hand, _powerSuit) {
  return [...hand].sort((left, right) => {
    const suitDifference = DISPLAY_SUIT_ORDER.indexOf(left.suit) - DISPLAY_SUIT_ORDER.indexOf(right.suit);

    if (suitDifference !== 0) {
      return suitDifference;
    }

    return RANK_VALUE[right.rank] - RANK_VALUE[left.rank];
  });
}

function isLegalPlay(hand, card, leadSuit) {
  if (!leadSuit) {
    return true;
  }

  const hasLeadSuit = hand.some((candidate) => candidate.suit === leadSuit);

  if (!hasLeadSuit) {
    return true;
  }

  return card.suit === leadSuit;
}

function pickTrickWinner(plays, powerSuit, leadSuit) {
  if (!plays.length) {
    throw new Error("Cannot evaluate an empty trick.");
  }

  const trumpCards = plays.filter((play) => play.card.suit === powerSuit);
  const contenders = trumpCards.length
    ? trumpCards
    : plays.filter((play) => play.card.suit === leadSuit);

  return contenders.reduce((best, current) =>
    RANK_VALUE[current.card.rank] > RANK_VALUE[best.card.rank] ? current : best,
  );
}

function buildBidCycle(players, firstBidderId) {
  const startIndex = players.findIndex((player) => player.id === firstBidderId);

  if (startIndex === -1) {
    throw new Error("First bidder must belong to the room.");
  }

  return [...players.slice(startIndex), ...players.slice(0, startIndex)].map((player) => player.id);
}

function getBidTotal(players) {
  return players.reduce((total, player) => total + (Number.isInteger(player.bid) ? player.bid : 0), 0);
}

function getForbiddenLastBid(players, totalHands = TOTAL_HANDS) {
  const remainingBidders = players.filter((player) => !Number.isInteger(player.bid));

  if (remainingBidders.length !== 1) {
    return null;
  }

  return totalHands - getBidTotal(players);
}

function calculateRoundPoints(bid, tricksWon) {
  if (bid !== tricksWon) {
    return 0;
  }

  if (bid === 0) {
    return 9;
  }

  return tricksWon * 10;
}

module.exports = {
  MAX_PLAYERS,
  MIN_PLAYERS,
  RANKS,
  SUITS,
  SUIT_NAMES,
  SUIT_SYMBOLS,
  TOTAL_HANDS,
  buildBidCycle,
  calculateRoundPoints,
  createDeck,
  createGameDeck,
  dealEqually,
  getBidTotal,
  getForbiddenLastBid,
  getTotalHandsForPlayerCount,
  isLegalPlay,
  pickTrickWinner,
  shuffleDeck,
  sortHand,
};
