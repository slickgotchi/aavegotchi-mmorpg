package main

import (
	// "log"
	"math"
	"math/rand"
	"sync"
	// "time"
)

const (
	// Enemy states
	StateSpawn     = "Spawn"
	StateRoam      = "Roam"
	StatePursue    = "Pursue"
	StateTelegraph = "Telegraph"
	StateAttack    = "Attack"
	StateCooldown  = "Cooldown"
	StateDeath     = "Death"
)

// Extended Enemy struct with state machine properties
type Enemy struct {
	ID          string
	X           float32
	Y           float32
	Type        string
	LayerName   string
	HP          int
	MaxHP       int
	RespawnTime int64
	IsAlive     bool
	VelocityX   float32
	VelocityY   float32
	Direction   int

	// State machine properties
	State           string
	StateTimer      float32 // Time remaining in current state (seconds)
	SpawnPointX     float32 // Original spawn location
	SpawnPointY     float32
	RoamSpeed       float32
	AggroRadius     float32
	TelegraphRadius float32
	AttackRadius    float32
	AttackDamage    int
}

// Global enemies map (moved from main.go)
var Enemies = make(map[string]*Enemy)
var enemyMu sync.RWMutex

// Initialize a new enemy
func NewEnemy(id, enemyType, layerName string, x, y float32) *Enemy {
	e := &Enemy{
		ID:              id,
		X:               x,
		Y:               y,
		Type:            enemyType,
		LayerName:       layerName,
		HP:              100,
		MaxHP:           100,
		IsAlive:         true,
		Direction:       0,
		State:           StateSpawn,
		StateTimer:      1.0, // 1 seconds spawn duration
		SpawnPointX:     x,
		SpawnPointY:     y,
		RoamSpeed:       1.5 * 32, // 2 tiles per second
		AggroRadius:     8 * 32,   // 8 tiles
		TelegraphRadius: 2.5 * 32, // 2 tiles
		AttackRadius:    3 * 32,   // 1 tile
		AttackDamage:    10,
	}
	enemyMu.Lock()
	Enemies[id] = e
	enemyMu.Unlock()
	return e
}

