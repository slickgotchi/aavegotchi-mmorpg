package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
)

// Player represents a player entity
type Player struct {
	ID     string
	ZoneID int
	X, Y   float32 // Tile coordinates
	VX, VY float32 // Tiles per second
	Conn   *websocket.Conn

	Species string
	SpeciesID int

	Direction int // 0 = down, 1 = left, 2 = right, 3 = up

	SpriteHeightPixels float32

	Stats Stats // Shared stats struct

	// Game XP and leveling
	GameXP                  int
	GameLevel               int
	GameXPOnCurrentLevel    int
	GameXPTotalForNextLevel int

	BaseAttackTimerS    float32
	BaseAttackIntervalS float32
}

// PlayerUpdate represents player data sent to clients
type PlayerUpdate struct {
	PlayerID  string  `json:"playerId"`
	X         float32 `json:"x"`
	Y         float32 `json:"y"`
	ZoneID    int     `json:"zoneId"`
	Timestamp int64   `json:"timestamp"`

	// species data
	Species string `json:"species"`
	SpeciesID int `json:"speciesId"`

	Direction int `json:"direction"`

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

// PlayableCharacter represents the structure of a playable character sent from the client
type PlayableCharacter struct {
	Image    string `json:"image"`
	Name     string `json:"name"`
	Species  string `json:"species"`
	ClassType string `json:"classType"`
	SpeciesID int   `json:"speciesId"` // optional field
	TNK      int    `json:"TNK"`
	DPS      int    `json:"DPS"`
	SUP      int    `json:"SUP"`
}


// GetID returns the player's ID
func (p *Player) GetID() string {
	return p.ID
}

// GetX returns the player's X coordinate
func (p *Player) GetX() float32 {
	return p.X
}

// GetY returns the player's Y coordinate
func (p *Player) GetY() float32 {
	return p.Y
}

// GetStats returns the player's stats
func (p *Player) GetStats() *Stats {
	return &p.Stats
}

func (p *Player) GetSpriteHeightPixels() float32 {
	return p.SpriteHeightPixels
}

// NewPlayer creates a new player with default stats
func NewPlayer(id string, zoneID int, x, y float32, conn *websocket.Conn) *Player {
	player := &Player{
		ID:     id,
		ZoneID: zoneID,
		X:      x,
		Y:      y,
		Conn:   conn,

		Species: "Duck",
		SpeciesID: -1,

		Direction: 0,

		SpriteHeightPixels: 64,

		Stats: Stats{
			MaxHP: 300,
			HP:    300,
			MaxAP: 150,
			AP:    150,
			ATK:   10,
		},

		GameXP:                  0,
		GameLevel:               1,
		GameXPOnCurrentLevel:    0,
		GameXPTotalForNextLevel: totalXpRequiredForLevel[2],

		BaseAttackTimerS:    0,
		BaseAttackIntervalS: 1,
	}
	return player
}

// removePlayer cleans up and removes a player from the game state
func (p *Player) removePlayer(gs *GameServer) error {
	if p.Conn == nil {
		log.Printf("Player %s has no active connection to remove", p.ID)
		return nil
	}

	// Get the current zone
	currentZone, exists := gs.Zones[p.ZoneID]
	if !exists {
		log.Printf("Player %s's zone %d not found", p.ID, p.ZoneID)
	} else {
		// Remove the player from the current zone's Players map
		delete(currentZone.Players, p.ID)
		log.Printf("Player %s removed from zone %d", p.ID, p.ZoneID)
	}

	// Offload WebSocket close operation to a goroutine
	go func(conn *websocket.Conn) {
		// Set a shorter write deadline
		if err := conn.SetWriteDeadline(time.Now().Add(500 * time.Millisecond)); err != nil {
			log.Printf("Error setting write deadline for player %s: %v", p.ID, err)
			return
		}

		// Send the WebSocket close message
		err := conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(3000, "Game Over: HP Depleted"))
		if err != nil {
			log.Printf("Error sending close message to player %s: %v", p.ID, err)
			return
		}

		// Wait briefly to allow the close message to be sent (optional, can be reduced or removed)
		time.Sleep(100 * time.Millisecond)

		// Ensure the connection is closed
		conn.Close()
	}(p.Conn)

	// Reset the connection reference immediately
	p.Conn = nil

	return nil
}

