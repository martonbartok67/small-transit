# Small Transit

A 2D transport tycoon for phones, built from the engine of [Small Subway](https://github.com/martonbartok67/small-subway). Connect six towns by rail and bus, buy vehicles, earn fares and stay solvent.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless simulation tests, including bot-played games
npm run build    # static build in dist/
```

## How to play

- **Station / Bus stop tools:** tap the map to build. Houses turn darker once a stop reaches them.
- **Select:** drag from a stop to another stop of the same kind to build a line. The price of new track or road shows by your finger. Water needs bridges and hills cost more; roads inside towns are free.
- Drag a line's end bar to extend it, or back to its first stop to make a loop. Drag the middle of a line over a stop to add it, or over its own stop to remove it.
- Tap a line to buy or sell trains and buses. Tap a stop to see who is waiting.
- Passengers walk between stops less than 160 units apart, so a bus stop next to a station feeds the trains.
- **Finance:** borrow up to $3M at 5% a year. Three month-ends in a row with negative cash means bankruptcy.
- Drag empty ground to move the map; pinch or scroll to zoom. Space pauses; 1, 2 and 3 set the speed.

## Architecture

```
src/sim/          deterministic simulation, no DOM
  world.ts        clock, building, demand, fares, month close
  vehicles.ts     train and bus movement (ported from Small Subway)
  router.ts       backward Dijkstra per destination district, with walking transfers
  towns.ts        house generation, catchment, growth
  economy.ts      cash, loan, ledger, bankruptcy
  config.ts       every balance number
  maps/valley.ts  the map
src/render/       Canvas renderer
src/ui/           camera, gesture editor, DOM HUD and bottom sheets
tests/            unit tests and two bots (sensible, reckless) used for tuning
```

Balance targets, checked by `npm test`: the sensible bot grows the company to more than 1.3× its starting value in five years, and the reckless bot (borrows to the limit, builds the longest lines first) goes bankrupt.
