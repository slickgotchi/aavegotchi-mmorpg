package main

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"runtime"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Config constants
const (
	NumZones          = 9
	TickInterval      = 100 * time.Millisecond
	ZoneWidthPixels   = 256 * 32 // Tiles
	ZoneHeightPixels  = 256 * 32 // Tiles
	TileSize          = 32       // Pixels
	NumEnemiesPerZone = 1000
	PlayerMoveSpeed   = 20 * 32
)

// xp consts
const (
	MAX_LEVEL         = 50
	BASE_XP_PER_LEVEL = 100
	XP_GROWTH_FACTOR  = 1.5
)

var totalXpRequiredForLevel = make([]int, MAX_LEVEL+1)

// init runs and calcs xp requirements straight away
func init() {
	for level := 1; level <= MAX_LEVEL; level++ {
		totalXpRequiredForLevel[level] = int(float64(BASE_XP_PER_LEVEL) * math.Pow(float64(level-1), XP_GROWTH_FACTOR))
	}
}

// Message is a generic struct for client/server communication
type Message struct {
	Type     string      `json:"type"`
	Data     interface{} `json:"data"`
	PlayerID string      `json:"-"` // Not serialized to JSON (we add this in our input reading func)
}

// Zone represents an independent game zone
type Zone struct {
	ID         int
	TilemapRef string
	GridX      int
	GridY      int // Grid position (e.g., 0,0 for bottom-left)
	WorldX     float32
	WorldY     float32
	Players    map[string]*Player
	Enemies    map[string]*Enemy
	Inbound    chan Message
	mu         sync.Mutex
}

// sent to client during welcome message
type ZoneInfo struct {
	ID         int    `json:"id"`
	TilemapRef string `json:"tilemapRef"`
	// GridX      int     `json:"gridX"`
	// GridY      int     `json:"gridY"`
	WorldX float32 `json:"worldX"`
	WorldY float32 `json:"worldY"`
	// Neighbors  [8]int  `json:"neighbors"`
}

// Player represents a player entity
type Player struct {
	ID     string
	ZoneID int
	X, Y   float32 // Tile coordinates
	VX, VY float32 // Tiles per second
	Conn   *websocket.Conn

	// game stats
	MaxHP int
	HP    int
	MaxAP int
	AP    int
	ATK   int

	// game xp
	GameXP                  int
	GameLevel               int
	GameXPOnCurrentLevel    int
	GameXPTotalForNextLevel int
}

// Enemy represents an enemy entity
type Enemy struct {
	ID     string
	ZoneID int
	X, Y   float32 // Tile coordinates
	VX, VY float32 // Tiles per second
	State  string  // "Spawn", "Roam", etc.

	Type      string
	Direction int

	// game stats
	MaxHP int
	HP    int
	ATK   int
}

// GameServer holds the overall state
type GameServer struct {
	Zones map[int]*Zone
}

// PlayerUpdate represents player data sent to clients
type PlayerUpdate struct {
	PlayerID  string  `json:"playerId"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	ZoneID    int     `json:"zoneId"`
	Timestamp int64   `json:"timestamp"`

	// game stats
	MaxHP int `json:"maxHp"`
	HP    int `json:"hp"`
	MaxAP int `json:"maxAp"`
	AP    int `json:"ap"`

	GameXP                  int `json:"gameXp"`
	GameLevel               int `json:"gameLevel"`
	GameXPOnCurrentLevel    int `json:"gameXpOnCurrentLevel"`
	GameXPTotalForNextLevel int `json:"gameXpTotalForNextLevel"`
}

// EnemyUpdate represents enemy data sent to clients
type EnemyUpdate struct {
	EnemyID   string  `json:"enemyId"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	ZoneID    int     `json:"zoneId"`
	Timestamp int64   `json:"timestamp"`

	Type      string `json:"type"`
	Direction int    `json:"int"`

	MaxHP int `json:"maxHp"`
	HP    int `json:"hp"`
}

// ActiveZoneList represents the list of 4 active zones
type ActiveZoneList struct {
	CurrentZoneID  int `json:"currentZoneId"`
	XAxisZoneID    int `json:"xAxisZoneId"`
	YAxisZoneID    int `json:"yAxisZoneId"`
	DiagonalZoneID int `json:"diagonalZoneId"`
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == "http://localhost:5173"
	},
}

