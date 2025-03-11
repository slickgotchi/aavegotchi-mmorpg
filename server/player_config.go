package main

type PlayerClassConfig struct {
	TNK int
	DPS int
	SUP int
}

// EnemyConfigs maps enemy types to their configurations
var BasePlayerClassConfigs = map[string]PlayerClassConfig{
	"guardian": {
		TNK: 150,
		DPS: 100,
		SUP: 50,
	},
	"paladin": {
		TNK: 150,
		DPS: 50,
		SUP: 100,
	},
	"ravager": {
		TNK: 100,
		DPS: 150,
		SUP: 50,
	},
	"monk": {
		TNK: 100,
		DPS: 50,
		SUP: 150,
	},
	"harbinger": {
		TNK: 50,
		DPS: 150,
		SUP: 100,
	},
	"mystic": {
		TNK: 50,
		DPS: 100,
		SUP: 150,
	},
}
