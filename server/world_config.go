// world_config.go
package main

import "log"

// ZoneConfig defines the configuration for a single zone
type ZoneConfig struct {
	ID         int    // Unique identifier for the zone (starts from 1)
	TilemapRef string // Reference to the Tiled tilemap file (e.g., "zone1.tmx")
	Neighbors  [8]int // Array of neighbor zone IDs: [N, NE, E, SE, S, SW, W, NW], 0 for null
}

// WorldConfig holds the global world configuration
type WorldConfig struct {
	Zones    []ZoneConfig // List of all zones with their details
	ZoneGrid [][]int      // 2D array representing the logical layout, 0 for no zone
	TileSize int          // Size of each tile in pixels (32)
	ZoneSize int          // Number of tiles per zone side (256)
}

var World = WorldConfig{
	Zones: []ZoneConfig{
		// Example configuration for an irregular world (Neighbors will be auto-calculated)
		{ID: 1, TilemapRef: "zone1.tmx"},
		{ID: 2, TilemapRef: "zone2.tmx"},
		{ID: 3, TilemapRef: "zone3.tmx"},
		{ID: 4, TilemapRef: "zone4.tmx"},

		{ID: 5, TilemapRef: "zone1.tmx"},
		{ID: 6, TilemapRef: "zone2.tmx"},
		{ID: 7, TilemapRef: "zone3.tmx"},
		{ID: 8, TilemapRef: "zone4.tmx"},

		{ID: 9, TilemapRef: "zone1.tmx"},
		{ID: 10, TilemapRef: "zone2.tmx"},
		{ID: 11, TilemapRef: "zone3.tmx"},
		{ID: 12, TilemapRef: "zone4.tmx"},

		{ID: 13, TilemapRef: "zone1.tmx"},
		{ID: 14, TilemapRef: "zone2.tmx"},
		{ID: 15, TilemapRef: "zone3.tmx"},
		{ID: 16, TilemapRef: "zone4.tmx"},
	},
	ZoneGrid: [][]int{
		{1, 2, 3, 4},     // Row 0: Zone 1 and 2, no zones in columns 2 and 3
		{5, 6, 7, 8},     // Row 1: No zones
		{9, 10, 11, 12},  // Row 2: Zone 3, no zones in columns 1-3
		{13, 14, 15, 16}, // Row 3: Zone 4, no zones in columns 0 and 2-3
	},
	TileSize: 32,
	ZoneSize: 256,
}

// ZonePosition stores the calculated grid position for a zone
type ZonePosition struct {
	GridX int
	GridY int
}

// zonePositions maps zone IDs to their calculated grid positions
var zonePositions map[int]ZonePosition

// InitializeWorld sets up the world configuration and calculates grid positions and neighbors
func InitializeWorld() {
	// Initialize the zonePositions map
	zonePositions = make(map[int]ZonePosition)

	// Calculate grid positions by scanning ZoneGrid
	for i, row := range World.ZoneGrid {
		for j, zoneID := range row {
			if zoneID == 0 {
				continue // 0 is null
			}
			zonePositions[zoneID] = ZonePosition{
				GridX: j,
				GridY: i,
			}
			log.Println("Set zone: ", zoneID, " to x: ", zonePositions[zoneID].GridX, ", y: ",
				zonePositions[zoneID].GridY)
		}
	}

	// Automatically calculate neighbors for each zone
	for i := range World.Zones {
		zone := &World.Zones[i]
		pos, exists := zonePositions[zone.ID]
		if !exists {
			log.Fatalf("Grid position for zone ID %d not found", zone.ID)
			continue
		}

		// Define the 8 possible neighbor offsets (N, NE, E, SE, S, SW, W, NW)
		neighborOffsets := [8][2]int{
			{-1, 0},  // N
			{-1, 1},  // NE
			{0, 1},   // E
			{1, 1},   // SE
			{1, 0},   // S
			{1, -1},  // SW
			{0, -1},  // W
			{-1, -1}, // NW
		}

		// Calculate neighbors
		for idx, offset := range neighborOffsets {
			newY := pos.GridY + offset[0]
			newX := pos.GridX + offset[1]

			// Check if the neighbor position is within bounds
			if newY >= 0 && newY < len(World.ZoneGrid) && newX >= 0 && newX < len(World.ZoneGrid[newY]) {
				neighborID := World.ZoneGrid[newY][newX]
				zone.Neighbors[idx] = neighborID
			} else {
				zone.Neighbors[idx] = 0 // Out of bounds, set to null
			}
		}
	}

	// Validate ZoneGrid entries
	for i, row := range World.ZoneGrid {
		for j, zoneID := range row {
			if zoneID == 0 {
				continue // 0 is valid as null
			}
			found := false
			for _, z := range World.Zones {
				if z.ID == zoneID {
					found = true
					break
				}
			}
			if !found {
				log.Fatalf("Zone ID %d at position [%d][%d] not found in Zones", zoneID, i, j)
			}
		}
	}

	// Validate neighbors
	for _, zone := range World.Zones {
		for _, neighborID := range zone.Neighbors {
			if neighborID != 0 {
				found := false
				for _, z := range World.Zones {
					if z.ID == neighborID {
						found = true
						break
					}
				}
				if !found {
					log.Fatalf("Neighbor ID %d for zone %d not found in Zones", neighborID, zone.ID)
				}
			}
		}
	}
	log.Println("World configuration initialized with", len(World.Zones), "zones")
}