func NewGameServer() *GameServer {
	// Ensure world configuration is initialized
	InitializeWorld()

	gs := &GameServer{
		Zones: make(map[int]*Zone),
	}

	// Populate zones from world configs
	for _, zoneConfig := range World.ZoneConfigs {
		// create a new zone from our zone config
		zone := &Zone{
			ID:         zoneConfig.ID,
			TilemapRef: zoneConfig.TilemapRef,
			GridX:      zoneConfig.GridX, // Use calculated GridX
			GridY:      zoneConfig.GridY, // Use calculated GridY
			WorldX:     zoneConfig.WorldX,
			WorldY:     zoneConfig.WorldY,
			Players:    make(map[string]*Player),
			Enemies:    make(map[string]*Enemy),
			Inbound:    make(chan Message, 100),
			mu:         sync.Mutex{},
		}

		gs.Zones[zoneConfig.ID] = zone

		log.Println("Added zone ", zoneConfig.ID, " to gs.Zones. Start populating...")

		// null/0 zones we don't spawn anything
		if IsEmptyTilemapGridName(zoneConfig.TilemapRef) {
			log.Println("Empty zones do not get populated. Continuing...")
			continue
		}

		// Spawn enemies within the zone's bounds
		for j := 0; j < NumEnemiesPerZone; j++ {
			enemyType := "easy"
			randType := rand.Intn(3)
			if randType == 0 {
				enemyType = "easy"
			} else if randType == 1 {
				enemyType = "medium"
			} else {
				enemyType = "hard"
			}
			enemyID := fmt.Sprintf("enemy%d_%d", zoneConfig.ID, j)
			// Calculate enemy position based on the zone's grid position
			gs.Zones[zoneConfig.ID].Enemies[enemyID] = &Enemy{
				ID:        enemyID,
				ZoneID:    zoneConfig.ID,
				X:         zoneConfig.WorldX + float32(rand.Intn(ZoneWidthPixels)), // Within zone bounds
				Y:         zoneConfig.WorldY + float32(rand.Intn(ZoneHeightPixels)),
				VX:        float32(rand.Float32()*0.5-1) * 100,
				VY:        float32(rand.Float32()*0.5-1) * 100,
				State:     "Spawn",
				Type:      enemyType,
				Direction: 0,

				MaxHP: 100,
				HP:    100,
			}
			// log.Printf("New enemy %s in zone %d at x: %.2f, y: %.2f", enemyID, config.ID, gs.Zones[i].Enemies[enemyID].X, gs.Zones[i].Enemies[enemyID].Y)
		}
	}

	return gs
}

// StartWorkers launches one worker goroutine per zone
func (gs *GameServer) StartWorkers() {
	for _, zone := range gs.Zones {
		go gs.worker(zone)
	}
}

// worker handles updates for a single zone
func (gs *GameServer) worker(zone *Zone) {
	ticker := time.NewTicker(TickInterval)
	defer ticker.Stop()

	for range ticker.C {
		gs.processZone(zone)
	}
}

// getActiveZones calculates the 4 active zones for a player based on position and neighbors
func (gs *GameServer) getActiveZones(player *Player) ActiveZoneList {
	// store players current zone ID
	playerCurrentZoneID := player.ZoneID
	playerCurrentZone := gs.Zones[playerCurrentZoneID] // Previously: looped through gs.Zones to find the zone
	if playerCurrentZone == nil {
		log.Printf("Warning: Current zone %d not found for player %s", playerCurrentZoneID, player.ID)
		return ActiveZoneList{CurrentZoneID: playerCurrentZoneID, XAxisZoneID: 0, YAxisZoneID: 0, DiagonalZoneID: 0}
	}

	// Find the config for the current zone
	currentZoneConfig, err := getZoneConfigByZoneID(playerCurrentZoneID)
	if err != nil {
		log.Printf("Warning: Requested zone %d is not valid", playerCurrentZoneID)
	}

	// find the player local coordinates within the zone
	localX := int(player.X) % ZoneWidthPixels
	localY := int(player.Y) % ZoneHeightPixels

	// determine x and y
	var xAxisZoneID, yAxisZoneID int
	if localX > ZoneWidthPixels/2 {
		// player on right side of zone
		xAxisZoneID = currentZoneConfig.Neighbors[2]
	} else {
		// player on left side of zone
		xAxisZoneID = currentZoneConfig.Neighbors[6]
	}
	if localY > ZoneHeightPixels/2 {
		// player on south side of zone
		yAxisZoneID = currentZoneConfig.Neighbors[4]
	} else {
		// player on north side of zone
		yAxisZoneID = currentZoneConfig.Neighbors[0]
	}

	// determine diagonals
	adjacentDiagonals := []struct {
		zoneID    int
		centerX   float32
		centerY   float32
		direction int
	}{
		{currentZoneConfig.Neighbors[7], 0, 0, 7},
		{currentZoneConfig.Neighbors[1], 0, 0, 1},
		{currentZoneConfig.Neighbors[3], 0, 0, 3},
		{currentZoneConfig.Neighbors[5], 0, 0, 5},
	}

	// Update center positions using the map
	for i := range adjacentDiagonals {
		if adjacentDiagonals[i].zoneID == 0 {
			continue
		}
		pos := gs.Zones[adjacentDiagonals[i].zoneID] // Access via map
		if pos == nil {
			log.Printf("Warning: Neighbor zone %d not found", adjacentDiagonals[i].zoneID)
			adjacentDiagonals[i].zoneID = 0
			continue
		}
		adjacentDiagonals[i].centerX = pos.WorldX + float32(ZoneWidthPixels/2)
		adjacentDiagonals[i].centerY = pos.WorldY + float32(ZoneHeightPixels/2)
	}

	minDistance := float32(math.Inf(1))
	var diagonalZoneID int
	playerCenterX := player.X
	playerCenterY := player.Y
	for _, z := range adjacentDiagonals {
		if z.zoneID == 0 {
			continue
		}
		dx := playerCenterX - z.centerX
		dy := playerCenterY - z.centerY
		distance := float32(math.Sqrt(float64(dx*dx + dy*dy)))
		if distance < minDistance {
			minDistance = distance
			diagonalZoneID = z.zoneID
		}
	}

	if diagonalZoneID == 0 && minDistance == float32(math.Inf(1)) {
		for _, neighbor := range currentZoneConfig.Neighbors {
			if neighbor != 0 {
				diagonalZoneID = neighbor
				break
			}
		}
	}

	activeZoneList := ActiveZoneList{
		CurrentZoneID:  playerCurrentZoneID,
		XAxisZoneID:    xAxisZoneID,
		YAxisZoneID:    yAxisZoneID,
		DiagonalZoneID: diagonalZoneID,
	}

	return activeZoneList
}