// HandleInput processes incoming input messages and updates player velocity or performs other actions
func (p *Player) HandleInput(msg Message, gs *GameServer, zone *Zone) []Message {
	var messages []Message
	
	// Handle different message types
	switch msg.Type {
	case "input":
		// Process input for movement and abilities
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			log.Printf("Invalid input message data for player %s: expected map", p.ID)
			return messages
		}
		
		keys, ok := data["keys"].(map[string]interface{})
		if !ok {
			log.Printf("Invalid input message keys for player %s: expected map", p.ID)
			return messages
		}

		// Reset velocity before updating
		p.VX = 0
		p.VY = 0
		speed := float32(PlayerMoveSpeed)
		
		// Handle movement keys
		if w, ok := keys["W"].(bool); ok && w {
			p.VY = -speed
			p.Direction = 3
		}
		if s, ok := keys["S"].(bool); ok && s {
			p.VY = speed
			p.Direction = 0
		}
		if a, ok := keys["A"].(bool); ok && a {
			p.VX = -speed
			p.Direction = 1
		}
		if d, ok := keys["D"].(bool); ok && d {
			p.VX = speed
			p.Direction = 2
		}
		
		// Handle spacebar for ability use (e.g., HammerSwing)
		if space, ok := keys["SPACE"].(bool); ok && space {
			log.Printf("Player %s pressed SPACE in Zone %d", p.ID, zone.ID)
			// Execute HammerSwing ability
			messages = append(messages, ExecuteAbility(p, "HammerSwing", gs, zone)...)
		}

	case "selectCharacter":
		// Handle selectCharacter message
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			log.Printf("Invalid selectCharacter message data for player %s: expected map", p.ID)
			return messages
		}

		// Convert the data into the PlayableCharacter struct
		var character PlayableCharacter
		characterJSON, err := json.Marshal(data)
		if err != nil {
			log.Printf("Error marshalling character data for player %s: %v", p.ID, err)
			return messages
		}

		// Unmarshal into the PlayableCharacter struct
		err = json.Unmarshal(characterJSON, &character)
		if err != nil {
			log.Printf("Error unmarshalling character data for player %s: %v", p.ID, err)
			return messages
		}

		log.Println(character)

		// assign species and id
		p.Species = character.Species
		p.SpeciesID = character.SpeciesID

		// Prepare welcome message with world zones
		zonesInfo := make([]ZoneInfo, 0, len(gs.Zones))
		for _, z := range gs.Zones {
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

		// Send welcome message
		batch := []Message{
			{Type: "welcome", Data: map[string]interface{}{
				"playerId": p.ID,
				"zones":    zonesInfo,
			}},
		}
		if err := p.Conn.WriteJSON(batch); err != nil {
			log.Printf("Error sending welcome message to %s: %v", p.ID, err)
		}


	default:
		log.Printf("Unhandled message type for player %s: %s", p.ID, msg.Type)
	}

	return messages
}

func SpawnPlayerFromCharacterSelect() {

}


// UpdatePlayer updates the player's position, handles zone switching & general ability handling
func (p *Player) UpdatePlayer(gs *GameServer, zone *Zone, dt float32) []Message {
	var messages []Message

	p.X += p.VX * dt
	p.Y += p.VY * dt
	newZoneID := gs.calculateZoneID(p.X, p.Y, p)

	// Check for null zone or out of bounds
	if newZoneID == 0 || IsEmptyTilemapGridName(gs.Zones[newZoneID].TilemapRef) || p.X < 0 || p.Y < 0 {
		p.X -= p.VX * dt
		p.Y -= p.VY * dt
		return messages
	}

	if newZoneID != p.ZoneID {
		var lastZoneUpdates []PlayerUpdate
		lastZoneUpdates = append(lastZoneUpdates, PlayerUpdate{
			PlayerID:  p.ID,
			X:         p.X,
			Y:         p.Y,
			ZoneID:    p.ZoneID,
			Timestamp: time.Now().UnixMilli(),

			MaxHP: p.Stats.MaxHP,
			HP:    p.Stats.HP,
			MaxAP: p.Stats.MaxAP,
			AP:    p.Stats.AP,

			GameXP:                  p.GameXP,
			GameLevel:               p.GameLevel,
			GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
			GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
		})

		batch := []Message{
			{Type: "playerUpdates", Data: lastZoneUpdates},
		}
		if err := p.Conn.WriteJSON(batch); err != nil {
			log.Printf("Error sending batch to %s: %v", p.ID, err)
		}

		gs.switchZone(p, zone, newZoneID)
	}

	// activate base HammerSwing ability if enemies within range
	p.BaseAttackTimerS -= dt
	if p.BaseAttackTimerS < 0 {
		p.BaseAttackTimerS = p.BaseAttackIntervalS

		// check enemeies on screen
		if isEnemiesOnScreen(p, zone) {
			// log.Println("enemies on screen")
			messages = append(messages, ExecuteAbility(p, "HammerSwing", gs, zone)...)
		}

	}

	// check for player death
	if p.Stats.HP <= 0 {
		if err := p.removePlayer(gs); err != nil {
			log.Printf("Error removing player %s: %v", p.ID, err)
		}
	}

	return messages
}

