package main

import (
	"log"
	"time"
)

// Ability defines the interface for all abilities
type Ability interface {
    Execute(caster Entity, gs *GameServer, zone *Zone) []Message
    GetAPCost() int
    GetCooldown() time.Duration
    IsOnCooldown() bool
    ResetCooldown()
}

// ExecuteAbility executes the specified ability for the given entity
func ExecuteAbility(caster Entity, abilityName string, gs *GameServer, zone *Zone) []Message {
    var ability Ability
    switch abilityName {
    case "HammerSwing":
        ability = NewHammerSwingForCaster(caster)
    case "Fireball":
        ability = NewFireballForCaster(caster)
    case "ColossalSweep":
        ability = NewColossalSweepForCaster(caster)
    default:
        log.Printf("Unknown ability: %s for %s", abilityName, caster.GetID())
        return nil
    }
    return ability.Execute(caster, gs, zone)
}