func (gs *GameServer) processZone(zone *Zone) {
	// Process inbound messages
	for len(zone.Inbound) > 0 {
		msg := <-zone.Inbound
		switch msg.Type {
		case "input":
			// Use the PlayerID attached to the message
			playerID := msg.PlayerID
			player := zone.Players[playerID]
			if player == nil {
				log.Printf("Player %s not found in zone %d", playerID, zone.ID)
				continue
			}

			data, ok := msg.Data.(map[string]interface{})
			if !ok {
				log.Printf("Invalid input message data for player %s: expected map", playerID)
				continue
			}
			keys, ok := data["keys"].(map[string]interface{})
			if !ok {
				log.Printf("Invalid input message keys for player %s: expected map", playerID)
				continue
			}

			player.VX = 0
			player.VY = 0
			speed := float32(PlayerMoveSpeed)
			if w, ok := keys["W"].(bool); ok && w {
				player.VY = -speed
			}
			if s, ok := keys["S"].(bool); ok && s {
				player.VY = speed
			}
			if a, ok := keys["A"].(bool); ok && a {
				player.VX = -speed
			}
			if d, ok := keys["D"].(bool); ok && d {
				player.VX = speed
			}
			if space, ok := keys["SPACE"].(bool); ok && space {
				log.Printf("Player %s pressed SPACE in Zone %d", playerID, zone.ID)
			}
		default:
			log.Printf("Unhandled message type in Zone %d: %s", zone.ID, msg.Type)
		}
	}

	// Update players
	dt := float32(TickInterval.Seconds())
	for _, player := range zone.Players {
		player.X += player.VX * dt
		player.Y += player.VY * dt
		newZoneID := gs.calculateZoneID(player.X, player.Y, player)

		// check for null zone or player out of bounds
		if newZoneID == 0 || IsEmptyTilemapGridName(gs.Zones[newZoneID].TilemapRef) || player.X < 0 || player.Y < 0 {
			player.X -= player.VX * dt
			player.Y -= player.VY * dt
		} else if newZoneID != player.ZoneID {
			var lastZoneUpdates []PlayerUpdate
			// we need to do a movement message from this zone before deleting
			lastZoneUpdates = append(lastZoneUpdates, PlayerUpdate{
				PlayerID:  player.ID,
				X:         player.X,
				Y:         player.Y,
				ZoneID:    player.ZoneID,
				Timestamp: time.Now().UnixMilli(),

				MaxHP: player.MaxHP,
				HP:    player.HP,
				MaxAP: player.MaxAP,
				AP:    player.AP,

				GameXP:                  player.GameXP,
				GameLevel:               player.GameLevel,
				GameXPOnCurrentLevel:    player.GameXPOnCurrentLevel,
				GameXPTotalForNextLevel: player.GameXPTotalForNextLevel,
			})

			batch := []Message{
				{Type: "playerUpdates", Data: lastZoneUpdates},
			}
			if err := player.Conn.WriteJSON(batch); err != nil {
				log.Printf("Error sending batch to %s: %v", player.ID, err)
			}

			// now switch zone
			gs.switchZone(player, zone, newZoneID)

			continue
		}
	}

	timestamp := time.Now().UnixMilli()

	// Prepare and send updates for each player in this zone
	for _, player := range zone.Players {
		activeZones := gs.getActiveZones(player)

		var allPlayerUpdates []PlayerUpdate
		var allEnemyUpdates []EnemyUpdate

		// Collect updates from all 4 active zones
		activeZoneIDs := []int{activeZones.CurrentZoneID, activeZones.XAxisZoneID, activeZones.YAxisZoneID, activeZones.DiagonalZoneID}
		for _, zoneID := range activeZoneIDs {
			if zoneID == 0 {
				continue // Skip null zone
			}
			// Find the zone index based on ID
			var targetZone *Zone
			for _, z := range gs.Zones {
				if z.ID == zoneID {
					targetZone = z
					break
				}
			}
			if targetZone == nil {
				log.Printf("Warning: Zone ID %d not found for player %s", zoneID, player.ID)
				continue
			}

			targetZone.mu.Lock()
			for _, p := range targetZone.Players {
				allPlayerUpdates = append(allPlayerUpdates, PlayerUpdate{
					PlayerID:  p.ID,
					X:         p.X,
					Y:         p.Y,
					ZoneID:    p.ZoneID,
					Timestamp: timestamp,

					// game stats
					MaxHP: p.MaxHP,
					HP:    p.HP,
					MaxAP: p.MaxAP,
					AP:    p.AP,

					// xp
					GameXP:                  p.GameXP,
					GameLevel:               p.GameLevel,
					GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
					GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
				})
				log.Printf("Player pos x: %f, y: %f, timestamp: %d", p.X, p.Y, timestamp)
			}
			for _, e := range targetZone.Enemies {
				allEnemyUpdates = append(allEnemyUpdates, EnemyUpdate{
					EnemyID:   e.ID,
					X:         e.X,
					Y:         e.Y,
					ZoneID:    e.ZoneID,
					Timestamp: timestamp,
					Type:      e.Type,
					Direction: e.Direction,

					// game stats
					MaxHP: e.MaxHP,
					HP:    e.HP,
				})
			}
			targetZone.mu.Unlock()
		}

		// Send batched messages as a single array
		batch := []Message{
			{Type: "activeZones", Data: activeZones},
			{Type: "playerUpdates", Data: allPlayerUpdates},
			{Type: "enemyUpdates", Data: allEnemyUpdates},
		}
		if err := player.Conn.WriteJSON(batch); err != nil {
			log.Printf("Error sending batch to %s: %v", player.ID, err)
		}
	}
}

