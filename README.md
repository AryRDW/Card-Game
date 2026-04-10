# 4-5 Player Room Card Game

This project is a realtime browser card game for 4 or 5 seated players, with extra viewers able to watch the room live. Players join the same room using a room code, the host chooses the power suit before the cards are dealt, everyone bids how many hands they expect to win, and then the game is played one hand at a time.

## Features

- Create a room and share a short room code with other players.
- Join as up to 5 players in the same room.
- Join the same room as a viewer without taking a seat, even while a game is in progress.
- Rejoin from a shared `/party/ROOMCODE?name=YourName` URL.
- Rejoin as a viewer from `/party/ROOMCODE?name=YourName&role=viewer`.
- Pick the power suit before shuffling and dealing.
- Let the host choose who will bid first before the game starts.
- Shuffle a full 52-card deck for 4-player games and deal 13 cards to each player.
- Use a 50-card deck for 5-player games by removing `2 of diamonds` and `2 of clubs`, then deal 10 cards to each player.
- Keep every player's hand private so each client only sees their own cards.
- Display each hand in suit order: `Spades -> Hearts -> Clubs -> Diamonds`.
- Collect bids from all players one by one in a fixed cycle.
- Enforce the rule that players must follow the lead suit when possible.
- Resolve each hand using the rank order you described:
  - Power suit beats every other suit.
  - If no power suit is played, the lead suit beats all other suits.
  - Within a suit, rank order is `A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2`.
- Track hands won by each player, calculate round points, and keep a cumulative points table across games in the same room.

## Game Flow

1. One player creates a room.
2. The other seated players join using the room code until the room has 4 or 5 players.
3. Extra people can join the room as viewers at any time without changing the seated player count.
4. The host chooses the power suit in the lobby.
5. The host chooses which player will bid first.
6. The host starts the game.
7. The server shuffles and deals cards based on room size:
   - 4 players: `13` cards each
   - 5 players: `10` cards each after removing `2 of diamonds` and `2 of clubs`
8. Bidding starts with the chosen first bidder and then continues in seat order around the table.
9. Each player enters a bid from `0` to the total hands in that round.
10. The final bidder is not allowed to choose the one number that would make the total of all bids equal the total hands for that round.
11. Once all bids are submitted, the first hand begins.
12. The leader plays the first card of the hand.
13. Each next player must:
   - play the same suit as the lead card if they have one
   - otherwise play any card
14. After 4 or 5 cards are played, depending on room size, the winner of the hand is chosen.
15. The winner of that hand leads the next hand.
16. After all hands are complete, the room calculates winners and points.

## Winner And Points Logic

The winner of a game is not the player with the most hands. Instead:

- Any player whose final hands won exactly match the bid is a winner for that game.
- There can be multiple winners if multiple players hit their bids exactly.
- If nobody matches the bid exactly, then that game has no winner.

## Points System

- If a player bids `N` and wins exactly `N` hands, that player earns `N * 10` points.
- If a player bids `0` and wins `0` hands, that player earns `9` points.
- If a player misses the bid, that player earns `0` points for that game.
- When the game finishes, round points are immediately added into that player's cumulative total.
- The room shows a detailed points table with bid, hands won, round points, total points, and result status.
- If the room size changes between finished games, all running scores reset to `0` before the next game.

## Assumptions Made

- The room creator is the first leader for hand 1.
- The host chooses the power suit before dealing.
- The host chooses the first bidder before dealing.
- Bids are visible to all players after they are submitted in turn.
- Viewers can watch the room, table, bids, and scores, but they do not see any private player hands and cannot take actions in the game.
- If a player disconnects during an active game, the game pauses until that seat rejoins or is claimed.
- If a player disconnects in the lobby or after a game, that player leaves the room and the room size may change.

## Run Locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in 4 or 5 browser tabs or on 4 or 5 different devices on the same network.
You can start a game with 4 players or 5 players, and any extra tabs can join as viewers.

## Scripts

- `npm start` runs the production server.
- `npm run dev` runs the server in watch mode.
- `npm test` runs the rule tests for 4-player and 5-player dealing, sorting, bidding, scoring, and hand resolution.

## Run Tests

Use either of these commands from the project root:

```bash
npm test
```

If PowerShell blocks `npm.ps1`, use:

```bash
npm.cmd test
```

## Project Structure

```text
.
|-- lib/game.js         # Pure card, bidding, and scoring rules
|-- public/index.html   # Browser UI
|-- public/styles.css   # Styling
|-- public/app.js       # Client-side realtime logic
|-- server.js           # Express + Socket.IO server
|-- test/game.test.js   # Automated rule tests
`-- README.md
```
