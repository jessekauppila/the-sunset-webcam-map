# The Sunset Webcam Map

A real-time webcam mapping application that shows live webcam feeds from locations experiencing sunset around the world.

## Features

- 🌅 **Real-time Sunset Tracking**: Automatically finds locations experiencing sunset
- 📹 **Live Webcam Feeds**: Displays webcam streams from sunset locations
- 🗺️ **Interactive Map**: Built with Mapbox for smooth navigation
- 📍 **Closest Webcam**: Automatically flies to the nearest webcam to your location
- 🎯 **Canvas Rendering**: High-performance webcam image display using HTML5 Canvas

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript
- **Mapping**: Mapbox GL JS
- **Styling**: Tailwind CSS
- **Testing**: Vitest
- **Data Source**: Windy.com Webcam API

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Mapbox access token

## Project Structure

```
app/
├── components/
│   ├── Map/                 # Map-related components
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Map utilities
│   ├── WebcamConsole.tsx   # Webcam data display
│   └── WebcamDisplay.tsx   # Canvas-based webcam viewer
├── lib/
│   └── types.ts            # TypeScript type definitions
└── page.tsx                 # Main application page
```

## Key Components

- **SimpleMap**: Main map component with sunset tracking
- **WebcamConsole**: Displays webcam data in a console-like interface
- **WebcamDisplay**: Canvas-based webcam image renderer

########################################

### Guide To Future Use

## Terminator Ring Layer

useSetWebCamMarkers: "const INITIAL_IMMEDIATE_BATCHES = 17; // or pass this in from caller later"

- needs to be adjust for greater terminator ring fidelity down the road.

terminatorRing: precisionDeg = 10

- also needs to be adjust for greater terminator ring fidelity down the road.

## Terminator Ring Layer

terminatorRingLineLayer: can uncommment layer to show terminator ring line on map

########################################

### Installation

## Development

### Running Tests

```bash
npm test
```

### Building for Production

```bash
npm run build
```

## Author

**Jesse Kauppila**

- GitHub: [@jessekauppila](https://github.com/jessekauppila)

## Acknowledgments

- Windy.com for providing webcam data
- Mapbox for mapping services
- The React and Next.js communities

## License

Copyright (c) 2025 Jesse Kauppila. All rights reserved.

This software is proprietary and confidential. No part of this software may be:

- Copied, modified, or distributed
- Used for commercial purposes
- Reverse engineered
- Shared with third parties

without explicit written permission from the copyright holder.
