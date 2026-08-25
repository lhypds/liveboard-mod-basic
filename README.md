
liveboard-mod-basic
===================


Basic [Liveboard](https://github.com/lhypds/liveboard) module.


Modules
-------

`Website`  
Embeds any URL in the card as an iframe.  
Crop, zoom and a refresh interval; interaction can be allowed, scroll-locked (`no-scroll`) or blocked entirely.  

`Note`  
Free-form text note on a monospace grid.  
Editor keys: `Tab` / `Shift+Tab` indent the lines the selection touches, `Ctrl+X` cuts the current line, `Alt+Up/Down` moves lines.  
Carries a `comp.prompt`, which is what puts the board's Generate button in the card header.  

`Weather`  
Current conditions plus hourly, yesterday and next-days forecast for any place, from [Open-Meteo](https://open-meteo.com).  
Compares today against the monthly mean temperature: Wolfram|Alpha 10 yr baselines, built by `fetch.sh` into `data/` for the locations in `location.txt`, with Open-Meteo Archive (ERA5) computed live for everywhere else.  
The location box searches the geocoder as you type; the picked place's coordinates are cached in `comp`, so a same-named place doesn't drift between loads.  

`Chat`  
A terminal talking to [simple-ai](https://simple-ai.io) through the `sc` CLI — one card, one CLI.  
A browser cannot spawn a CLI, so it goes through an **sc bridge** over HTTP (`VITE_SC_BRIDGE_URL`, or the card's own `bridgeUrl`).  
Signs in as the account in **Profile → SC Account**, and keeps the session id in `comp` so a dropped CLI re-attaches and the conversation carries on. See `Chat/README.md`.  

`Code`  
Editor and runner for HTML, JavaScript, JSON and Python, with Prism highlighting, formatting and find & replace.  
JavaScript and Python (Pyodide) run in Web Workers, HTML renders in a sandboxed iframe, JSON is shown as data — no DOM and no network in either worker.  
Mode per language: Console (JS, Python), Python Interpreter, HTML Preview, JSON View.  

`Calendar`

Compact month calendar with localized labels, date selection, month navigation and configurable Sunday/Monday week starts.

`Clock`

Monochrome analog and digital clock with an IANA time zone, 12/24-hour display and optional seconds.

`Map`

Data-free Mapbox Light base map with localized labels, navigation controls and optional Google address search.
It reuses `VITE_MAPBOX_TOKEN` and `VITE_GOOGLE_MAPS_API_KEY` already configured for `eitai/HeatMap`.

`Trip`

Date-range trip planner with a custom calendar, one card per day and a trip-wide cost summary and itemized bill.
Flights include route and departure/arrival details, with linked return-day cards for round trips; rental cars include routes and pickup/return times; hotel stays stay synchronized
across their covered days; events include time and location. Every item supports costs, and every day has a compact free-form note.

`Image`

A picture, dropped on the card — an empty card says "Drop a image here" until it has one.
The drop is compressed to WebP in the browser (`comp.quality`, scaled down to `comp.maxSize` on its longest edge), then uploaded to the board's image API, which stores it under `data/images` named after its own digest.
The card keeps only the URL, never the bytes: a board is saved as JSON, so an inline picture would ride along in every save, export and sync.


`Paint`

Draw on the card with a pen: eight colours, four widths, an eraser, and Undo/Redo/Clear in the card's own toolbar.
Clear is one Undo away from coming back, so the card registers no Reset of its own — the toolbar is the whole tool.
In eraser mode a ring follows the pointer at the width the eraser actually cuts at, since that is the one tool whose reach its own marks cannot show.
A stroke is kept in `comp.strokes` as fractions of the card's width rather than pixels, so resizing the card scales the drawing instead of cropping it, and the card is still saved and synced as plain JSON — one save per stroke, never per point.
The eraser cuts through the strokes under it (`destination-out`) at `comp.eraserScale` times the pen's width, so it also reads as an eraser in a card exported to PNG.

`FlowChart`

Boxes and arrows, drawn on the card: add a box from the toolbar, drag it to move, double-click to type in it, and pull an arrow out of any of its four edge handles onto another box.
Tab is the fast way through: it adds the next box to the right of the one being worked on and draws the arrow from it, so a chain is typed rather than drawn — and Tab out of a box does the same, without a hand leaving the keyboard.
The toolbar's arrow button is the same link for a finger, which never hovers and so never sees the handles: press it, then the two boxes in turn.
An arrow keeps only the ids of the boxes at its two ends (`comp.arrows`), never a line — both ends are worked out from where the boxes are every time the chart is drawn, which is what makes a dragged box carry its arrows along and a deleted one take them with it.
Boxes are kept in px (`comp.boxes`) rather than as fractions of the card's width the way Paint keeps its strokes: a box holds text, and text does not scale with the card. A chart that outgrows its card scrolls instead.
Undo, Redo and Clear are in the card's own toolbar, as in Paint, so Clear is one Undo away from coming back; typing into a box is one Undo step, not one per keystroke.

`X`

A card whose contents are written for it: describe a widget to the board's Generate button and what comes back — one self-contained HTML document — is what the card shows.
The document renders in an iframe with `sandbox="allow-scripts"` and nothing else, so it has no origin of its own: it cannot reach the board's DOM, its storage, or the network. `allow-same-origin` must never be added alongside `allow-scripts` — together they let a document remove its own sandbox, and the sandbox is the entire guard here.
A bridge script is injected into every render for the two things a null origin breaks: `localStorage` and `sessionStorage` throw on access, so they are replaced with per-render stand-ins, and nothing inside can reach the card, so uncaught errors are posted out to it.
Base styles go in ahead of the document's own, so an element the widget doesn't style still arrives in the board's font rather than the browser's — and scrollbars are hidden inside the card the way they are everywhere else on the board, with the wheel still scrolling what it is over.
An error surfaces on a bar under the widget and is sent back to be repaired without being asked — twice at most, after which the bar keeps a Repair button and waits. Any edit or Generate that isn't itself a repair starts that budget over.
A finished rewrite renders immediately: the board tells the card when a run has stopped and hands it the final text (`GenerateTarget.onDone`), which `onGenerated` alone cannot say — it fires many times a second and never marks the last chunk.
Until then the card says so itself — over the whole card while it is still empty, in a corner once a widget is already running, since a rewrite can take the better part of a minute and the board's own overlay only covers the wait for the first words. Text arriving any other way (a hand edit, an undo) waits for the source to sit still for 700ms, so it is rendered once rather than on every keystroke.
The footer's `</>` swaps the whole card between the widget and its source — not a split: at the size these cards are, half of one is too little to read code in and too little to run it in either.
The card's Refresh runs the same document again in a new frame — a clock starts over, a random layout comes out different.
Named for the glyph: the title is `𝛘` in every language, while the folder stays ASCII `X` because that name is also the card's address (`/api/data/X`), which the server validates against `[\w-]+`.


Setup
-----

`board.config.json`  
Setup the repo URL.  

`modules.config.json`  
Modules config file, enable or disable modules, etc.  


modules.config.json
-------------------

Modules config file.  
key is the `ModuleName`, same as folder name.  


config.ts
---------

`config.ts` is in each module folder,  
It controls module default config template.  

Field `comp` is settings only used for that module.  
Fileds other than `comp` are common configs.  
