package main

/*
package main

import (
	"log"
	"math"
	"math/rand"
	"sync"
	"time"
)

type EnemyProfile struct {
	HP              int
	MaxHP           int
	RoamSpeed       float32
	AggroRadius     float32
	TelegraphRadius float32
	AttackRadius    float32
	AttackDamage    int
	XPDrop          int
}

var EnemyProfiles = map[string]EnemyProfile{
	"easy": {
		HP:              50,
		MaxHP:           50,
		RoamSpeed:       1 * 32,
		AggroRadius:     4 * 32,
		TelegraphRadius: 1 * 32,
		AttackRadius:    1 * 32,
		AttackDamage:    5,
		XPDrop:          10,
	},
	"medium": {
		HP:              100,
		MaxHP:           100,
		RoamSpeed:       1.5 * 32,
		AggroRadius:     8 * 32,
		TelegraphRadius: 1.5 * 32,
		AttackRadius:    1.5 * 32,
		AttackDamage:    10,
		XPDrop:          20,
	},
	"hard": {
		HP:              150,
		MaxHP:           150,
		RoamSpeed:       2 * 32,
		AggroRadius:     12 * 32,
		TelegraphRadius: 2 * 32,
		AttackRadius:    2 * 32,
		AttackDamage:    15,
		XPDrop:          30,
	},
}

const (
	StateSpawn     = "Spawn"
	StateRoam      = "Roam"
	StatePursue    = "Pursue"
	StateTelegraph = "Telegraph"
	StateAttack    = "Attack"
	StateCooldown  = "Cooldown"
	StateDeath     = "Death"
)

type Enemy struct {
	ID               string
	X                float32
	Y                float32
	Type             string
	LayerName        string
	HP               int
	MaxHP            int
	RespawnTime      int64
	IsAlive          bool
	VelocityX        float32
	VelocityY        float32
	Direction        int
	XPDrop           int
	KillerID         string
	IsDeathProcessed bool
	Mu               sync.RWMutex
	State            string
	StateTimer       float32
	SpawnPointX      float32
	SpawnPointY      float32
	RoamSpeed        float32
	AggroRadius      float32
	TelegraphRadius  float32
	AttackRadius     float32
	AttackDamage     int
	LastUpdate       int64 // For velocity tracking
	ZoneID           int   // Track enemy's zone
}

func NewEnemy(id, enemyType, layerName string, x, y float32) *Enemy {
	zoneID := 0 // Default to zone 0; adjust later
	profile, ok := EnemyProfiles[enemyType]
	if !ok {
		profile = EnemyProfiles["medium"]
	}
	e := &Enemy{
		ID:              id,
		X:               x,
		Y:               y,
		Type:            enemyType,
		LayerName:       layerName,
		HP:              profile.HP,
		MaxHP:           profile.MaxHP,
		IsAlive:         true,
		Direction:       0,
		State:           StateSpawn,
		StateTimer:      1.0,
		SpawnPointX:     x,
		SpawnPointY:     y,
		RoamSpeed:       profile.RoamSpeed,
		AggroRadius:     profile.AggroRadius,
		TelegraphRadius: profile.TelegraphRadius,
		AttackRadius:    profile.AttackRadius,
		AttackDamage:    profile.AttackDamage,
		XPDrop:          profile.XPDrop,
		KillerID:        "",
		LastUpdate:      time.Now().UnixMilli(),
		ZoneID:          zoneID,
	}
	zones[zoneID].Mu.Lock()
	zones[zoneID].Enemies[id] = e
	zones[zoneID].Mu.Unlock()
	return e
}

func OnDeath(e *Enemy, killerID string) {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	if e.IsDeathProcessed {
		return
	}
	e.IsDeathProcessed = true
	e.KillerID = killerID
	e.State = StateDeath
	e.StateTimer = 1.0
	e.VelocityX = 0
	e.VelocityY = 0

	if killerID != "" {
		for _, zone := range zones {
			zone.Mu.RLock()
			if killer, exists := zone.Players[killerID]; exists {
				addXP(killer, e.XPDrop)
				log.Println("Awarded", e.XPDrop, "XP to player", killerID, "for killing enemy", e.ID)
			}
			zone.Mu.RUnlock()
		}
	}
}

func updateRoamState(e *Enemy, deltaTime float32) {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	if rand.Float32() < 0.05 {
		angle := rand.Float32() * 2 * math.Pi
		e.VelocityX = e.RoamSpeed * float32(math.Cos(float64(angle)))
		e.VelocityY = e.RoamSpeed * float32(math.Sin(float64(angle)))
	}
	maxDistance := float32(5 * 32)
	dx := e.X - e.SpawnPointX
	dy := e.Y - e.SpawnPointY
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
	if dist > maxDistance {
		angle := float32(math.Atan2(float64(-dy), float64(-dx)))
		e.VelocityX = e.RoamSpeed * float32(math.Cos(float64(angle)))
		e.VelocityY = e.RoamSpeed * float32(math.Sin(float64(angle)))
	}
	antiClump(e, 100)
}

func updatePursueState(e *Enemy, target *Player, deltaTime float32) {
	e.Mu.Lock()
	defer e.Mu.Unlock()
	if target == nil {
		e.VelocityX = 0
		e.VelocityY = 0
		return
	}
	dx := target.X - e.X
	dy := target.Y - e.Y
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
	if dist > 0 {
		e.VelocityX = (dx / dist) * e.RoamSpeed * 1.5
		e.VelocityY = (dy / dist) * e.RoamSpeed * 1.5
	}
	antiClump(e, 100)
}

func findNearestPlayer(e *Enemy) *Player {
	zone := zones[e.ZoneID]
	zone.Mu.RLock()
	defer zone.Mu.RUnlock()
	var nearest *Player
	minDist := float32(math.MaxFloat32)
	for _, p := range zone.Players {
		dist := distanceTo(e, p)
		if dist < minDist {
			minDist = dist
			nearest = p
		}
	}
	return nearest
}

func distanceTo(e *Enemy, p *Player) float32 {
	dx := e.X - p.X
	dy := e.Y - p.Y
	return float32(math.Sqrt(float64(dx*dx + dy*dy)))
}

func antiClump(e *Enemy, strength float32) {
	const minSeparation = 64
	const checkRadius = 128
	zone := zones[e.ZoneID]
	zone.Mu.RLock()
	defer zone.Mu.RUnlock()

	gridSize := 128
	gridX := int(e.X / float32(gridSize))
	gridY := int(e.Y / float32(gridSize))

	e.Mu.Lock()
	defer e.Mu.Unlock()
	for _, other := range zone.Enemies {
		if other == e || !other.IsAlive {
			continue
		}
		otherGridX := int(other.X / float32(gridSize))
		otherGridY := int(other.Y / float32(gridSize))
		if (otherGridX < gridX-1 || otherGridX > gridX+1) || (otherGridY < gridY-1 || otherGridY > gridY+1) {
			dx := e.X - other.X
			dy := e.Y - other.Y
			roughDist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
			if roughDist > checkRadius {
				continue
			}
		}
		dx := e.X - other.X
		dy := e.Y - other.Y
		dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
		if dist < minSeparation && dist > 0 {
			force := strength * (minSeparation - dist) / minSeparation
			e.VelocityX += (dx / dist) * force
			e.VelocityY += (dy / dist) * force
		}
	}
	maxSpeed := e.RoamSpeed * 1.5
	totalSpeed := float32(math.Sqrt(float64(e.VelocityX*e.VelocityX + e.VelocityY*e.VelocityY)))
	if totalSpeed > maxSpeed {
		e.VelocityX = (e.VelocityX / totalSpeed) * maxSpeed
		e.VelocityY = (e.VelocityY / totalSpeed) * maxSpeed
	}
}
*/
