import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SimpleMap from './SimpleMap';

describe('SimpleMap', () => {
  it('renders a map', () => {
    //Arrange
    const mockUserLocation = { lat: 40.7128, lng: -74.006 };
    render(<SimpleMap userLocation={mockUserLocation} />);

    // Check that the map container is rendered

    //Act
    const mapContainer = screen.getByRole('region', { name: 'Map' });

    //Assert
    expect(mapContainer).toBeDefined();
  });
});
