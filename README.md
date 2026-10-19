# Small Transit

A 2D transport tycoon for phones, in the spirit of Transport Fever. Carry passengers between six towns and freight from farms, forests and an oil well by rail and road, modernise your fleet through the decades, grow the towns you serve, and stay solvent.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # headless simulation tests, including bot-played games
npm run build    # static build in dist/
```

## How to play

- **Station / Road stop tools:** tap the map to build. A stop inside the dashed ring around an industry ships and receives its cargo.
- **Select:** drag from a stop to another stop of the same kind to build a line. Track and roads follow the land: rivers need bridges, hills cost more, and new track through a town clears the houses in its way. Country roads and town streets already exist, so road lines along them are almost free.
- Drag a line's end bar to extend it, or back to its first stop to make a loop. Drag the middle of a line over a stop to add it, or over its own stop to remove it.
- Tap a line to buy or sell vehicles: trains and buses carry passengers, freight trains and trucks carry cargo. Tap a stop, an industry, a town or a vehicle for details; Follow keeps the camera on a vehicle.
- **Vehicle models** unlock by year (13 models, 1950 to 1990): newer ones are faster and bigger but dearer. Vehicles cost more to run as they age; **Renew** on a line replaces old or outdated ones with the newest model. **Full load** makes vehicles wait at the first stop until full.
- **Freight:** farms grow grain for the food plant, forests send logs to the sawmill and the oil well feeds the refinery; the factories turn what arrives into food, goods and fuel for towns. Primary industries produce more when most of their output is shipped.
- **Towns** are laid out in street blocks with a downtown, grow with good passenger service and steady food, goods and fuel, and level off at about four times their starting size. Road stops in town sit on the streets, and bus routes follow them.
- **Menu:** Finance (overview with charts, a statement by month and year, loans and ticket prices), Lines, Vehicles, Towns, Industries and News. The **layers** button switches the map between line colours, plain, coverage (which houses reach a stop) and cargo flows.
- Passengers and cargo walk or are carried across between stops less than 160 units apart, so a bus stop next to a station feeds the trains.
- **Finance:** borrow up to $3M at 5% a year. Three month-ends in a row with negative cash means bankruptcy.
- **Ticket prices** (in Finance) are set per mode from 50% to 200%. Dearer tickets earn more per rider but fewer people travel (demand × price^-1.5).
- The game saves every month-end and when you leave the app; the title screen offers **Continue**.
- Drag empty ground to move the map; pinch or scroll to zoom. Space pauses; 1, 2 and 3 set the speed.

## Architecture

```
src/sim/          deterministic simulation, no DOM
  world.ts        clock, building, passenger and cargo flows, payments, month close, saving
  router.ts       stop-to-stop routing for passengers and cargo (backward Dijkstra per destination)
  terrain.ts      grid A* for new track and road, following terrain, roads and streets
  vehicles.ts     vehicle movement and spacing
  towns.ts        compact towns on a lot grid (street frontage first, downtown), catchment, logistic growth
  economy.ts      cash, loan, monthly and yearly ledgers, history, ticket prices, bankruptcy
  config.ts       every balance number and the vehicle model catalogue
  maps/valley.ts  the map: rivers, hills, forests, country roads, towns, industries
src/render/       Canvas renderer (patterned terrain, cached roofs when zoomed out)
src/ui/           camera, gesture editor, DOM HUD: sheets with a back stack that patch live numbers in place, so they scroll while the game runs
tests/            unit tests and two bots (sensible, reckless) used for tuning
```

Passengers and cargo move as fractional groups (count per destination) rather than one object each, which keeps the simulation and saves small on a phone.

Balance targets, checked by `npm test`: towns stay below four times their starting size and stops are not permanently full after 20 years; every one-train rail line between the four larger towns pays its way; a farm to food plant to town chain pays; the sensible bot grows the company to more than 1.3× its starting value in five years; and the reckless bot (borrows to the limit, builds the longest lines first) goes bankrupt.
