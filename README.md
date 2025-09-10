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

### Installation

1. Clone the repository:

```bash
git clone https://github.com/jessekauppila/the-sunset-webcam-map.git
cd the-sunset-webcam-map
```

2. Install dependencies:

```bash
npm install
```

3. Create environment file:

```bash
cp .env.example .env.local
```

4. Add your Mapbox access token to `.env.local`:

```
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```

5. Run the development server:

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

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
- **useClosestWebcams**: Hook for finding nearest webcams
- **useFlyTo**: Hook for smooth map navigation

######################

## Key Features

######################

## Development

### Running Tests

```bash
npm test
```

### Building for Production

```bash
npm run build
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

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
