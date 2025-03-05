package main

import (
	"log"
	"math"
	"net/http"
	"sync"

	// "time"
	"encoding/json"
	"strconv"

	"github.com/gorilla/websocket"
)

const (
	MAX_LEVEL         = 50 // Max level for the game
	BASE_XP_PER_LEVEL = 100
	XP_GROWTH_FACTOR  = 1.5 // Exponential growth factor for XP requirements
)

var totalXpRequiredForLevel = make([]int, MAX_LEVEL+1) // XP needed to reach each level (index 0 unused, 1 to 50)

// Initialize XP requirements in init()
func init() {
	for level := 1; level <= MAX_LEVEL; level++ {
		totalXpRequiredForLevel[level] = int(float64(BASE_XP_PER_LEVEL) * math.Pow(float64(level-1), XP_GROWTH_FACTOR))
	}
	// Example XP requirements (adjust as needed):
	// Level 2: 100, Level 3: 225, Level 3: 405, ..., Level 50: ~1,000,000
}

// Player struct
type Player struct {
	ID        string
	X         float32
	Y         float32
	HP        int
	MaxHP     int
	ATK       int
	AP        int
	MaxAP     int
	RGN       float32
	Speed     float32
	Conn      *websocket.Conn
	GotchiID  int
	IsPlaying bool
	VelocityX float32
	VelocityY float32
	Direction int

	AttackTimerMs    float32
	AttackIntervalMs float32
	AttackRadius     float32

	GameXP       int // our in game xp
	GameLevel    int // our in game level
	OnchainXP    int // aavegotchi XP onchain
	OnchainLevel int // aavegotchi level onchain

	GameXPOnCurrentLevel    int
	GameXPTotalForNextLevel int
}

// PlayerUpdate struct
type PlayerUpdate struct {
	ID                      string  `json:"id"`
	X                       float32 `json:"x"`
	Y                       float32 `json:"y"`
	HP                      int     `json:"hp"`
	MaxHP                   int     `json:"maxHp"`
	AP                      int     `json:"ap"`
	MaxAP                   int     `json:"maxAp"`
	GotchiID                int     `json:"gotchiId"`
	Timestamp               int64   `json:"timestamp"`
	Direction               int     `json:"direction"`
	GameXP                  int     `json:"gameXp"`
	GameLevel               int     `json:"gameLevel"`
	GameXPOnCurrentLevel    int     `json:"gameXpOnCurrentLevel"`
	GameXPTotalForNextLevel int     `json:"gameXpTotalForNextLevel"`
}

// Global player variables
var (
	players          = make(map[string]*Player)
	playerUpdateChan = make(chan []PlayerUpdate, 1000)
	mu               sync.RWMutex
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return r.Header.Get("Origin") == "http://localhost:5173"
	},
}

// NewPlayer creates a new player instance
func NewPlayer(conn *websocket.Conn, remoteAddr string) *Player {
	p := &Player{
		ID:               remoteAddr,
		X:                float32(MAP_WIDTH_TILES*PIXELS_PER_TILE) / 2,
		Y:                float32(MAP_HEIGHT_TILES*PIXELS_PER_TILE) / 2,
		HP:               300,
		MaxHP:            300,
		ATK:              45,
		AP:               200,
		MaxAP:            200,
		RGN:              1.0,
		Speed:            5 * 32,
		Conn:             conn,
		GotchiID:         0,
		IsPlaying:        false,
		VelocityX:        0,
		VelocityY:        0,
		Direction:        0,
		AttackTimerMs:    0,
		AttackIntervalMs: 1000,
		AttackRadius:     4 * 32,

		GameXP:    0,
		GameLevel: 1,
	}

	// add 0 xp to trigger next level calcs etc
	addXP(p, 0)

	mu.Lock()
	players[remoteAddr] = p
	mu.Unlock()
	return p
}