func (gs *GameServer) calculateZoneID(x, y float32, player *Player) int {
	// Convert to grid coordinates
	gridX := int(x) / (World.ZoneSize * World.TileSize)
	gridY := int(y) / (World.ZoneSize * World.TileSize)

	// Check if coordinates are within the grid bounds
	if gridY < 0 || gridY >= len(World.ZoneGrid) || gridX < 0 || gridX >= len(World.ZoneGrid[gridY]) {
		return 0 // Out of bounds, return null zone
	}

	zoneID := World.ZoneGrid[gridY][gridX]
	if zoneID == 0 {
		// If the current grid position is empty, check neighbors of the player's current zone
		if player != nil {
			currentPlayerZone := gs.getZoneByPlayerID(player.ID)
			if currentPlayerZone != nil {
				currentConfig := World.ZoneConfigs[currentPlayerZone.ID-1] // Adjust index since IDs start at 1
				for _, neighborID := range currentConfig.Neighbors {
					if neighborID != 0 {
						pos := World.ZoneConfigs[neighborID]
						minX := float32(pos.GridX * ZoneWidthPixels)
						maxX := minX + float32(ZoneWidthPixels)
						minY := float32(pos.GridY * ZoneHeightPixels)
						maxY := minY + float32(ZoneHeightPixels)
						if x >= minX && x < maxX && y >= minY && y < maxY {
							return neighborID
						}
					}
				}
			}
		}
		return 0 // Default to null zone if no valid neighbor found
	}
	return zoneID
}

// switchZone transfers a player
func (gs *GameServer) switchZone(player *Player, oldZone *Zone, newZoneID int) {
	log.Println("Deleting ", player.ID, " from zone ", oldZone.ID)
	delete(oldZone.Players, player.ID)
	player.ZoneID = newZoneID
	log.Println("Set to new zone: ", player.ZoneID)
	newZone := gs.Zones[newZoneID]
	// newZone := gs.Zones[newZoneID]
	newZone.Players[player.ID] = player
	log.Printf("Player %s switched from Zone %d (%d,%d) to Zone %d (%d,%d)",
		player.ID, oldZone.ID, oldZone.GridX, oldZone.GridY, newZone.ID, newZone.GridX, newZone.GridY)
}

// getZoneByPlayerID finds the current zone of a player
func (gs *GameServer) getZoneByPlayerID(playerID string) *Zone {
	for _, zone := range gs.Zones { // Iterate over map values
		if _, exists := zone.Players[playerID]; exists {
			return zone
		}
	}
	return nil
}

func getZoneConfigByZoneID(zoneId int) (ZoneConfig, error) {
	for _, zoneConfig := range World.ZoneConfigs {
		if zoneConfig.ID == zoneId {
			return zoneConfig, nil
		}
	}
	return ZoneConfig{}, fmt.Errorf("ZoneConfig not found for zoneId: %d", zoneId)
}

