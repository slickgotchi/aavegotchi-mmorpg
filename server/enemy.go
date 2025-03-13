package main

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"time"
)

// Stats holds common game statistics for both players and enemies
type Stats struct {
	MaxHP int
	HP    int
	MaxAP int
	AP    int
	ATK   int
}

// Enemy represents an enemy entity
type Enemy struct {
	ID                 string
	ZoneID             int
	X, Y               float32 // Tile coordinates
	VX, VY             float32 // Tiles per second
	Type               string  // "easy", "medium", "hard"
	Direction          int
	SpriteHeightPixels float32

	Stats Stats // Shared stats struct

	// AI state machine
	State          string        // Current state ("Spawn", "Roam", etc.)
	StateStartTime time.Time     // When the current state started
	StateDuration  time.Duration // Duration of the current state
	PreviousState  string

	// AI configuration (set by enemy type)
	PursueTriggerRadius    float32       // Radius to trigger Pursue state
	TelegraphTriggerRadius float32       // Radius to trigger Telegraph state
	TelegraphDuration      time.Duration // Duration of Telegraph state
	AttackDuration         time.Duration // Duration of Attack state
	DeathDuration          time.Duration // Duration of Death state

	// Ability configuration
	Ability     Ability // Generic ability slot
	AbilityName string  // Name of the ability (for reference)
}

// GetID returns the enemy's ID
func (e *Enemy) GetID() string {
	return e.ID
}

// GetX returns the enemy's X coordinate
func (e *Enemy) GetX() float32 {
	return e.X
}

// GetY returns the enemy's Y coordinate
func (e *Enemy) GetY() float32 {
	return e.Y
}

// GetStats returns the enemy's stats
func (e *Enemy) GetStats() *Stats {
	return &e.Stats
}

func (e *Enemy) GetSpriteHeightPixels() float32 {
	return e.SpriteHeightPixels
}

// NewEnemy creates a new enemy with the given configuration
func NewEnemy(zoneID int, x, y float32, enemyType string) *Enemy {
	config, exists := EnemyConfigs[enemyType]
	if !exists {
		log.Printf("Unknown enemy type: %s, defaulting to easy", enemyType)
		config = EnemyConfigs["easy"]
	}

	enemy := &Enemy{
		ID:                 fmt.Sprintf("enemy%d_%d", zoneID, rand.Int()),
		ZoneID:             zoneID,
		X:                  x,
		Y:                  y,
		VX:                 float32(rand.Float32()*2-1) * 100,
		VY:                 float32(rand.Float32()*2-1) * 100,
		Type:               enemyType,
		Direction:          0,
		SpriteHeightPixels: 32, // make all enemies 32 pixels high for now

		Stats: Stats{
			MaxHP: config.MaxHP,
			HP:    config.MaxHP,
			MaxAP: config.MaxAP,
			AP:    config.MaxAP,
			ATK:   config.ATK,
		},

		// AI configuration
		PursueTriggerRadius:    config.PursueTriggerRadius,
		TelegraphTriggerRadius: config.TelegraphTriggerRadius,
		TelegraphDuration:      config.TelegraphDuration,
		AttackDuration:         config.AttackDuration,
		DeathDuration:          config.DeathDuration,

		// Initial state
		State:          "Spawn",
		StateStartTime: time.Now(),
		StateDuration:  config.SpawnDuration,
		PreviousState:  "",

		// Ability configuration
		AbilityName: config.AbilityName,
	}

	// Initialize the ability based on AbilityName
	switch enemy.AbilityName {
	case "HammerSwing":
		enemy.Ability = NewHammerSwingForCaster(enemy)
	case "Fireball":
		enemy.Ability = NewFireballForCaster(enemy)
	case "":
		log.Printf("No ability specified for enemy type %s", enemyType)
		enemy.Ability = nil
	default:
		log.Printf("Unknown ability %s for enemy type %s", enemy.AbilityName, enemyType)
		enemy.Ability = nil
	}

	return enemy
}