// HandlePlayerConnection manages WebSocket connection and messages
func HandlePlayerConnection(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}

	p := NewPlayer(conn, r.RemoteAddr)

	welcomeMsg := Message{
		Type: "welcome",
		Data: mustMarshal(struct {
			ID string `json:"id"`
		}{ID: p.ID}),
	}
	if err := conn.WriteJSON(welcomeMsg); err != nil {
		log.Println("Failed to send welcome to", p.ID, ":", err)
	}

	log.Println("Player connection established:", r.RemoteAddr)

	go func(p *Player) {
		defer func() {
			mu.Lock()
			delete(players, p.ID)
			mu.Unlock()
			p.Conn.Close()
			log.Println("Client disconnected:", p.ID)
			disconnectMsg := Message{
				Type: "playerDisconnected",
				Data: mustMarshal(map[string]interface{}{
					"id": p.ID,
				}),
			}
			broadcastMessage(disconnectMsg, "")
		}()

		for {
			_, msg, err := p.Conn.ReadMessage()
			if err != nil {
				log.Println("Read error for", p.ID, ":", err)
				return
			}

			var m Message
			if err := json.Unmarshal(msg, &m); err != nil {
				log.Println("Failed to unmarshal message from", p.ID, ":", err)
				continue
			}

			switch m.Type {
			case "join":
				handlePlayerMessageJoin(p, m)
			case "input":
				handlePlayerMessageInput(p, m)
			}
		}
	}(p)

	<-make(chan struct{})
}

// Player message handlers
func handlePlayerMessageJoin(p *Player, msg Message) {
	var joinData struct {
		GotchiID int `json:"gotchiId"`
	}
	if err := json.Unmarshal(msg.Data, &joinData); err != nil || joinData.GotchiID == 0 {
		log.Println("Invalid join data from", p.ID, ":", err)
		return
	}

	mu.Lock()
	p.GotchiID = joinData.GotchiID
	mu.Unlock()

	log.Println("Player joined with GotchiID:", p.GotchiID)

	brs, err := fetchGotchiStats(strconv.Itoa(joinData.GotchiID))
	if err != nil {
		log.Println("Failed to fetch stats for", p.ID, ":", err)
		return
	}

	mu.Lock()
	p.HP, p.ATK, p.AP, p.RGN, p.Speed = calculateStats(brs)
	p.MaxHP, p.MaxAP = p.HP, p.AP
	p.IsPlaying = true
	p.X = float32(MAP_WIDTH_TILES*PIXELS_PER_TILE) / 2
	p.Y = float32(MAP_HEIGHT_TILES*PIXELS_PER_TILE) / 2
	p.Direction = 0
	mu.Unlock()
}

