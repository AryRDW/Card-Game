const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildBidCycle,
  calculateRoundPoints,
  createDeck,
  dealEqually,
  getForbiddenLastBid,
  isLegalPlay,
  pickTrickWinner,
} = require("../lib/game");

test("dealEqually splits a 52-card deck into 4 hands of 13 cards", () => {
  const hands = dealEqually(createDeck(), 4);

  assert.equal(hands.length, 4);
  hands.forEach((hand) => {
    assert.equal(hand.length, 13);
  });
});

test("a player must follow the lead suit when they have it", () => {
  const hand = [
    { id: "hearts-A", suit: "hearts", rank: "A" },
    { id: "clubs-2", suit: "clubs", rank: "2" },
  ];

  assert.equal(isLegalPlay(hand, hand[1], "hearts"), false);
  assert.equal(isLegalPlay(hand, hand[0], "hearts"), true);
});

test("a player may discard any suit when they do not have the lead suit", () => {
  const hand = [{ id: "clubs-2", suit: "clubs", rank: "2" }];

  assert.equal(isLegalPlay(hand, hand[0], "hearts"), true);
});

test("the power suit beats the lead suit when both are present", () => {
  const winner = pickTrickWinner(
    [
      { playerId: "one", card: { suit: "hearts", rank: "A", label: "A\u2665" } },
      { playerId: "two", card: { suit: "clubs", rank: "2", label: "2\u2663" } },
      { playerId: "three", card: { suit: "spades", rank: "3", label: "3\u2660" } },
      { playerId: "four", card: { suit: "hearts", rank: "K", label: "K\u2665" } },
    ],
    "spades",
    "hearts",
  );

  assert.equal(winner.playerId, "three");
});

test("the highest card in the lead suit wins when no trump is played", () => {
  const winner = pickTrickWinner(
    [
      { playerId: "one", card: { suit: "diamonds", rank: "10", label: "10\u2666" } },
      { playerId: "two", card: { suit: "diamonds", rank: "K", label: "K\u2666" } },
      { playerId: "three", card: { suit: "clubs", rank: "A", label: "A\u2663" } },
      { playerId: "four", card: { suit: "diamonds", rank: "Q", label: "Q\u2666" } },
    ],
    "spades",
    "diamonds",
  );

  assert.equal(winner.playerId, "two");
});

test("buildBidCycle starts with the chosen first bidder and wraps around", () => {
  const players = [
    { id: "one" },
    { id: "two" },
    { id: "three" },
    { id: "four" },
  ];

  assert.deepEqual(buildBidCycle(players, "three"), ["three", "four", "one", "two"]);
});

test("getForbiddenLastBid returns the bid that would make the total 13 for the final bidder", () => {
  const players = [
    { bid: 2 },
    { bid: 4 },
    { bid: 3 },
    { bid: null },
  ];

  assert.equal(getForbiddenLastBid(players), 4);
});

test("calculateRoundPoints gives 10x tricks for an exact positive bid", () => {
  assert.equal(calculateRoundPoints(4, 4), 40);
});

test("calculateRoundPoints gives 9 points for an exact zero bid", () => {
  assert.equal(calculateRoundPoints(0, 0), 9);
});

test("calculateRoundPoints gives 0 points when the bid is missed", () => {
  assert.equal(calculateRoundPoints(3, 2), 0);
});
