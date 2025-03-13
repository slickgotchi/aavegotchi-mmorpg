export interface TilemapZone {
    zoneId: number;
    tilemapRef: string;
    worldX: number;
    worldY: number;
    tilemap: Phaser.Tilemaps.Tilemap;
}

export interface ActiveZoneList {
    currentZoneId: number;
    xAxisZoneId: number;
    yAxisZoneId: number;
    diagonalZoneId: number;
}