func handlePlayerMessageInput(p *Player, msg Message) {
	var inputData struct {
		ID   string `json:"id"`
		Keys struct {
			W     bool `json:"W"`
			A     bool `json:"A"`
			S     bool `json:"S"`
			D     bool `json:"D"`
			SPACE bool `json:"SPACE"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(msg.Data, &inputData); err != nil {
		log.Println("Failed to unmarshal input for", p.ID, ":", err)
		return
	}

	mu.Lock()
	vx, vy := float32(0), float32(0)
	if inputData.Keys.W {
		vy -= p.Speed
	}
	if inputData.Keys.S {
		vy += p.Speed
	}
	if inputData.Keys.A {
		vx -= p.Speed
	}
	if inputData.Keys.D {
		vx += p.Speed
	}
	if vx != 0 || vy != 0 {
		norm := float32(math.Sqrt(float64(vx*vx + vy*vy)))
		p.VelocityX = (vx / norm) * p.Speed
		p.VelocityY = (vy / norm) * p.Speed
		if p.VelocityY < 0 {
			p.Direction = 3
		}
		if p.VelocityY > 0 {
			p.Direction = 0
		}
		if p.VelocityX > 0 {
			p.Direction = 2
		}
		if p.VelocityX < 0 {
			p.Direction = 1
		}
	}
	if math.Abs(float64(vx)) < 0.01 && math.Abs(float64(vy)) < 0.01 {
		p.VelocityX = 0
		p.VelocityY = 0
	}
	mu.Unlock()
}

// UpdatePlayers handles player movement and state updates
func UpdatePlayers(tickIntervalMs int, timestamp int64) {
	mu.RLock()
	var playerUpdates []PlayerUpdate
	for _, p := range players {
		p.X += p.VelocityX * float32(tickIntervalMs) * 0.001
		p.Y += p.VelocityY * float32(tickIntervalMs) * 0.001

		playerUpdates = append(playerUpdates, PlayerUpdate{
			ID:                      p.ID,
			X:                       p.X,
			Y:                       p.Y,
			HP:                      p.HP,
			MaxHP:                   p.MaxHP,
			AP:                      p.AP,
			MaxAP:                   p.MaxAP,
			GotchiID:                p.GotchiID,
			Timestamp:               timestamp,
			Direction:               p.Direction,
			GameXP:                  p.GameXP,
			GameLevel:               p.GameLevel,
			GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
			GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
		})
	}
	mu.RUnlock()

	if len(playerUpdates) > 0 {
		select {
		case playerUpdateChan <- playerUpdates:
		default:
			log.Println("GameLoop updateChan full, skipping broadcast")
		}
	}
}

// HandlePlayerAttacks manages player attack logic
func HandlePlayerAttacks(tickIntervalMs int, timestamp int64) {
	var attackUpdates []AttackUpdate
	var damageUpdates []DamageUpdate

	for _, p := range players {
		mu.Lock()
		playerMinX := p.X - 40*0.5*32
		playerMinY := p.Y - 25*0.5*32
		playerMaxX := p.X + 40*0.5*32
		playerMaxY := p.Y + 25*0.5*32

		isEnemiesOnScreen := false
		for _, e := range Enemies {
			if e.X > playerMinX && e.X < playerMaxX && e.Y > playerMinY && e.Y < playerMaxY {
				isEnemiesOnScreen = true
				break
			}
		}

		if isEnemiesOnScreen {
			p.AttackTimerMs -= float32(tickIntervalMs)
			if p.AttackTimerMs < 0 {
				p.AttackTimerMs += p.AttackIntervalMs
				hitEnemies := make([]string, 0)

				for _, e := range Enemies {
					distSq := (e.X-p.X)*(e.X-p.X) + (e.Y-p.Y)*(e.Y-p.Y)
					if distSq < p.AttackRadius*p.AttackRadius {
						e.HP -= p.ATK
						damageUpdates = append(damageUpdates, DamageUpdate{
							ID:     e.ID,
							Type:   "enemy",
							Damage: p.ATK,
						})
						hitEnemies = append(hitEnemies, e.ID)

						// Award XP when enemy HP reaches 0
						if e.HP <= 0 {
							xpDrop := getXPDropForEnemy(e.Type) // Function defined below
							addXP(p, xpDrop)
						}
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
		}
		mu.Unlock()
	}

	if len(attackUpdates) > 0 {
		attackUpdateChan <- attackUpdates
	}
	if len(damageUpdates) > 0 {
		damageUpdateChan <- damageUpdates
	}
}

// getXPDropForEnemy returns XP based on enemy type
func getXPDropForEnemy(enemyType string) int {
	switch enemyType {
	case "easy":
		return 10
	case "medium":
		return 20
	case "hard":
		return 30
	default:
		return 5 // Default for unknown types
	}
}

// addXP adds XP to a player, handles level-ups, and updates stats
func addXP(p *Player, amount int) {
	p.GameXP += amount

	// Calculate current progress
	totalXpRequiredForCurrentLevel := totalXpRequiredForLevel[p.GameLevel]
	totalXpRequiredForNextLevel := totalXpRequiredForLevel[p.GameLevel+1]
	p.GameXPOnCurrentLevel = p.GameXP - totalXpRequiredForCurrentLevel
	p.GameXPTotalForNextLevel = totalXpRequiredForNextLevel - totalXpRequiredForCurrentLevel

	// Check for level-up
	for p.GameXP >= totalXpRequiredForLevel[p.GameLevel+1] && p.GameLevel < MAX_LEVEL {
		p.GameLevel++
		// Increase ATK by 10% on level-up
		p.ATK = int(float64(p.ATK) * 1.1) // Round down to integer
		totalXpRequiredForCurrentLevel = totalXpRequiredForLevel[p.GameLevel]
		totalXpRequiredForNextLevel = totalXpRequiredForLevel[p.GameLevel+1]
		p.GameXPOnCurrentLevel = p.GameXP - totalXpRequiredForCurrentLevel
		p.GameXPTotalForNextLevel = totalXpRequiredForNextLevel - totalXpRequiredForCurrentLevel

		// Send level-up message to the player
		levelUpMsg := Message{
			Type: "levelUp",
			Data: mustMarshal(struct {
				NewLevel                int `json:"newLevel"`
				NewATK                  int `json:"newATK"`
				GameXPOnCurrentLevel    int `json:"gamexponcurrentlevel"`
				GameXPTotalForNextLevel int `json:"gamexptotalfornextlevel"`
			}{
				NewLevel:                p.GameLevel,
				NewATK:                  p.ATK,
				GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
				GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
			}),
		}
		if err := p.Conn.WriteJSON(levelUpMsg); err != nil {
			log.Println("Failed to send level-up message to", p.ID, ":", err)
		} else {
			log.Println("Sent level-up message to", p.ID, "for level", p.GameLevel)
		}
	}
}
