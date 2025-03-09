package main

/*
package main

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	MAX_LEVEL         = 50
	BASE_XP_PER_LEVEL = 100
	XP_GROWTH_FACTOR  = 1.5
)

var totalXpRequiredForLevel = make([]int, MAX_LEVEL+1)

func init() {
	for level := 1; level <= MAX_LEVEL; level++ {
		totalXpRequiredForLevel[level] = int(float64(BASE_XP_PER_LEVEL) * math.Pow(float64(level-1), XP_GROWTH_FACTOR))
	}
}

type Player struct {
	ID                      string
	X                       float32
	Y                       float32
	HP                      int
	MaxHP                   int
	ATK                     int
	AP                      int
	MaxAP                   int
	RGN                     float32
	Speed                   float32
	Conn                    *websocket.Conn
	GotchiID                int
	IsPlaying               bool
	VelocityX               float32
	VelocityY               float32
	Direction               int
	Mu                      sync.RWMutex
	AttackTimerMs           float32
	AttackIntervalMs        float32
	AttackRadius            float32
	GameXP                  int
	GameLevel               int
	GameXPOnCurrentLevel    int
	GameXPTotalForNextLevel int
	OnchainXP               int
	OnchainLevel            int
	LastUpdate              int64 // For velocity tracking
	ZoneID                  int   // Track player's zone
	ConnMu                  sync.Mutex
}

func NewPlayer(conn *websocket.Conn, remoteAddr string) *Player {
	defer func() {
		if r := recover(); r != nil {
			log.Println("Recovered from panic:", r)
		}
	}()

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
		GameXP:           0,
		GameLevel:        1,
		LastUpdate:       time.Now().UnixMilli(),
		ZoneID:           0, // Default to zone 0; expand later
	}
	log.Println("try add xp")
	addXP(p, 0)

	log.Println("Locking zone", p.ZoneID)
	zones[p.ZoneID].Mu.Lock()
	zones[p.ZoneID].Players[remoteAddr] = p
	zones[p.ZoneID].Mu.Unlock()

	log.Println("return player")
	return p
}

func HandlePlayerConnection(w http.ResponseWriter, r *http.Request) {
	log.Println("try upgrade connection")
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}

	log.Println("make a new player")
	p := NewPlayer(conn, r.RemoteAddr)
	welcomeMsg := Message{
		Type: "welcome",
		Data: json.RawMessage(`{"id":"` + p.ID + `"}`), // Send raw JSON
	}
	p.ConnMu.Lock()
	if err := conn.WriteJSON(welcomeMsg); err != nil {
		log.Println("Failed to send welcome to", p.ID, ":", err)
	}
	p.ConnMu.Unlock()

	log.Println("Player connection established:", p.ID) // Add this log

	go func(p *Player) {
		defer func() {
			eventChan <- Event{Type: "disconnect", ZoneID: p.ZoneID, PlayerID: p.ID, Timestamp: time.Now().UnixMilli()}
			p.Conn.Close()
			log.Println("Client disconnected:", p.ID)
			broadcastMessage(Message{
				Type: "playerDisconnected",
				Data: mustMarshal(map[string]interface{}{"id": p.ID}),
			}, "")
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
			eventChan <- Event{
				Type:      m.Type,
				ZoneID:    p.ZoneID,
				PlayerID:  p.ID,
				Data:      m.Data,
				Timestamp: time.Now().UnixMilli(),
			}
			log.Println("Received message from", p.ID, "Type:", m.Type) // Add this log
		}
	}(p)

	<-make(chan struct{})
}

func HandlePlayerCleanup() {
	for id := range cleanupChan {
		for _, zone := range zones {
			zone.Mu.Lock()
			if _, exists := zone.Players[id]; exists {
				delete(zone.Players, id)
			}
			zone.Mu.Unlock()
		}
	}
}

func handlePlayerMessageJoin(p *Player, msg Message) {
	var joinData struct {
		GotchiID int `json:"gotchiId"`
	}
	if err := json.Unmarshal(msg.Data, &joinData); err != nil || joinData.GotchiID == 0 {
		log.Println("Invalid join data from", p.ID, ":", err)
		return
	}

	p.Mu.Lock()
	p.GotchiID = joinData.GotchiID
	p.Mu.Unlock()

	log.Println("Player joined with GotchiID:", p.GotchiID)

	brs, err := fetchGotchiStats(strconv.Itoa(joinData.GotchiID))
	if err != nil {
		log.Println("Failed to fetch stats for", p.ID, ":", err)
		return
	}

	p.Mu.Lock()
	p.HP, p.ATK, p.AP, p.RGN, p.Speed = calculateStats(brs)
	p.MaxHP, p.MaxAP = p.HP, p.AP
	p.IsPlaying = true
	p.X = float32(MAP_WIDTH_TILES*PIXELS_PER_TILE) / 2
	p.Y = float32(MAP_HEIGHT_TILES*PIXELS_PER_TILE) / 2
	p.Direction = 0
	p.Mu.Unlock()
}

func handlePlayerMessageInput(p *Player, data json.RawMessage) {
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
	if err := json.Unmarshal(data, &inputData); err != nil {
		log.Println("Failed to unmarshal input for", p.ID, ":", err)
		return
	}

	p.Mu.Lock()
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
		p.LastUpdate = time.Now().UnixMilli()
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
	} else {
		p.VelocityX, p.VelocityY = 0, 0
	}
	p.Mu.Unlock()

	if inputData.Keys.SPACE {
		eventChan <- Event{
			Type:      "attack",
			ZoneID:    p.ZoneID,
			PlayerID:  p.ID,
			Timestamp: time.Now().UnixMilli(),
		}
	}
	log.Println("Processed input for", p.ID, "VelocityX:", p.VelocityX, "VelocityY:", p.VelocityY) // Add this log
}

func addXP(p *Player, amount int) {
	p.Mu.Lock()
	defer p.Mu.Unlock()
	p.GameXP += amount

	totalXpRequiredForCurrentLevel := totalXpRequiredForLevel[p.GameLevel]
	totalXpRequiredForNextLevel := totalXpRequiredForLevel[p.GameLevel+1]
	p.GameXPOnCurrentLevel = p.GameXP - totalXpRequiredForCurrentLevel
	p.GameXPTotalForNextLevel = totalXpRequiredForNextLevel - totalXpRequiredForCurrentLevel

	for p.GameXP >= totalXpRequiredForLevel[p.GameLevel+1] && p.GameLevel < MAX_LEVEL {
		p.GameLevel++
		p.ATK = int(float64(p.ATK) * 1.1)
		totalXpRequiredForCurrentLevel = totalXpRequiredForLevel[p.GameLevel]
		totalXpRequiredForNextLevel = totalXpRequiredForLevel[p.GameLevel+1]
		p.GameXPOnCurrentLevel = p.GameXP - totalXpRequiredForCurrentLevel
		p.GameXPTotalForNextLevel = totalXpRequiredForNextLevel - totalXpRequiredForCurrentLevel

		levelUpMsg := Message{
			Type: "levelUp",
			Data: mustMarshal(struct {
				NewLevel                int `json:"newLevel"`
				NewATK                  int `json:"newATK"`
				GameXPOnCurrentLevel    int `json:"gameXpOnCurrentLevel"`
				GameXPTotalForNextLevel int `json:"gameXpTotalForNextLevel"`
			}{
				NewLevel:                p.GameLevel,
				NewATK:                  p.ATK,
				GameXPOnCurrentLevel:    p.GameXPOnCurrentLevel,
				GameXPTotalForNextLevel: p.GameXPTotalForNextLevel,
			}),
		}
		p.ConnMu.Lock() // Lock WebSocket write
		if err := p.Conn.WriteJSON(levelUpMsg); err != nil {
			log.Println("Failed to send level-up message to", p.ID, ":", err)
		}
		p.ConnMu.Unlock() // Unlock WebSocket write
	}
}
*/