// UpdateEnemies handles the enemy state machine and movement
func UpdateEnemies(tickIntervalMs int, timestamp int64) {
	enemyMu.Lock()
	defer enemyMu.Unlock()

	var enemyUpdates []EnemyUpdate
	var damageUpdates []DamageUpdate
	var attackUpdates []AttackUpdate

	deltaTime := float32(tickIntervalMs) / 1000.0 // Convert to seconds

	for _, e := range Enemies {
		if !e.IsAlive {
			continue
		}

		e.StateTimer -= deltaTime
		nearestPlayer := findNearestPlayer(e)

		switch e.State {
		case StateSpawn:
			if e.StateTimer <= 0 {
				e.State = StateRoam
				e.StateTimer = 0
			}

		case StateRoam:
			updateRoamState(e, deltaTime)
			if nearestPlayer != nil && distanceTo(e, nearestPlayer) < e.AggroRadius {
				e.State = StatePursue
			}

		case StatePursue:
			updatePursueState(e, nearestPlayer, deltaTime)
			if nearestPlayer == nil || distanceTo(e, nearestPlayer) > e.AggroRadius {
				e.State = StateRoam
			} else if distanceTo(e, nearestPlayer) < e.TelegraphRadius {
				e.State = StateTelegraph
				e.StateTimer = 0.5 // 0.5 second telegraph
				e.VelocityX = 0
				e.VelocityY = 0
			}

		case StateTelegraph:
			if e.StateTimer <= 0 {
				e.State = StateAttack
				e.StateTimer = 0.5 // 0.5 second attack duration
			}

		case StateAttack:
			if e.StateTimer <= 0 {
				// log an attack
				attackUpdates = append(attackUpdates, AttackUpdate{
					AttackerID: e.ID,
					HitIDs:     nil,
					Type:       "enemyAttack",
					Radius:     e.AttackRadius,
					X:          e.X,
					Y:          e.Y,
				})
				// log.Println("attack")
				// Perform attack
				for _, p := range players {
					if distanceTo(e, p) < e.AttackRadius {
						// log.Println("hit player")
						p.HP -= e.AttackDamage
						damageUpdates = append(damageUpdates, DamageUpdate{
							ID:     p.ID,
							Type:   "player",
							Damage: e.AttackDamage,
						})
					}
				}
				e.State = StateCooldown
				e.StateTimer = 1.0 // 1 second cooldown
			}

		case StateCooldown:
			if e.StateTimer <= 0 {
				if nearestPlayer != nil && distanceTo(e, nearestPlayer) < e.AggroRadius {
					e.State = StatePursue
				} else {
					e.State = StateRoam
				}
			}

		case StateDeath:
			if e.StateTimer <= 0 {
				e.IsAlive = false
				continue
			}
		}

		// Update position
		e.X += e.VelocityX * deltaTime
		e.Y += e.VelocityY * deltaTime

		// Update direction based on velocity
		if e.VelocityY < 0 {
			e.Direction = 3 // back
		} else if e.VelocityY > 0 {
			e.Direction = 0 // front
		} else if e.VelocityX > 0 {
			e.Direction = 2 // right
		} else if e.VelocityX < 0 {
			e.Direction = 1 // left
		}

		// Check for death
		if e.HP <= 0 && e.State != StateDeath {
			e.State = StateDeath
			e.StateTimer = 1.0 // 1 second death animation
			e.VelocityX = 0
			e.VelocityY = 0
		}

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

	// Send updates
	if len(enemyUpdates) > 0 {
		enemyUpdateChan <- enemyUpdates
	}
	if len(damageUpdates) > 0 {
		damageUpdateChan <- damageUpdates
	}
	if len(attackUpdates) > 0 {
		attackUpdateChan <- attackUpdates
	}

	// Clean up dead enemies
	for id, e := range Enemies {
		if !e.IsAlive {
			delete(Enemies, id)
		}
	}
}

func updateRoamState(e *Enemy, deltaTime float32) {
	// Randomly change direction occasionally
	if rand.Float32() < 0.05 { // 5% chance per tick
		angle := rand.Float32() * 2 * math.Pi
		e.VelocityX = e.RoamSpeed * float32(math.Cos(float64(angle)))
		e.VelocityY = e.RoamSpeed * float32(math.Sin(float64(angle)))
	}

	// Keep enemy within roaming radius (e.g., 5 tiles) of spawn point
	maxDistance := float32(5 * 32)
	dx := e.X - e.SpawnPointX
	dy := e.Y - e.SpawnPointY
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
	if dist > maxDistance {
		// Move back toward spawn point
		angle := float32(math.Atan2(float64(-dy), float64(-dx)))
		e.VelocityX = e.RoamSpeed * float32(math.Cos(float64(angle)))
		e.VelocityY = e.RoamSpeed * float32(math.Sin(float64(angle)))
	}
}

func updatePursueState(e *Enemy, target *Player, deltaTime float32) {
	if target == nil {
		e.VelocityX = 0
		e.VelocityY = 0
		return
	}

	dx := target.X - e.X
	dy := target.Y - e.Y
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
	if dist > 0 {
		e.VelocityX = (dx / dist) * e.RoamSpeed * 1.5 // 1.5x roam speed
		e.VelocityY = (dy / dist) * e.RoamSpeed * 1.5
	}
}

func findNearestPlayer(e *Enemy) *Player {
	mu.RLock()
	defer mu.RUnlock()

	var nearest *Player
	minDist := float32(math.MaxFloat32)

	for _, p := range players {
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

// HandleEnemyRespawns manages enemy respawning
/*
func HandleEnemyRespawns() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		enemyMu.Lock()
		currentTime := time.Now().UnixMilli()
		for id, e := range Enemies {
			if !e.IsAlive && e.RespawnTime > 0 && currentTime >= e.RespawnTime {
				// Respawn the enemy
				e.X = e.SpawnPointX
				e.Y = e.SpawnPointY
				e.HP = e.MaxHP
				e.IsAlive = true
				e.State = StateSpawn
				e.StateTimer = 2.0
				Enemies[id] = e
			}
		}
		enemyMu.Unlock()
	}
}
*/
