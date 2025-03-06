package main

/*
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"time"
)

type TilemapLayer struct {
	Name       string            `json:"name"`
	Type       string            `json:"type"`
	Properties []TilemapProperty `json:"properties"`
	Data       []int             `json:"data"`
	Layers     []TilemapLayer    `json:"layers"`
	Objects    []TilemapObject   `json:"objects"`
	Width      int               `json:"width"`
	Height     int               `json:"height"`
}

type TilemapProperty struct {
	Name  string      `json:"name"`
	Type  string      `json:"type"`
	Value interface{} `json:"value"`
}

type TilemapObject struct {
	Properties []TilemapProperty `json:"properties"`
}

type EnemyLayer struct {
	Name             string
	EnemyType        string
	RespawnIntervalS float64
	SpawnChance      float64
	OccupiedTiles    []TilePosition
	EnemiesOnLayer   map[string]*Enemy
	LastRespawnTime  int64
}

type TilePosition struct {
	X int
	Y int
}

var enemyLayers = make(map[string]*EnemyLayer)

func loadTilemapForZone(zone *Zone) error {
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
	zone.Tilemap = &Tilemap{Layers: tilemap.Layers}
	for _, layer := range tilemap.Layers {
		processLayer(zone, layer, "")
	}
	return nil
}

func processLayer(zone *Zone, layer TilemapLayer, parentGroup string) {
	if layer.Type == "group" {
		for _, subLayer := range layer.Layers {
			processLayer(zone, subLayer, layer.Name)
		}
		return
	}

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
			if prop.Type == "float" {
				respawnIntervalS = prop.Value.(float64)
			}
		case "spawnChance":
			if prop.Type == "float" {
				spawnChance = prop.Value.(float64)
			}
		}
	}
	if isEnemyLayer && enemyType != "" && respawnIntervalS > 0 && spawnChance > 0 {
		enemyLayer := &EnemyLayer{
			Name:             layer.Name,
			EnemyType:        enemyType,
			RespawnIntervalS: respawnIntervalS,
			SpawnChance:      spawnChance,
			OccupiedTiles:    make([]TilePosition, 0),
			EnemiesOnLayer:   make(map[string]*Enemy),
			LastRespawnTime:  time.Now().UnixMilli(),
		}
		if layer.Type == "tilelayer" && layer.Data != nil {
			for y := 0; y < layer.Height; y++ {
				for x := 0; x < layer.Width; x++ {
					tileIndex := y*layer.Width + x
					if tileIndex < len(layer.Data) && layer.Data[tileIndex] != 0 {
						enemyLayer.OccupiedTiles = append(enemyLayer.OccupiedTiles, TilePosition{X: x, Y: y})
					}
				}
			}
		}
		initialSpawnEnemies(zone, enemyLayer)
		zone.Mu.Lock()
		enemyLayers[layer.Name] = enemyLayer
		zone.Mu.Unlock()
	}
}

func initialSpawnEnemies(zone *Zone, layer *EnemyLayer) {
	rand.Seed(time.Now().UnixNano())
	count := 0
	for _, tile := range layer.OccupiedTiles {
		if rand.Float64() < layer.SpawnChance {
			spawnEnemy(zone, layer, tile.X, tile.Y)
			count++
		}
	}
	log.Println("Spawned", count, "enemies in zone", zone.ID)
}

func spawnEnemy(zone *Zone, layer *EnemyLayer, tileX, tileY int) {
	enemyID := generateEnemyID(layer.Name, tileX, tileY)
	x := float32(tileX * PIXELS_PER_TILE)
	y := float32(tileY * PIXELS_PER_TILE)
	e := NewEnemy(enemyID, layer.EnemyType, layer.Name, x, y)
	zone.Mu.Lock()
	zone.Enemies[enemyID] = e
	zone.Mu.Unlock()
}

func generateEnemyID(layerName string, tileX, tileY int) string {
	return fmt.Sprintf("%s_%d_%d_%d", layerName, tileX, tileY, time.Now().Nanosecond())
}

func HandleEnemyRespawns() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		currentTime := time.Now().UnixMilli()
		for _, zone := range zones {
			zone.Mu.RLock()
			for _, layer := range enemyLayers {
				if (currentTime-layer.LastRespawnTime)/1000 >= int64(layer.RespawnIntervalS) {
					respawnEnemies(zone, layer, currentTime)
					zone.Mu.Lock()
					layer.LastRespawnTime = currentTime
					zone.Mu.Unlock()
				}
			}
			zone.Mu.RUnlock()
		}
	}
}

func respawnEnemies(zone *Zone, layer *EnemyLayer, currentTime int64) {
	totalTiles := len(layer.OccupiedTiles)
	targetEnemies := int(float64(totalTiles) * layer.SpawnChance)
	currentEnemies := countAliveEnemies(zone, layer)
	enemiesToSpawn := targetEnemies - currentEnemies
	if enemiesToSpawn <= 0 {
		return
	}
	rand.Shuffle(len(layer.OccupiedTiles), func(i, j int) {
		layer.OccupiedTiles[i], layer.OccupiedTiles[j] = layer.OccupiedTiles[j], layer.OccupiedTiles[i]
	})
	for i := 0; i < enemiesToSpawn && i < len(layer.OccupiedTiles); i++ {
		tile := layer.OccupiedTiles[i]
		spawnEnemy(zone, layer, tile.X, tile.Y)
	}
}

func countAliveEnemies(zone *Zone, layer *EnemyLayer) int {
	count := 0
	zone.Mu.RLock()
	defer zone.Mu.RUnlock()
	for _, enemy := range zone.Enemies {
		if enemy.IsAlive && enemy.LayerName == layer.Name {
			count++
		}
	}
	return count
}
*/