// handleWebSocket handles client connections
func (gs *GameServer) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	// CREATE PLAYER
	playerID := fmt.Sprintf("player%d", time.Now().UnixNano())
	startX := 1.5 * ZoneWidthPixels
	startY := 1.5 * ZoneWidthPixels
	player := &Player{
		ID:     playerID,
		ZoneID: 0,               // Bottom-left zone
		X:      float32(startX), // Center of zone 0
		Y:      float32(startY), // Center of zone 0
		Conn:   conn,

		MaxHP: 300,
		HP:    300,
		MaxAP: 150,
		AP:    150,

		GameXP:                  0,
		GameLevel:               1,
		GameXPOnCurrentLevel:    0,
		GameXPTotalForNextLevel: totalXpRequiredForLevel[2],
	}
	player.ZoneID = gs.calculateZoneID(float32(startX), float32(startY), player)

	initialZone := gs.Zones[player.ZoneID]
	if initialZone == nil {
		log.Printf("Error: Initial zone %d not found for player %s", player.ZoneID, playerID)
		return
	}
	initialZone.Players[playerID] = player
	log.Printf("Player %s spawned in Zone %d (%d,%d)", playerID, initialZone.ID, initialZone.GridX, initialZone.GridY)

	// Prepare welcome message with world zones
	zonesInfo := make([]ZoneInfo, 0, len(gs.Zones))
	for _, z := range gs.Zones { // Iterate over map values
		var config ZoneConfig
		for _, c := range World.ZoneConfigs {
			if c.ID == z.ID {
				config = c
				break
			}
		}
		zonesInfo = append(zonesInfo, ZoneInfo{
			ID:         z.ID,
			TilemapRef: config.TilemapRef,
			WorldX:     config.WorldX,
			WorldY:     config.WorldY,
		})
	}

	// Send batched messages as a single array
	batch := []Message{
		{Type: "welcome", Data: map[string]interface{}{
			"playerId": playerID,
			"zones":    zonesInfo,
		}},
	}
	if err := player.Conn.WriteJSON(batch); err != nil {
		log.Printf("Error sending welcome message to %s: %v", player.ID, err)
	}

	// Read all current messages for this specific connection
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("Error reading from %s: %v", playerID, err)
			break
		}
		// Attach the playerID to the message
		msg.PlayerID = playerID
		currentZone := gs.getZoneByPlayerID(playerID)
		if currentZone != nil {
			select {
			case currentZone.Inbound <- msg:
			default:
				log.Printf("Inbound channel full for Zone %d, dropping input for %s", currentZone.ID, playerID)
			}
		} else {
			log.Printf("Player %s not found in any zone, sending to initial Zone %d", playerID, initialZone.ID)
			select {
			case initialZone.Inbound <- msg:
			default:
				log.Printf("Inbound channel full for initial Zone %d, dropping input for %s", initialZone.ID, playerID)
			}
		}
	}

	currentZone := gs.getZoneByPlayerID(playerID)
	if currentZone != nil {
		delete(currentZone.Players, playerID)
	} else {
		delete(initialZone.Players, playerID)
	}
	log.Printf("Player %s disconnected", playerID)
}

func main() {
	runtime.GOMAXPROCS(runtime.NumCPU()) // Adapt to available cores
	gs := NewGameServer()

	gs.StartWorkers()

	http.HandleFunc("/ws", gs.handleWebSocket)
	log.Println("Starting WebSocket server on :8080")
	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatalf("WebSocket server failed: %v", err)
	}
}

