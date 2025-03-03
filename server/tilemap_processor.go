package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"time"
)

// Tilemap-related structs (keep these here for modularity)
type TilemapLayer struct {
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Properties []TilemapProperty `json:"properties"`
	Data       []int             `json:"data"`    // For tile layer data (if using CSV or array format)
	Layers     []TilemapLayer    `json:"layers"`  // For nested group layers
	Objects    []TilemapObject   `json:"objects"` // For object layers (if used)
	Width      int               `json:"width"`   // Width in tiles
	Height     int               `json:"height"`  // Height in tiles
}

type TilemapProperty struct {
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

type TilemapObject struct {
	Properties []TilemapProperty `json:"properties"`
	// ... other fields as needed (e.g., x, y, width, height)
}

type EnemyLayer struct {
	Name             string
	EnemyType        string
	RespawnIntervalS float64
	SpawnChance      float64
	OccupiedTiles    []TilePosition // List of tile positions (x, y) that could spawn enemies
	Enemies          map[string]*Enemy
	LastRespawnTime  int64 // Unix timestamp in milliseconds for last respawn
}

type TilePosition struct {
	X int
	Y int
}

type Enemy struct {
	ID          string
	X           float32 // In pixels
	Y           float32 // In pixels
	Type        string
	LayerName   string // Reference to the enemy layer it belongs to
	HP          int
	MaxHP       int
	RespawnTime int64 // Unix timestamp in milliseconds for respawn
	IsAlive     bool
	VelocityX   float32
	VelocityY   float32
	Direction   int // 0 = front, 1 = left, 2 = right, 3 = back
}

// EnemyUpdate struct for broadcasting enemy state to clients
type EnemyUpdate struct {
	ID        string  `json:"id"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	HP        int     `json:"hp"`
	MaxHP     int     `json:"maxHp"`
	Type      string  `json:"type"`
	Timestamp int64   `json:"timestamp"`
	Direction int     `json:"direction"`
}

// Global variables for tilemap processor (scoped to package)
var (
	enemyLayers = make(map[string]*EnemyLayer)
	Enemies     = make(map[string]*Enemy)
)

// Load and parse the tilemap on server startup
func LoadTilemap() error {
	tilemapData, err := os.ReadFile("../shared/tilemap/mmorpg.json")
	if err != nil {
		log.Println("Failed to read tilemap file:", err)
		return err
	}

	var tilemap struct {
		Layers []TilemapLayer `json:"layers"`
	}
	if err := json.Unmarshal(tilemapData, &tilemap); err != nil {
		log.Println("Failed to parse tilemap JSON:", err)
		return err
	}

	// Search for enemy layers (including nested layers)
	for _, layer := range tilemap.Layers {
		processLayer(layer, "")
	}

	return nil
}

func processLayer(layer TilemapLayer, parentGroup string) {
	// Handle nested layers (group layers)
	if layer.Type == "group" {
		for _, subLayer := range layer.Layers {
			processLayer(subLayer, layer.Name)
		}
		return
	}

	// Check if this is an enemy layer
	var isEnemyLayer bool
	var enemyType string
	var respawnIntervalS float64
	var spawnChance float64

	for _, prop := range layer.Properties {
		switch prop.Name {
		case "isEnemyLayer":
			if prop.Type == "bool" {
				isEnemyLayer = prop.Value.(bool)
			}
		case "enemyType":
			if prop.Type == "string" {
				enemyType = prop.Value.(string)
			}
		case "respawnInterval_s":
			if prop.Type == "int" {
				respawnIntervalS = prop.Value.(float64)
			}
		case "spawnChance":
			if prop.Type == "float" {
				spawnChance = prop.Value.(float64)
			}
		}
	}

	if isEnemyLayer && enemyType != "" && respawnIntervalS > 0 && spawnChance > 0 {
		// Initialize enemy layer
		enemyLayer := &EnemyLayer{
			Name:             layer.Name,
			EnemyType:        enemyType,
			RespawnIntervalS: respawnIntervalS,
			SpawnChance:      spawnChance,
			OccupiedTiles:    make([]TilePosition, 0),
			Enemies:          make(map[string]*Enemy),
			LastRespawnTime:  time.Now().UnixMilli(),
		}

		// Find occupied tiles in the layer (for tile layers)
		if layer.Type == "tilelayer" && layer.Data != nil {
			for y := 0; y < layer.Height; y++ {
				for x := 0; x < layer.Width; x++ {
					tileIndex := y*layer.Width + x
					if tileIndex < len(layer.Data) && layer.Data[tileIndex] != 0 { // Non-zero tile ID indicates occupancy
						enemyLayer.OccupiedTiles = append(enemyLayer.OccupiedTiles, TilePosition{X: x, Y: y})
					}
				}
			}
		}

		// Initial enemy spawning based on spawnChance
		initialSpawnEnemies(enemyLayer)

		// Store the enemy layer
		mu.Lock()
		enemyLayers[layer.Name] = enemyLayer
		mu.Unlock()
	}
}

func initialSpawnEnemies(layer *EnemyLayer) {
	rand.Seed(time.Now().UnixNano())
	for _, tile := range layer.OccupiedTiles {
		if rand.Float64() < layer.SpawnChance {
			spawnEnemy(layer, tile.X, tile.Y)
		}
	}
}

func spawnEnemy(layer *EnemyLayer, tileX, tileY int) {
	enemyID := generateEnemyID(layer.Name, tileX, tileY)
	x := float32(tileX * PIXELS_PER_TILE)
	y := float32(tileY * PIXELS_PER_TILE)

	mu.Lock()
	enemy := &Enemy{
		ID:          enemyID,
		X:           x,
		Y:           y,
		Type:        layer.EnemyType,
		LayerName:   layer.Name,
		HP:          100, // Default HP, adjust as needed
		MaxHP:       100, // Default MaxHP, adjust as needed
		RespawnTime: 0,   // No respawn yet
		IsAlive:     true,
		VelocityX:   0,
		VelocityY:   0,
		Direction:   0, // Default direction (front)
	}
	Enemies[enemyID] = enemy
	mu.Unlock()

	log.Println("Spawned enemy", enemyID, "at", x, y, "for layer", layer.Name)
}

func generateEnemyID(layerName string, tileX, tileY int) string {
	return fmt.Sprintf("%s_%d_%d_%d", layerName, tileX, tileY, time.Now().Nanosecond())
}

func HandleEnemyRespawns() {
	ticker := time.NewTicker(1 * time.Second) // Check every second
	defer ticker.Stop()

	for range ticker.C {
		mu.RLock()
		currentTime := time.Now().UnixMilli()
		for _, layer := range enemyLayers {
			elapsed := (currentTime - layer.LastRespawnTime) / 1000 // Convert to seconds
			if elapsed >= int64(layer.RespawnIntervalS) {
				respawnEnemies(layer, currentTime)
				mu.Lock()
				layer.LastRespawnTime = currentTime
				mu.Unlock()
			}
		}
		mu.RUnlock()
	}
}

func respawnEnemies(layer *EnemyLayer, currentTime int64) {
	totalTiles := len(layer.OccupiedTiles)
	targetEnemies := int(float64(totalTiles) * layer.SpawnChance)
	currentEnemies := countAliveEnemies(layer)

	// Calculate how many enemies need to be spawned
	enemiesToSpawn := targetEnemies - currentEnemies
	if enemiesToSpawn <= 0 {
		return
	}

	// Randomly select tiles to spawn new enemies
	rand.Shuffle(len(layer.OccupiedTiles), func(i, j int) {
		layer.OccupiedTiles[i], layer.OccupiedTiles[j] = layer.OccupiedTiles[j], layer.OccupiedTiles[i]
	})

	for i := 0; i < enemiesToSpawn && i < len(layer.OccupiedTiles); i++ {
		tile := layer.OccupiedTiles[i]
		spawnEnemy(layer, tile.X, tile.Y)
	}
}

func countAliveEnemies(layer *EnemyLayer) int {
	count := 0
	for _, enemy := range layer.Enemies {
		if enemy.IsAlive {
			count++
		}
	}
	return count
}

// Update GetEnemyUpdates to include more enemy state and use EnemyUpdate struct
func GetEnemyUpdates() []EnemyUpdate {
	mu.RLock()
	defer mu.RUnlock()

	var enemyUpdates []EnemyUpdate
	for _, enemy := range Enemies {
		if enemy.IsAlive {
			enemyUpdate := EnemyUpdate{
				ID:        enemy.ID,
				X:         enemy.X,
				Y:         enemy.Y,
				HP:        enemy.HP,
				MaxHP:     enemy.MaxHP,
				Type:      enemy.Type,
				Timestamp: time.Now().UnixMilli(),
				Direction: enemy.Direction,
			}
			enemyUpdates = append(enemyUpdates, enemyUpdate)
		}
	}
	return enemyUpdates
}
