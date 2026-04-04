# Four-Player Room Card Game

This project is a realtime browser card game for exactly 4 players. Players join the same room using a room code, the host chooses the power suit before the cards are dealt, everyone bids how many hands they expect to win, and then the game is played one hand at a time.

## Features

- Create a room and share a short room code with other players.
- Join as up to 4 players in the same room.
- Rejoin from a shared `/party/ROOMCODE?name=YourName` URL.
- Pick the power suit before shuffling and dealing.
- Let the host choose who will bid first before the game starts.
- Shuffle a full 52-card deck and deal 13 cards to each player.
- Keep every player's hand private so each client only sees their own cards.
- Display each hand in suit order: `Spades -> Hearts -> Clubs -> Diamonds`.
- Collect bids from all 4 players one by one in a fixed cycle.
- Enforce the rule that players must follow the lead suit when possible.
- Resolve each hand using the rank order you described:
  - Power suit beats every other suit.
  - If no power suit is played, the lead suit beats all other suits.
  - Within a suit, rank order is `A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2`.
- Track hands won by each player, calculate round points, and keep a cumulative points table across games in the same room.

## Game Flow

1. One player creates a room.
2. The other 3 players join using the room code.
3. The host chooses the power suit in the lobby.
4. The host chooses which player will bid first.
5. The host starts the game.
6. The server shuffles and deals 13 cards to each player.
7. Bidding starts with the chosen first bidder and then continues in seat order around the table.
8. Each player enters a bid from `0` to `13`, meaning how many hands they believe they will win.
9. The final bidder is not allowed to choose the one number that would make the total of all bids equal `13`.
10. Once all bids are submitted, the first hand begins.
11. The leader plays the first card of the hand.
12. Each next player must:
   - play the same suit as the lead card if they have one
   - otherwise play any card
13. After 4 cards are played, the winner of the hand is chosen.
14. The winner of that hand leads the next hand.
15. After all 13 hands are complete, the room calculates winners and points.

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

## Assumptions Made

- The room creator is the first leader for hand 1.
- The host chooses the power suit before dealing.
- The host chooses the first bidder before dealing.
- Bids are visible to all players after they are submitted in turn.
- If a player disconnects during an active game, the game pauses until that seat rejoins or is claimed.

## Run Locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in 4 browser tabs or on 4 different devices on the same network.

## Scripts

- `npm start` runs the production server.
- `npm run dev` runs the server in watch mode.
- `npm test` runs the rule tests for dealing, sorting, bidding, scoring, and hand resolution.

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
