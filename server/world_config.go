// world_config.go
package main

import (
	// "fmt"
	"log"
	// "strconv"
)

type TilemapConfig struct {
	ID         int
	TilemapRef string
}

// ZoneConfig defines the configuration for a single zone
type ZoneConfig struct {
	ID         int    // Unique identifier for the zone (starts from 1)
	TilemapRef string // Reference to the Tiled tilemap file (e.g., "zone1.tmx")
	Neighbors  [8]int // Array of neighbor zone IDs: [N, NE, E, SE, S, SW, W, NW], 0 for null
	GridX      int
	GridY      int
	WorldX     float32
	WorldY     float32
}

// WorldConfig holds the global world configuration
type WorldConfig struct {
	// TilemapConfigs []TilemapConfig
	TilemapGrid [][]string
	ZoneConfigs []ZoneConfig // List of all zones with their details
	ZoneGrid    [][]int      // 2D array representing the logical layout, 0 for no zone
	TileSize    int          // Size of each tile in pixels (32)
	ZoneSize    int          // Number of tiles per zone side (256)
}

// IMPORTANT. zoneId 0 is reserved for a NULL/void zone
var World = WorldConfig{
	// this is a string 2d array of all the tilemap "keys" we will be
	// using on the client side for the tilemap
	// for logic code on the server side we will append the ".json" and parse
	TilemapGrid: [][]string{
		{"", "default", "default", "default"},
		{"default", "default", "default", "default"},
		{"default", "default", "default", "default"},
		{"default", "default", "default", "default"},
	},

	// ZoneConfigs contains all the unique ZoneID
	ZoneConfigs: []ZoneConfig{},
	ZoneGrid:    [][]int{},

	TileSize: 32,
	ZoneSize: 256,
}

func IsEmptyTilemapGridName(tilemapGridName string) bool {
	emptyValues := map[string]struct{}{
		"":      {},
		"empty": {},
		"null":  {},
		"nil":   {},
		"void":  {},
	}
	_, exists := emptyValues[tilemapGridName]
	return exists
}

// InitializeWorld sets up the world configuration and calculates grid positions and neighbors
func InitializeWorld() {

	// determine max columns
	maxCols := 0
	for _, row := range World.TilemapGrid {
		if len(row) > maxCols {
			maxCols = len(row)
		}
	}
	log.Println(maxCols)

	// copy the tile grid to the zone grid (for column/row assignment only)
	// World.ZoneGrid = World.TilemapGrid
	World.ZoneGrid = make([][]int, len(World.TilemapGrid))
	for i := range World.TilemapGrid {
		World.ZoneGrid[i] = make([]int, len(World.TilemapGrid[i])) // Initialize each row of ZoneGrid
		for j := range World.TilemapGrid[i] {
			World.ZoneGrid[i][j] = 0 // Replace all values with 0
		}
	}

	// Create zone configs using tilemap refs and the tilemap grid
	for i, row := range World.TilemapGrid {
		for j, tilemapRef := range row {
			// Generate unique zone ID using row-major indexing
			zoneID := (i * maxCols) + j + 1 // Adding 1 to avoid ID 0

			// make a new zone config
			World.ZoneConfigs = append(World.ZoneConfigs, ZoneConfig{
				ID:         zoneID,
				TilemapRef: tilemapRef,
				GridX:      j,
				GridY:      i,
				WorldX:     float32(j * ZoneWidthPixels),
				WorldY:     float32(i * ZoneWidthPixels),
			})

			// assign this zone id to the corresponding zone grid
			World.ZoneGrid[i][j] = zoneID

			log.Println("Set zone: ", zoneID, " to x: ", j, ", y: ", i)
		}
	}

	// Automatically calculate neighbors for each zone
	for i := range World.ZoneConfigs {
		zoneConfig := &World.ZoneConfigs[i]

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
			newY := zoneConfig.GridY + offset[0]
			newX := zoneConfig.GridX + offset[1]

			// Check if the neighbor position is within bounds
			if newY >= 0 && newY < len(World.ZoneGrid) && newX >= 0 && newX < len(World.ZoneGrid[newY]) {
				neighborID := World.ZoneGrid[newY][newX]
				zoneConfig.Neighbors[idx] = neighborID
				log.Println("zone ", zoneConfig.ID, " has neighbour ", neighborID)
			} else {
				zoneConfig.Neighbors[idx] = 0 // Out of bounds, set to null
			}
		}
	}

	for _, zoneConfig := range World.ZoneConfigs {
		log.Println("ZoneConfig.Neighbours: ", zoneConfig.Neighbors)
	}

	// Validate ZoneGrid entries
	for i, row := range World.ZoneGrid {
		for j, zoneID := range row {
			if zoneID == 0 {
				continue // 0 is valid as null
			}
			found := false
			for _, z := range World.ZoneConfigs {
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
	for _, zone := range World.ZoneConfigs {
		for _, neighborID := range zone.Neighbors {
			if neighborID != 0 {
				found := false
				for _, z := range World.ZoneConfigs {
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
	log.Println("World configuration initialized with", len(World.ZoneConfigs), "zones")
}