func (e *Enemy) ChangeState(newState string, newStateDuration time.Duration) {
	e.PreviousState = e.State
	e.State = newState
	e.StateStartTime = time.Now()
	e.StateDuration = newStateDuration
	// log.Println(e.ID, " has new State: ", newState)
}

func (e *Enemy) IsFirstTimeInState() bool {
	isFirstTime := e.PreviousState != e.State
	e.PreviousState = e.State
	return isFirstTime
}

// UpdateEnemy updates the enemy's state and position
func (e *Enemy) UpdateEnemy(gs *GameServer, zone *Zone) ([]Message, bool) {
	var messages []Message

	// Check for death
	if e.Stats.HP <= 0 && e.State != "Death" {
		e.ChangeState("Death", e.DeathDuration)
		e.VX, e.VY = 0, 0 // Stop moving
	}

	// Handle state transitions
	switch e.State {
	case "Spawn":
		if time.Since(e.StateStartTime) >= e.StateDuration {
			e.ChangeState("Roam", 0)
		}

	case "Roam":
		// Randomly wander
		if rand.Float32() < 0.02 { // 2% chance per tick to change direction
			e.VX = float32(rand.Float32()*2-1) * 100
			e.VY = float32(rand.Float32()*2-1) * 100
		}
		// Check for nearby players to pursue
		nearestPlayer, dist := e.findNearestPlayer(zone)
		if nearestPlayer != nil && dist <= e.PursueTriggerRadius {
			e.ChangeState("Pursue", 0)
		}

	case "Pursue":
		nearestPlayer, dist := e.findNearestPlayer(zone)
		if nearestPlayer == nil || dist > e.PursueTriggerRadius {
			e.ChangeState("Roam", 0)
		} else if dist <= e.TelegraphTriggerRadius {
			e.ChangeState("Telegraph", e.TelegraphDuration)
			e.VX, e.VY = 0, 0 // Stop moving to telegraph attack
		} else {
			// Move toward the player
			dx := nearestPlayer.X - e.X
			dy := nearestPlayer.Y - e.Y
			mag := float32(math.Sqrt(float64(dx*dx + dy*dy)))
			if mag > 0 {
				e.VX = (dx / mag) * 150 // Move faster than Roam
				e.VY = (dy / mag) * 150
			}
		}

	case "Telegraph":
		// if first time
		if e.IsFirstTimeInState() {

			// For Fireball, select the target and set the impact position
			if e.AbilityName == "Fireball" {
				fireball, ok := e.Ability.(*Fireball)
				if !ok {
					log.Printf("Enemy %s has Fireball ability but type assertion failed", e.ID)
				} else {
					// Find the nearest valid target within range
					var target Entity
					var targetDist float32 = fireball.Range
					var targetID string
					if fireball.TargetType == "player" || fireball.TargetType == "all" {
						for _, player := range zone.Players {
							if player.GetID() == e.GetID() {
								continue
							}
							dx := player.GetX() - e.GetX()
							dy := player.GetY() - e.GetY()
							dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
							if dist <= fireball.Range && dist < targetDist {
								target = player
								targetDist = dist
								targetID = player.GetID()
							}
						}
					}
					if fireball.TargetType == "enemy" || fireball.TargetType == "all" {
						for _, enemy := range zone.Enemies {
							if enemy.GetID() == e.GetID() {
								continue
							}
							dx := enemy.GetX() - e.GetX()
							dy := enemy.GetY() - e.GetY()
							dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))
							if dist <= fireball.Range && dist < targetDist {
								target = enemy
								targetDist = dist
								targetID = enemy.GetID()
							}
						}
					}

					// If a target is found, set the impact position and send a telegraph warning
					if target != nil {
						fireball.SetImpactPosition(target.GetX(), target.GetY(), targetID)
						messages = append(messages, Message{
							Type: "telegraphWarning",
							Data: map[string]interface{}{
								"ability":  "Fireball",
								"casterId": e.GetID(),
								"targetId": targetID,
								"impactX":  target.GetX(),
								"impactY":  target.GetY(),
								"radius":   fireball.Radius,
								"duration": e.StateDuration.Milliseconds(),
							},
						})
					}
				}
			}
		}

		if time.Since(e.StateStartTime) >= e.StateDuration {
			e.ChangeState("Attack", e.AttackDuration)
			if e.Ability != nil {
				messages = append(messages, e.Ability.Execute(e, gs, zone)...)
			} else {
				log.Printf("Enemy %s has no ability to execute", e.ID)
			}
		}

	case "Attack":
		if time.Since(e.StateStartTime) >= e.StateDuration {
			duration := time.Duration(1) * time.Second
			if e.Ability != nil {
				duration = e.Ability.GetCooldown()
			} else {
				// Fallback duration if no ability is set
				duration = 1 * time.Second
				log.Printf("Enemy %s has no ability; using default cooldown of 1 second", e.ID)
			}
			e.ChangeState("Cooldown", duration)
		}

	case "Cooldown":
		if time.Since(e.StateStartTime) >= e.StateDuration {
			nearestPlayer, dist := e.findNearestPlayer(zone)
			if nearestPlayer != nil && dist <= e.TelegraphTriggerRadius {
				e.ChangeState("Telegraph", e.TelegraphDuration)
			} else if nearestPlayer != nil && dist <= e.PursueTriggerRadius {
				e.ChangeState("Puruse", 0)
			} else {
				e.ChangeState("Roam", 0)
			}
		}

	case "Death":
		if time.Since(e.StateStartTime) >= e.StateDuration {
			// Enemy is fully dead, award XP to nearby players
			for _, player := range zone.Players {
				dx := player.X - e.X
				dy := player.Y - e.Y
				if float32(math.Sqrt(float64(dx*dx+dy*dy))) <= 500 { // Arbitrary XP award radius
					xpAward := 10 // Adjust based on enemy type
					switch e.Type {
					case "easy":
						xpAward = 10
					case "medium":
						xpAward = 20
					case "hard":
						xpAward = 50
					}
					addPlayerXP(player, xpAward, gs)
				}
			}
			return messages, false // Remove enemy
		}
	}

	// Update position
	dt := float32(TickInterval.Seconds())
	e.X += e.VX * dt
	e.Y += e.VY * dt

	// Keep enemy within zone bounds
	if e.X < zone.WorldX {
		e.X = zone.WorldX
		e.VX = -e.VX * 0.5 // Reduce speed on bounce to prevent oscillation
	}
	if e.X > zone.WorldX+float32(ZoneWidthPixels) {
		e.X = zone.WorldX + float32(ZoneWidthPixels)
		e.VX = -e.VX * 0.5
	}
	if e.Y < zone.WorldY {
		e.Y = zone.WorldY
		e.VY = -e.VY * 0.5
	}
	if e.Y > zone.WorldY+float32(ZoneHeightPixels) {
		e.Y = zone.WorldY + float32(ZoneHeightPixels)
		e.VY = -e.VY * 0.5
	}

	return messages, true // Keep the enemy alive
}

// findNearestPlayer finds the nearest player to the enemy
func (e *Enemy) findNearestPlayer(zone *Zone) (*Player, float32) {
	var nearestPlayer *Player = nil
	var minDistSq float32 = math.MaxFloat32

	for _, player := range zone.Players {
		dx := player.X - e.X
		dy := player.Y - e.Y
		distSq := float32(dx*dx + dy*dy)
		if distSq < minDistSq {
			minDistSq = distSq
			nearestPlayer = player
		}
	}

	return nearestPlayer, float32(math.Sqrt(float64(minDistSq)))
}
