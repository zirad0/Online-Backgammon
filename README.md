# Online Backgammon

A room-based online backgammon game built with **Node.js**, **Express**, and **Socket.IO**.
It supports desktop and mobile browsers on the same local network, includes chat, rematches, auto-roll, 2x offers, theme selection, checker skins, and live English/Turkish language switching.

## Features

- Real-time two-player backgammon matches
- Create-room / join-room flow with a short room code
- Mobile-friendly board layout
- In-game chat with timestamps
- Auto-roll toggle
- Rematch flow
- 2x offer system
- Theme selection
- Checker skin selection
- English and Turkish UI support
- Easy-to-edit assets and text files

## Requirements

- Node.js 18+ recommended
- npm

## Installation

```bash
npm install
npm start
```

## Open on your computer

Open this address in your browser:

```text
http://localhost:3000
```

## Open on your phone or tablet

1. Make sure your computer and phone are connected to the **same Wi-Fi network**.
2. Start the project on your computer:

```bash
npm start
```

3. In PowerShell / terminal, you will see one or more local network addresses such as:

```text
http://192.168.1.37:3000
```

4. Enter that address in your phone browser.
5. If Windows Firewall asks for permission, allow it on **Private networks**.

## Notes

- The server listens on `0.0.0.0`, so other devices on the same local network can connect.
- If your phone still cannot connect, check Windows Firewall and confirm both devices are on the same Wi-Fi network.
- Some guest networks isolate devices from each other. A standard home Wi-Fi network usually works fine.

## Easy-to-edit folders

- `client/assets/checkers/`
  - checker images
  - `white.svg` and `black.svg`
- `client/assets/dice/`
  - dice images
  - `1.svg` through `6.svg`
- `client/assets/sounds/`
  - sound effects
  - `roll.wav`, `move.wav`, `hit.wav`
- `client/assets/ui/texts.js`
  - UI translations and text content
- `client/assets/themes/themes.js`
  - theme definitions
- `client/assets/skins/skins.js`
  - checker skin definitions
  - `black.svg`, `white.svg`
    - you can add a new folder and put these in the folder for new skin sets

## Project structure

```text
client/
  app.js
  index.html
  style.css
  assets/
    checkers/
    dice/
    skins/
    sounds/
    themes/
    ui/
server/
  game.js
  server.js
```

## GitHub-ready notes

This version was cleaned up for public sharing:

- English-first README and terminal output
- Professionalized lobby copy
- Built-in bilingual support for players
- Easy customization points grouped under `client/assets/`

## License

Use, modify, and publish it however you want. Just maybe do not let the dice develop an ego.
