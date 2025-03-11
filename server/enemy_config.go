package main

import "time"

// EnemyConfig defines the configuration for an enemy type
type EnemyConfig struct {
	MaxHP                  int
	MaxAP                  int
	ATK                    int
	PursueTriggerRadius    float32
	TelegraphTriggerRadius float32
	SpawnDuration          time.Duration
	TelegraphDuration      time.Duration
	AttackDuration         time.Duration
	DeathDuration          time.Duration
	AbilityName            string // Name of the ability the enemy uses
}

// EnemyConfigs maps enemy types to their configurations
var EnemyConfigs = map[string]EnemyConfig{
	"easy": {
		MaxHP:                  50,
		MaxAP:                  0, // Enemies don't use AP in this example
		ATK:                    5,
		PursueTriggerRadius:    8 * TileSize,
		TelegraphTriggerRadius: 2 * TileSize,
		SpawnDuration:          1 * time.Second,
		TelegraphDuration:      500 * time.Millisecond,
		AttackDuration:         500 * time.Millisecond,
		DeathDuration:          1 * time.Second,
		AbilityName:            "HammerSwing",
	},
	"medium": {
		MaxHP:                  100,
		MaxAP:                  0,
		ATK:                    10,
		PursueTriggerRadius:    8 * TileSize,
		TelegraphTriggerRadius: 2 * TileSize,
		SpawnDuration:          1 * time.Second,
		TelegraphDuration:      500 * time.Millisecond,
		AttackDuration:         500 * time.Millisecond,
		DeathDuration:          1 * time.Second,
		AbilityName:            "HammerSwing",
	},
	"hard": {
		MaxHP:                  200,
		MaxAP:                  0,
		ATK:                    20,
		PursueTriggerRadius:    8 * TileSize,
		TelegraphTriggerRadius: 6 * TileSize,
		SpawnDuration:          1 * time.Second,
		TelegraphDuration:      1000 * time.Millisecond,
		AttackDuration:         500 * time.Millisecond,
		DeathDuration:          1 * time.Second,
		AbilityName:            "Fireball",
	},
}
