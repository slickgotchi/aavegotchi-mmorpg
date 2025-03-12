package main

import (
	// "bytes"
	// "encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/http"
	"runtime"

	// "strconv"
	// "sync"
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
	NumEnemiesPerZone = 50
	PlayerMoveSpeed   = 6.22 * 32
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
}

// sent to client during welcome message
type ZoneInfo struct {
	ID         int     `json:"id"`
	TilemapRef string  `json:"tilemapRef"`
	WorldX     float32 `json:"worldX"`
	WorldY     float32 `json:"worldY"`
}

// GameServer holds the overall state
type GameServer struct {
	Zones map[int]*Zone
}



// EnemyUpdate represents enemy data sent to clients
type EnemyUpdate struct {
	EnemyID   string  `json:"enemyId"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	ZoneID    int     `json:"zoneId"`
	Timestamp int64   `json:"timestamp"`

	Type      string `json:"type"`
	Direction int    `json:"direction"`

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
			// enemyType = "hard"
			localX := float32(rand.Intn(ZoneWidthPixels))
			localY := float32(rand.Intn(ZoneHeightPixels))
			if localX < 0.6*float32(ZoneWidthPixels) && localX > 0.4*float32(ZoneWidthPixels) &&
				localY < 0.6*float32(ZoneHeightPixels) && localY > 0.4*float32(ZoneHeightPixels) {
				// we don't want enemies in the centre of the zone, make it
				// a safe area for player to spawn
				continue
			}
			x := zoneConfig.WorldX + localX
			y := zoneConfig.WorldY + localY
			enemy := NewEnemy(zoneConfig.ID, x, y, enemyType)
			gs.Zones[zoneConfig.ID].Enemies[enemy.ID] = enemy
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
	// we store all messages from function sub-logic in this array
	// so they can each be individually batched into main message batch later
	var allPendingMessages []Message

	// Process inbound messages for players
	for len(zone.Inbound) > 0 {
		msg := <-zone.Inbound
		if player, exists := zone.Players[msg.PlayerID]; exists {
			messages := player.HandleInput(msg, gs, zone)
			if messages != nil {
				allPendingMessages = append(allPendingMessages, messages...)
			}
		} else {
			log.Printf("Player %s not found in zone %d", msg.PlayerID, zone.ID)
		}
	}

	// Update player positions
	dt := float32(TickInterval.Seconds())
	for _, player := range zone.Players {
		messages := player.UpdatePlayer(gs, zone, dt)
		if messages != nil {
			allPendingMessages = append(allPendingMessages, messages...)
		}
	}

	// Update enemies and collect ability messages
	for enemyID, enemy := range zone.Enemies {
		messages, keep := enemy.UpdateEnemy(gs, zone)
		if messages != nil {
			allPendingMessages = append(allPendingMessages, messages...)
		}
		if !keep {
			delete(zone.Enemies, enemyID)
		}
	}

	// Prepare and send updates for each player in this zone
	timestamp := time.Now().UnixMilli()
	for _, player := range zone.Players {
		activeZones := gs.getActiveZones(player)

		// add active zones to pending messages
		allPendingMessages = append(allPendingMessages, Message{
			Type: "activeZones",
			Data: activeZones,
		})

		// Collect updates from all 4 active zones
		activeZoneIDs := []int{activeZones.CurrentZoneID, activeZones.XAxisZoneID, activeZones.YAxisZoneID, activeZones.DiagonalZoneID}
		for _, zoneID := range activeZoneIDs {
			if zoneID == 0 {
				continue
			}
			targetZone := gs.Zones[zoneID]
			if targetZone == nil {
				log.Printf("Warning: Zone ID %d not found for player %s", zoneID, player.ID)
				continue
			}

			for _, p := range targetZone.Players {
				allPendingMessages = append(allPendingMessages, Message{
					Type: "playerUpdate",
					Data: PlayerUpdate{
						PlayerID:  p.ID,
						X:         p.X,
						Y:         p.Y,
						ZoneID:    p.ZoneID,
						Timestamp: timestamp,

						Species: p.Species,
						SpeciesID: p.SpeciesID,

						Direction: p.Direction,

						MaxHP: p.Stats.MaxHP,
						HP:    p.Stats.HP,
						MaxAP: p.Stats.MaxAP,
						AP:    p.Stats.AP,

						GameXP:                  p.GameXP,
						GameLevel:               p.GameLevel,
						GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
						GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
					},
				})
			}
			for _, e := range targetZone.Enemies {
				allPendingMessages = append(allPendingMessages, Message{
					Type: "enemyUpdate",
					Data: EnemyUpdate{
						EnemyID:   e.ID,
						X:         e.X,
						Y:         e.Y,
						ZoneID:    e.ZoneID,
						Timestamp: timestamp,
						Type:      e.Type,
						Direction: e.Direction,

						MaxHP: e.Stats.MaxHP,
						HP:    e.Stats.HP,
					},
				})
			}
		}

		// Append each message directly to the batch for processing
		var batch []Message
		for _, pendingMsg := range allPendingMessages {
			// Ensure the message has a valid Type (e.g., "abilityEffect", "telegraphWarning")
			if pendingMsg.Type != "" {
				batch = append(batch, pendingMsg)
			} else {
				log.Printf("Warning: Skipping pending message with empty Type: %v", pendingMsg)
			}
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

	// Create player
	playerID := fmt.Sprintf("player%d", time.Now().UnixNano())
	startX := 1.5 * float32(ZoneWidthPixels)
	startY := 1.5 * float32(ZoneHeightPixels)
	player := NewPlayer(playerID, 0, startX, startY, conn)
	player.ZoneID = gs.calculateZoneID(startX, startY, player)

	initialZone := gs.Zones[player.ZoneID]
	if initialZone == nil {
		log.Printf("Error: Initial zone %d not found for player %s", player.ZoneID, playerID)
		return
	}
	initialZone.Players[playerID] = player
	log.Printf("Player %s spawned in Zone %d (%d,%d)", playerID, initialZone.ID, initialZone.GridX, initialZone.GridY)



	// Read messages from the client
	for {
		var msg Message
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("Error reading from %s: %v", playerID, err)
			break
		}
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

	// Remove player on disconnect
	currentZone := gs.getZoneByPlayerID(playerID)
	if currentZone != nil {
		delete(currentZone.Players, playerID)
	} else {
		delete(initialZone.Players, playerID)
	}
	log.Printf("Player %s disconnected", playerID)
}

// broadcastMessage sends a message to all players except the excluded player
// func (gs *GameServer) broadcastMessage(msg Message, excludePlayerID string) {
// 	for _, zone := range gs.Zones {
// 		for playerID, player := range zone.Players {
// 			if playerID == excludePlayerID {
// 				continue
// 			}
// 			if err := player.Conn.WriteJSON([]Message{msg}); err != nil {
// 				log.Printf("Error broadcasting message to %s: %v", playerID, err)
// 			}
// 		}
// 	}
// }

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