// enemiesOnscreen checks if any enemies are within the player's viewport
func isEnemiesOnScreen(p *Player, zone *Zone) bool {
	// Assume a viewport of 800x600 pixels (adjust based on client viewport)
	const viewportWidth = 1280
	const viewportHeight = 800
	halfWidth := float32(viewportWidth / 2)
	halfHeight := float32(viewportHeight / 2)

	// Viewport boundaries centered on player
	minX := p.X - halfWidth
	maxX := p.X + halfWidth
	minY := p.Y - halfHeight
	maxY := p.Y + halfHeight

	for _, enemy := range zone.Enemies {
		if enemy.X >= minX && enemy.X <= maxX && enemy.Y >= minY && enemy.Y <= maxY {
			return true // At least one enemy is onscreen
		}
	}
	return false // No enemies onscreen
}

// fetchGotchiStats fetches stats for a player based on their gotchi ID
func fetchGotchiStats(gotchiId string) (int, error) {
	query := `{"query":"query($id: ID!) { aavegotchi(id: $id) { modifiedNumericTraits withSetsRarityScore } }","variables":{"id":"` + gotchiId + `"}}`
	resp, err := http.Post("https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-core-matic/api", "application/json", bytes.NewBuffer([]byte(query)))
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

// calculatePlayerStats calculates player stats based on BRS
func calculatePlayerStats(brs int) (hp, atk, ap int, rgn, speed float32) {
	hp = brs
	atk = brs / 10
	ap = brs / 2
	rgn = float32(brs) / 100
	speed = 5 * 32
	return
}

// addPlayerXP adds XP to a player and handles leveling up
func addPlayerXP(p *Player, amount int) {
	p.GameXP += amount

	totalXpRequiredForCurrentLevel := totalXpRequiredForLevel[p.GameLevel]
	totalXpRequiredForNextLevel := totalXpRequiredForLevel[p.GameLevel+1]
	p.GameXPOnCurrentLevel = p.GameXP - totalXpRequiredForCurrentLevel
	p.GameXPTotalForNextLevel = totalXpRequiredForNextLevel - totalXpRequiredForCurrentLevel

	for p.GameXP >= totalXpRequiredForLevel[p.GameLevel+1] && p.GameLevel < MAX_LEVEL {
		p.GameLevel++
		p.Stats.ATK = int(float64(p.Stats.ATK) * 1.1)
		totalXpRequiredForCurrentLevel = totalXpRequiredForLevel[p.GameLevel]
		totalXpRequiredForNextLevel = totalXpRequiredForLevel[p.GameLevel+1]
		p.GameXPOnCurrentLevel = p.GameXP - totalXpRequiredForCurrentLevel
		p.GameXPTotalForNextLevel = totalXpRequiredForNextLevel - totalXpRequiredForCurrentLevel

		levelUpMsg := Message{
			Type: "levelUp",
			Data: struct {
				NewLevel                int `json:"newLevel"`
				NewATK                  int `json:"newATK"`
				GameXPOnCurrentLevel    int `json:"gameXpOnCurrentLevel"`
				GameXPTotalForNextLevel int `json:"gameXpTotalForNextLevel"`
			}{
				NewLevel:                p.GameLevel,
				NewATK:                  p.Stats.ATK,
				GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
				GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
			},
		}
		if err := p.Conn.WriteJSON(levelUpMsg); err != nil {
			log.Println("Failed to send level-up message to", p.ID, ":", err)
		}
	}
}