/*
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var httpClient = &http.Client{
	Timeout: 5 * time.Second,
}

type Config struct {
	NumWorkers int
	NumZones   int
}

var config Config

func initConfig() {
	flag.IntVar(&config.NumWorkers, "workers", runtime.NumCPU(), "Number of worker goroutines (defaults to CPU threads)")
	flag.IntVar(&config.NumZones, "zones", 1, "Number of 256x256 zones (1-64)")
	flag.Parse()

	if config.NumWorkers < 1 {
		config.NumWorkers = 1
	} else if config.NumWorkers > 64 {
		config.NumWorkers = 64
	}
	if config.NumZones < 1 {
		config.NumZones = 1
	} else if config.NumZones > 64 {
		config.NumZones = 64
	}
	log.Printf("Config: %d workers, %d zones", config.NumWorkers, config.NumZones)
}

type Zone struct {
	ID        int
	Mu        sync.RWMutex
	Players   map[string]*Player
	Enemies   map[string]*Enemy
	EventChan chan Event
	Tilemap   *Tilemap
}

type Worker struct {
	ID        int
	Zones     map[int]*Zone
	EventChan chan Event
}

type Event struct {
	Type      string
	ZoneID    int
	PlayerID  string
	EnemyID   string
	Data      interface{}
	Timestamp int64
}

type Tilemap struct {
	Layers []TilemapLayer
}

type PlayerUpdate struct {
Zone int	`json:`
	ID        string  `json:"id"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	HP        int     `json:"hp"`
	MaxHP     int     `json:"maxHp"`
	AP        int     `json:"ap"`
	MaxAP     int     `json:"maxAp"`
	GotchiID  int     `json:"gotchiId"`
	Timestamp int64   `json:"timestamp"`
	Direction int     `json:"direction"`
	GameXP    int     `json:"gameXp"`
	GameLevel int     `json:"gameLevel"`
}

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

type Message struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type AttackUpdate struct {
	AttackerID string   `json:"attackerId"`
	HitIDs     []string `json:"hitIds"`
	Type       string   `json:"type"`
	Radius     float32  `json:"radius"`
	X          float32  `json:"x"`
	Y          float32  `json:"y"`
}

type DamageUpdate struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Damage int    `json:"damage"`
}

var (
	zones            []*Zone
	workers          []*Worker
	eventChan        = make(chan Event, 10000)
	playerUpdateChan = make(chan []PlayerUpdate, 1000)
	Zone int	`json:`
	Zone int	`json:`
	enemyUpdateChan  = make(chan []EnemyUpdate, 1000)
	attackUpdateChan = make(chan []AttackUpdate, 1000)
	damageUpdateChan = make(chan []DamageUpdate, 1000)
	cleanupChan      = make(chan string, 100)
	TICK_INTERVAL_MS = 16
	MAP_WIDTH_TILES  = 256
	MAP_HEIGHT_TILES = 256
	PIXELS_PER_TILE  = 32
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == "http://localhost:5173"
	},
}

func initZonesAndWorkers() {
	zones = make([]*Zone, config.NumZones)
	var wg sync.WaitGroup
	tilemapData, err := os.ReadFile("../shared/tilemap/mmorpg.json")
	if err != nil {
		log.Fatal("Failed to read tilemap file:", err)
	}
	var tilemap struct {
		Layers []TilemapLayer `json:"layers"`
	}
	if err := json.Unmarshal(tilemapData, &tilemap); err != nil {
		log.Fatal("Failed to parse tilemap JSON:", err)
	}
	sharedTilemap := &Tilemap{Layers: tilemap.Layers}
	log.Println("Loaded shared tilemap for all zones")

	for i := 0; i < config.NumZones; i++ {
		zones[i] = &Zone{
			ID:        i,
			Players:   make(map[string]*Player),
			Enemies:   make(map[string]*Enemy),
			EventChan: make(chan Event, 1000),
			Tilemap:   sharedTilemap,
		}
		wg.Add(1)
		go func(zone *Zone) {
			defer wg.Done()
			for _, layer := range sharedTilemap.Layers {
				processLayer(zone, layer, "")
			}
			log.Println("Initialized zone", zone.ID)
		}(zones[i])
	}

	workers = make([]*Worker, config.NumWorkers)
	zonesPerWorker := config.NumZones / config.NumWorkers
	extraZones := config.NumZones % config.NumWorkers
	zoneIndex := 0
	for i := 0; i < config.NumWorkers; i++ {
		numZones := zonesPerWorker
		if i < extraZones {
			numZones++
		}
		workerZones := make(map[int]*Zone)
		for j := 0; j < numZones && zoneIndex < config.NumZones; j++ {
			workerZones[zones[zoneIndex].ID] = zones[zoneIndex]
			log.Println("Assigned zone", zones[zoneIndex].ID, "to worker", i)
			zoneIndex++
		}
		workers[i] = &Worker{
			ID:        i,
			Zones:     workerZones,
			EventChan: make(chan Event, 1000),
		}
		go workers[i].Run()
	}
	go distributeEvents()

	wg.Wait()
	log.Println("All zones initialized")
}

func distributeEvents() {
	for event := range eventChan {
		for _, worker := range workers {
			if _, ok := worker.Zones[event.ZoneID]; ok {
				select {
				case worker.EventChan <- event:
					log.Println("Distributed event Type:", event.Type, "to worker", worker.ID)
				default:
					log.Println("Worker", worker.ID, "EventChan full, dropping event Type:", event.Type)
				}
				break
			}
		}
	}
}

func (w *Worker) Run() {
	ticker := time.NewTicker(time.Duration(TICK_INTERVAL_MS) * time.Millisecond)
	defer ticker.Stop()

	log.Println("Worker", w.ID, "started, listening on eventChan")
	for {
		select {
		case event := <-w.EventChan:
			if zone, ok := w.Zones[event.ZoneID]; ok {
				w.processEvent(zone, event)
				log.Println("Worker", w.ID, "processed event Type:", event.Type, "for PlayerID:", event.PlayerID)
			} else {
				log.Println("Worker", w.ID, "no zone for ZoneID:", event.ZoneID)
			}
		case now := <-ticker.C:
			for _, zone := range w.Zones {
				log.Println("lock zone in RUn()")
				zone.Mu.Lock()
				for _, p := range zone.Players {
					w.updatePlayerPosition(p, now.UnixMilli())
				}
				for _, e := range zone.Enemies {
					w.updateEnemy(e, now.UnixMilli())
				}
				w.broadcastUpdates(zone, now.UnixMilli())
				zone.Mu.Unlock()
				log.Println("unlock zone in Run()")
			}
		}
	}
}

func (w *Worker) processEvent(zone *Zone, event Event) {
	switch event.Type {
	case "join":
		p := zone.Players[event.PlayerID]
		handlePlayerMessageJoin(p, Message{Type: "join", Data: event.Data.(json.RawMessage)})
	case "input":
		p := zone.Players[event.PlayerID]
		if p != nil {
			handlePlayerMessageInput(p, event.Data.(json.RawMessage))
		} else {
			log.Println("Player", event.PlayerID, "not found in zone", event.ZoneID)
		}
	case "disconnect":
		delete(zone.Players, event.PlayerID)
	case "attack":
		w.handlePlayerAttack(zone, event)
	}
}

func (w *Worker) updatePlayerPosition(p *Player, now int64) {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	deltaTime := float32(now-p.LastUpdate) / 1000.0
	p.X += p.VelocityX * deltaTime
	p.Y += p.VelocityY * deltaTime
	p.LastUpdate = now
	log.Println("Updated position for", p.ID, "X:", p.X, "Y:", p.Y)
}

func (w *Worker) updateEnemy(e *Enemy, now int64) {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	deltaTime := float32(now-e.LastUpdate) / 1000.0
	e.X += e.VelocityX * deltaTime
	e.Y += e.VelocityY * deltaTime
	e.LastUpdate = now
}

func (w *Worker) handlePlayerAttack(zone *Zone, event Event) {
	p := zone.Players[event.PlayerID]
	if p == nil {
		return
	}
	p.Mu.Lock()
	defer p.Mu.Unlock()

	var attackUpdates []AttackUpdate
	var damageUpdates []DamageUpdate
	playerMinX := p.X - p.AttackRadius - 40*0.5*32
	playerMinY := p.Y - p.AttackRadius - 25*0.5*32
	playerMaxX := p.X + p.AttackRadius + 40*0.5*32
	playerMaxY := p.Y + p.AttackRadius + 25*0.5*32

	p.AttackTimerMs -= float32(TICK_INTERVAL_MS)
	if p.AttackTimerMs < 0 {
		p.AttackTimerMs += p.AttackIntervalMs
		hitEnemies := make([]string, 0)
		for _, e := range zone.Enemies {
			if e.X < playerMinX || e.X > playerMaxX || e.Y < playerMinY || e.Y > playerMaxY {
				continue
			}
			distSq := (e.X-p.X)*(e.X-p.X) + (e.Y-p.Y)*(e.Y-p.Y)
			if distSq < p.AttackRadius*p.AttackRadius {
				e.Mu.Lock()
				e.HP -= p.ATK
				damageUpdates = append(damageUpdates, DamageUpdate{
					ID:     e.ID,
					Type:   "enemy",
					Damage: p.ATK,
				})
				hitEnemies = append(hitEnemies, e.ID)
				if e.HP <= 0 && e.KillerID == "" && !e.IsDeathProcessed {
					e.KillerID = p.ID
					OnDeath(e, p.ID)
				}
				e.Mu.Unlock()
			}
		}
		attackUpdates = append(attackUpdates, AttackUpdate{
			AttackerID: p.ID,
			HitIDs:     hitEnemies,
			Type:       "playerAttack",
			Radius:     p.AttackRadius,
			X:          p.X,
			Y:          p.Y,
		})
	}
	if len(attackUpdates) > 0 {
		attackUpdateChan <- attackUpdates
	}
	if len(damageUpdates) > 0 {
		damageUpdateChan <- damageUpdates
	}
}

func (w *Worker) broadcastUpdates(zone *Zone, timestamp int64) {
	var playerUpdates []PlayerUpdate
	Zone int	`json:`
	Zone int	`json:`
	var enemyUpdates []EnemyUpdate
	for _, p := range zone.Players {
		p.Mu.RLock()
		playerUpdates = append(playerUpdates, PlayerUpdate{
		Zone int	`json:`
		Zone int	`json:`
		Zone int	`json:`
			ID:        p.ID,
			X:         p.X,
			Y:         p.Y,
			HP:        p.HP,
			MaxHP:     p.MaxHP,
			AP:        p.AP,
			MaxAP:     p.MaxAP,
			GotchiID:  p.GotchiID,
			Timestamp: timestamp,
			Direction: p.Direction,
			GameXP:    p.GameXP,
			GameLevel: p.GameLevel,
		})
		p.Mu.RUnlock()
	}
	for _, e := range zone.Enemies {
		e.Mu.RLock()
		if e.IsAlive {
			enemyUpdates = append(enemyUpdates, EnemyUpdate{
				ID:        e.ID,
				X:         e.X,
				Y:         e.Y,
				HP:        e.HP,
				MaxHP:     e.MaxHP,
				Type:      e.Type,
				Timestamp: timestamp,
				Direction: e.Direction,
			})
		}
		e.Mu.RUnlock()
	}
	if len(playerUpdates) > 0 {
	Zone int	`json:`
		select {
		case playerUpdateChan <- playerUpdates:
			Zone int	`json:`
			Zone int	`json:`
			log.Println("Broadcasted player updates:", len(playerUpdates))
			Zone int	`json:`
		default:
			log.Println("playerUpdateChan full, skipping broadcast")
			Zone int	`json:`
		}
	}
	if len(enemyUpdates) > 0 {
		enemyUpdateChan <- enemyUpdates
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	log.Println("Received WebSocket connection attempt from", r.RemoteAddr) // Log here
	HandlePlayerConnection(w, r)
}

func BroadcastLoopEnemyUpdates(enemyUpdateChan <-chan []EnemyUpdate) {
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		select {
		case updates := <-enemyUpdateChan:
			for _, zone := range zones {
				log.Println("lock zone in broadcastenemyupdates")
				zone.Mu.RLock()
				for _, p := range zone.Players {
					p.ConnMu.Lock()
					if err := p.Conn.WriteJSON(Message{Type: "enemyUpdates", Data: mustMarshal(updates)}); err != nil {
						log.Println("Failed to broadcast enemy updates to", p.ID, ":", err)
					}
					p.ConnMu.Unlock()
				}
				zone.Mu.RUnlock()
				log.Println("unlock zone in broadcastenemyupdates")
			}
		default:
		}
	}
}

func BroadcastLoopPlayerUpdates(playerUpdateChan <-chan []PlayerUpdate) {
Zone int	`json:`
Zone int	`json:`
Zone int	`json:`
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		select {
		case updates := <-playerUpdateChan:
			Zone int	`json:`
			for _, zone := range zones {
				log.Println("lock zone in updates")
				zone.Mu.RLock()
				for _, p := range zone.Players {
					p.ConnMu.Lock()
					if err := p.Conn.WriteJSON(Message{Type: "playerUpdates", Data: mustMarshal(updates)}); err != nil {
					Zone int	`json:`
						log.Println("Failed to broadcast player updates to", p.ID, ":", err)
					}
					p.ConnMu.Unlock()
				}
				zone.Mu.RUnlock()
				log.Println("unlock zone in updates")
			}
		default:
		}
	}
}

func BroadcastLoopAttackUpdates(attackUpdateChan <-chan []AttackUpdate) {
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		select {
		case updates := <-attackUpdateChan:
			for _, zone := range zones {
				log.Println("lock zone in updates")
				zone.Mu.RLock()
				for _, p := range zone.Players {
					p.ConnMu.Lock()
					if err := p.Conn.WriteJSON(Message{Type: "attackUpdates", Data: mustMarshal(updates)}); err != nil {
						log.Println("Failed to broadcast attack updates to", p.ID, ":", err)
					}
					p.ConnMu.Unlock()
				}
				zone.Mu.RUnlock()
				log.Println("unlock zone in updates")
			}
		default:
		}
	}
}

func BroadcastLoopDamageUpdates(damageUpdateChan <-chan []DamageUpdate) {
	ticker := time.NewTicker(60 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		select {
		case updates := <-damageUpdateChan:
			for _, zone := range zones {
				log.Println("lock zone in updates")
				zone.Mu.RLock()
				for _, p := range zone.Players {
					p.ConnMu.Lock()
					if err := p.Conn.WriteJSON(Message{Type: "damageUpdates", Data: mustMarshal(updates)}); err != nil {
						log.Println("Failed to broadcast damage updates to", p.ID, ":", err)
					}
					p.ConnMu.Unlock()
				}
				zone.Mu.RUnlock()
				log.Println("unlock zone in updates")
			}
		default:
		}
	}
}

func broadcastMessage(msg Message, excludeID string) {
	for _, zone := range zones {
		zone.Mu.RLock()
		for id, p := range zone.Players {
			if excludeID != "" && id == excludeID {
				continue
			}
			p.ConnMu.Lock()
			if err := p.Conn.WriteJSON(msg); err != nil {
				log.Println("Failed to broadcast to", id, ":", err)
			}
			p.ConnMu.Unlock()
		}
		zone.Mu.RUnlock()
	}
}

func mustMarshal(v interface{}) json.RawMessage {
	data, err := json.Marshal(v)
	if err != nil {
		log.Println("JSON encoding error:", err)
		return nil
	}
	return json.RawMessage(data)
}

func fetchGotchiStats(gotchiId string) (int, error) {
	query := `{"query":"query($id: ID!) { aavegotchi(id: $id) { modifiedNumericTraits withSetsRarityScore } }","variables":{"id":"` + gotchiId + `"}}`
	resp, err := httpClient.Post("https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-core-matic/api", "application/json", bytes.NewBuffer([]byte(query)))
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	var result struct {
		Data struct {
			Aavegotchi struct {
				ModifiedNumericTraits []int  `json:"modifiedNumericTraits"`
				WithSetsRarityScore   string `json:"withSetsRarityScore"`
			} `json:"aavegotchi"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, err
	}
	if result.Data.Aavegotchi.ModifiedNumericTraits == nil || len(result.Data.Aavegotchi.ModifiedNumericTraits) != 6 {
		return 0, nil
	}
	brs, err := strconv.Atoi(result.Data.Aavegotchi.WithSetsRarityScore)
	if err != nil {
		return 0, err
	}
	return brs, nil
}

func calculateStats(brs int) (hp, atk, ap int, rgn, speed float32) {
	hp = brs
	atk = brs / 10
	ap = brs / 2
	rgn = float32(brs) / 100
	speed = 5 * 32
	return
}

func main() {
	initConfig()
	go initZonesAndWorkers() // Run asynchronously

	go HandleEnemyRespawns()
	go HandlePlayerCleanup()
	go BroadcastLoopPlayerUpdates(playerUpdateChan)
	Zone int	`json:`
	Zone int	`json:`
	go BroadcastLoopEnemyUpdates(enemyUpdateChan)
	go BroadcastLoopAttackUpdates(attackUpdateChan)
	go BroadcastLoopDamageUpdates(damageUpdateChan)

	http.HandleFunc("/ws", wsHandler)
	log.Println("Server starting on :8080")
	listener, err := net.Listen("tcp", ":8080")
	if err != nil {
		log.Fatal("Failed to listen on :8080:", err)
	}
	log.Println("Server listening on :8080")
	err = http.Serve(listener, nil)
	if err != nil {
		log.Fatal("Serve failed:", err)
	}
}
*/
