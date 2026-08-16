
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
